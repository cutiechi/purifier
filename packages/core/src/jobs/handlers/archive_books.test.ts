import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../../storage/db"
import { Store } from "../../storage/store"
import type { ChapterLink, HomePage } from "../../extractor"
import { ArchiveBooksJob } from "./archive_books"
import type { JobContext } from "../handler"

/** ChapterLink 必填 index；工厂补默认 0（handler 不读 index） */
function link(tid: string, title: string): ChapterLink {
  return { index: 0, tid, title }
}

function page(links: ChapterLink[], nextMtid: string | null): HomePage {
  return { links, nextMtid }
}

function makeJob() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-books-"))
  const db = openDatabase(dir)
  let t = 10_000
  const store = new Store(db, () => t++)
  const job = new ArchiveBooksJob(store, () => t++)
  return { job, store, dir }
}

function makeCtx(payload: Record<string, unknown> = {}): {
  ctx: JobContext
  logs: Array<{ level: string; message: string }>
  progress: Array<Record<string, unknown>>
  controller: AbortController
} {
  const controller = new AbortController()
  const logs: Array<{ level: string; message: string }> = []
  const progress: Array<Record<string, unknown>> = []
  const ctx: JobContext = {
    jobId: 1,
    log: (level, message) => logs.push({ level, message }),
    reportProgress: (p) => progress.push(p),
    checkpoint: async () => {},
    signal: controller.signal,
    payload,
  }
  return { ctx, logs, controller, progress }
}

describe("ArchiveBooksJob", () => {
  test("full：从第 1 页翻到末页，游标推进正确", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("MjI4Nzg", "新书 A"), link("MjI4Nzc", "新书 B")], "2"),
      page([link("MjI4NzY", "旧书 C")], null),
    ]
    const fetched: string[] = []
    job.fetchPage = async (mtid) => {
      fetched.push(mtid)
      return pages[Number(mtid) - 1] ?? page([], null)
    }
    const { ctx } = makeCtx({ delayMs: 200 })
    const result = await job.run(ctx)
    expect(fetched).toEqual(["1", "2"])
    expect(result.pages).toBe(2)
    expect(result.inserted).toBe(3)
    expect(result.site).toBe("2")
    expect(result.mode).toBe("full")
    expect(result.stopReason).toBe("end")
    const list = store.listArchivePosts("2", {
      page: 1,
      limit: 10,
      sort: "title",
    })
    // title 升序：新(65B0) < 旧(65E7)
    expect(list.items.map((x) => x.tid)).toEqual([
      "MjI4Nzg",
      "MjI4Nzc",
      "MjI4NzY",
    ])
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("resume：从游标页继续到末页", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("A1", "a")], "2"),
      page([link("A2", "b")], "3"),
      page([link("A3", "c")], null),
    ]
    job.fetchPage = async (mtid) => pages[Number(mtid) - 1] ?? page([], null)
    // 先跑 maxPages=1，留下续跑点
    await job.run(makeCtx({ delayMs: 200, maxPages: 1 }).ctx)
    const cur = store.getArchiveCursor("2")
    expect(cur?.status).toBe("interrupted")
    expect(cur?.next_mtid).toBe("2")
    // resume 从第 2 页继续
    const result = await job.run(makeCtx({ delayMs: 200, mode: "resume" }).ctx)
    expect(result.pages).toBe(2)
    expect(result.inserted).toBe(2) // A2、A3
    expect(
      store
        .listArchivePosts("2", { page: 1, limit: 10, sort: "title" })
        .items.map((x) => x.tid)
    ).toEqual(["A1", "A2", "A3"])
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("incremental × 完整归档且站点扩容：越过旧深度后空增页即停", async () => {
    const { job, store, dir } = makeJob()
    // 完整归档：5 页各 1 本入库，游标 done、pages=5
    store.upsertArchivePosts(
      "2",
      [
        { tid: "P1A", title: "old" },
        { tid: "P2A", title: "old" },
        { tid: "P3A", title: "old" },
        { tid: "P4A", title: "old" },
        { tid: "P5A", title: "old" },
      ],
      1_000
    )
    store.setArchiveCursor("2", {
      next_mtid: null,
      mode: "full",
      status: "done",
      pages: 5,
    })
    // 2 本新书置顶，旧书各下移一页 → 站点扩容到 6 页；第 6 页只剩已归档的 P5A
    // （末页恰好等于旧深度的数据在 `>` 下永远触发不到越过条件，只会走 "end"，
    //   无法验证 incremental_caught_up 分支——见 review.md B1）
    const pages: HomePage[] = [
      page([link("NEW1", "新书"), link("NEW2", "新书2")], "2"),
      page([link("P1A", "old")], "3"),
      page([link("P2A", "old")], "4"),
      page([link("P3A", "old")], "5"),
      page([link("P4A", "old")], "6"),
      page([link("P5A", "old")], null), // 越过旧深度(5)的第 6 页：全已入库 → inserted=0
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200, mode: "incremental" }).ctx)
    expect(i).toBe(6) // 翻到第 6 页（旧深度+1）空增即停，不扫第 7 页
    expect(result.inserted).toBe(2) // 只补 2 本新书
    expect(result.stopReason).toBe("incremental_caught_up")
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("incremental × 部分归档（回归）：不停在第 1 页，追到末页自愈", async () => {
    const { job, store, dir } = makeJob()
    // 先跑 full：maxPages=2 中断 → 已存第 1、2 页，游标 interrupted pages=2
    const oldPages: HomePage[] = [
      page([link("P1A", "old"), link("P1B", "old")], "2"),
      page([link("P2A", "old"), link("P2B", "old")], "3"),
      page([link("P3A", "old")], null),
    ]
    job.fetchPage = async (mtid) => oldPages[Number(mtid) - 1] ?? page([], null)
    await job.run(makeCtx({ delayMs: 200, maxPages: 2 }).ctx)
    expect(store.getArchiveCursor("2")?.status).toBe("interrupted")
    expect(store.getArchiveCursor("2")?.pages).toBe(2)

    // 新书到达 + 旧页下移：第 1 页混入 NEW1/NEW2，第 2 页全已在库，第 3 页是未归档区（P4A 更旧）
    const nowPages: HomePage[] = [
      page([link("NEW1", "新书"), link("NEW2", "新书2"), link("P1A", "old"), link("P1B", "old")], "2"),
      page([link("P2A", "old"), link("P2B", "old")], "3"),
      page([link("P3A", "old"), link("P4A", "更旧")], null),
    ]
    let i = 0
    job.fetchPage = async () => nowPages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200, mode: "incremental" }).ctx)
    expect(i).toBe(3) // 关键：不停在第 1/2 页（旧实现 inserted=0 即停），翻到末页
    // 首轮 maxPages=2 只归档第 1、2 页，第 3 页从未入库 → P3A、P4A 全新补入
    expect(result.inserted).toBe(4) // NEW1、NEW2、P3A、P4A（review.md B2）
    expect(result.stopReason).toBe("end")
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("resume 跨站隔离：site=2 游标不影响 site=1", async () => {
    const { job, store, dir } = makeJob()
    job.fetchPage = async () => page([link("B1", "b")], "2")
    await job.run(makeCtx({ delayMs: 200, maxPages: 1 }).ctx)
    expect(store.getArchiveCursor("2")?.status).toBe("interrupted")
    expect(store.getArchiveCursor("1")).toBeNull()
    expect(
      store.listArchivePosts("1", { page: 1, limit: 10, sort: "title" }).items
    ).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test("site !== '2' → 抛错", async () => {
    const { job, dir } = makeJob()
    const { ctx } = makeCtx({ site: "1" })
    await expect(job.run(ctx)).rejects.toThrow(/site: 1/)
    rmSync(dir, { recursive: true, force: true })
  })
})
