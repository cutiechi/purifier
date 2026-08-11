import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../../storage/db"
import { Store } from "../../storage/store"
import type { ChapterLink, HomePage } from "../../extractor"
import { ArchivePostsJob } from "./archive_posts"
import type { JobContext } from "../handler"

/** ChapterLink 必填 index；工厂补默认 0（handler 不读 index） */
function link(tid: string, title: string): ChapterLink {
  return { index: 0, tid, title }
}

function page(links: ChapterLink[], nextMtid: string | null): HomePage {
  return { links, nextMtid }
}

function makeJob() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-job-"))
  const db = openDatabase(dir)
  let t = 10_000
  const store = new Store(db, () => t++)
  const job = new ArchivePostsJob(store, () => t++)
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
    signal: controller.signal,
    payload,
  }
  return { ctx, logs, controller, progress }
}

describe("ArchivePostsJob", () => {
  test("多页正常 → result 正确，游标推进到底", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("300", "C"), link("200", "B")], "200"),
      page([link("150", "A")], "150"),
      page([link("100", "旧")], null),
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const { ctx } = makeCtx({ delayMs: 200 }) // 合法下界，避免回落 800 拖慢
    const result = await job.run(ctx)
    expect(result.pages).toBe(3)
    expect(result.inserted).toBe(4)
    expect(result.updated).toBe(0)
    expect(result.site).toBe("1")
    expect(result.mode).toBe("full")
    expect(result.stopReason).toBe("end")
    const list = store.listArchivePosts("1", { page: 1, limit: 10, sort: "tid" })
    expect(list.items.map((x) => x.tid)).toEqual(["300", "200", "150", "100"])
    expect(store.getArchiveCursor("1")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("重跑：标题不变跳过，变化计数 updated", async () => {
    const { job, dir } = makeJob()
    const p: HomePage = page([link("100", "A")], null)
    job.fetchPage = async () => p
    await job.run(makeCtx({ delayMs: 200 }).ctx)
    // 第二次：标题变了
    p.links[0]!.title = "A 改"
    const result = await job.run(makeCtx({ delayMs: 200 }).ctx)
    expect(result.pages).toBe(1)
    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
    expect(result.site).toBe("1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("resume 从保存的 next_mtid 继续", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("300", "C")], "200"),
      page([link("200", "B")], "100"),
      page([link("100", "A")], null),
    ]
    job.fetchPage = async (mtid) => {
      if (mtid === "0") return pages[0]!
      if (mtid === "200") return pages[1]!
      if (mtid === "100") return pages[2]!
      return page([], null)
    }
    // 先跑满 maxPages=1，留下续跑点
    await job.run(makeCtx({ delayMs: 200, maxPages: 1 }).ctx)
    const cur = store.getArchiveCursor("1")
    expect(cur?.status).toBe("interrupted")
    expect(cur?.next_mtid).toBe("200")
    // resume
    const result = await job.run(makeCtx({ delayMs: 200, mode: "resume" }).ctx)
    expect(result.pages).toBe(2) // 200 页 + 100 页
    expect(store.listArchivePosts("1", { page: 1, limit: 10, sort: "tid" }).items.map((x) => x.tid)).toEqual([
      "300",
      "200",
      "100",
    ])
    expect(store.getArchiveCursor("1")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("incremental：全页 tid ≤ max 则停", async () => {
    const { job, store, dir } = makeJob()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "200", title: "old-b" },
        { tid: "100", title: "old-a" },
      ],
      1_000
    )
    const pages: HomePage[] = [
      page([link("400", "new"), link("300", "new2")], "200"),
      page([link("200", "old-b"), link("100", "old-a")], "50"),
      page([link("50", "older")], null),
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const result = await job.run(
      makeCtx({ delayMs: 200, mode: "incremental" }).ctx
    )
    // 第 1 页新帖；第 2 页全 ≤ 200 → 停，不扫第 3 页
    expect(result.pages).toBe(2)
    expect(result.stopReason).toBe("incremental_caught_up")
    expect(result.inserted).toBe(2) // 400, 300
    expect(i).toBe(2) // 只请求了两页
    rmSync(dir, { recursive: true, force: true })
  })

  test("游标起始 mtid=0 不被当成上界，正常推进（不只抓一页）", async () => {
    const { job, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("5000", "X")], "4000"),
      page([link("4000", "Y")], null),
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200 }).ctx)
    expect(result.pages).toBe(2) // 关键：不是 1
    rmSync(dir, { recursive: true, force: true })
  })

  test("单页网络抖动 → 重试后成功，整轮不失败", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("10", "A")], "10"),
      page([link("5", "B")], null),
    ]
    let call = 0
    job.fetchPage = async () => {
      call++
      // 第 2 页前两次请求失败（网络抖动），第三次成功
      if (call === 2 || call === 3) throw new Error("upstream 502")
      return pages.shift() ?? page([], null)
    }
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    const result = await job.run(ctx)
    expect(result.pages).toBe(2)
    expect(result.stopReason).toBe("end")
    expect(call).toBe(4) // 第 1 页 + 第 2 页三次尝试
    expect(
      logs.some((l) => l.level === "warn" && /attempt 1 failed.*retrying/.test(l.message))
    ).toBe(true)
    const list = store.listArchivePosts("1", { page: 1, limit: 10, sort: "tid" })
    expect(list.items.map((x) => x.tid)).toEqual(["10", "5"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("持续失败 → 重试 3 次后抛错（不再一抖即停）", async () => {
    const { job, dir } = makeJob()
    let call = 0
    job.fetchPage = async () => {
      call++
      throw new Error("upstream 502")
    }
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    await expect(job.run(ctx)).rejects.toThrow(/upstream 502/)
    expect(call).toBe(3) // 原始 + 2 次重试
    expect(
      logs.some((l) => l.level === "warn" && /attempt 1 failed.*retrying/.test(l.message))
    ).toBe(true)
    expect(
      logs.some((l) => l.level === "warn" && /page 1 failed: upstream 502; stopping/.test(l.message))
    ).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("空标题项被丢弃，日志报 dropped", async () => {
    const { job, store, dir } = makeJob()
    job.fetchPage = async () =>
      page(
        [link("100", "A"), link("101", "   "), link("102", "")],
        null
      )
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    await job.run(ctx)
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items.map((x) => x.tid)).toEqual(["100"])
    expect(logs.some((l) => /2 empty dropped/.test(l.message))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("abort 中途 → logs 含 aborted by user，result 反映已处理页", async () => {
    const { job, dir } = makeJob()
    const { ctx, logs, controller } = makeCtx({ delayMs: 200 })
    let call = 0
    job.fetchPage = async () => {
      call++
      if (call === 2) controller.abort()
      return page([link(String(call * 100), "T")], String(call * 100))
    }
    const result = await job.run(ctx)
    expect(result.pages).toBeGreaterThanOrEqual(1)
    expect(
      logs.some((l) => /aborted by user/.test(l.message))
    ).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("site!=='1' → 抛错", async () => {
    const { job, dir } = makeJob()
    const { ctx } = makeCtx({ site: "2" })
    await expect(job.run(ctx)).rejects.toThrow(/site: 2/)
    rmSync(dir, { recursive: true, force: true })
  })

  test("非法 delayMs（NaN/负/超 5000）回落 800", async () => {
    const { job, dir } = makeJob()
    job.fetchPage = async () => page([], null)
    for (const bad of [NaN, -1, 99999]) {
      const { ctx } = makeCtx({ delayMs: bad })
      // 不抛错即代表 clamp 生效（空页直接结束）
      await job.run(ctx)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
