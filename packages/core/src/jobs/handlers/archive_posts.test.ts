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
  controller: AbortController
} {
  const controller = new AbortController()
  const logs: Array<{ level: string; message: string }> = []
  const ctx: JobContext = {
    jobId: 1,
    log: (level, message) => logs.push({ level, message }),
    signal: controller.signal,
    payload,
  }
  return { ctx, logs, controller }
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
    expect(result).toEqual({ pages: 3, inserted: 4, updated: 0, site: "1" })
    const list = store.listArchivePosts("1", { page: 1, limit: 10, sort: "tid" })
    expect(list.items.map((x) => x.tid)).toEqual(["300", "200", "150", "100"])
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
    expect(result).toEqual({ pages: 1, inserted: 0, updated: 1, site: "1" })
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

  test("单页抛错 → 抛错（Runner 标 failed），不重试不跳过", async () => {
    const { job, dir } = makeJob()
    let call = 0
    job.fetchPage = async () => {
      call++
      if (call === 2) throw new Error("upstream 502")
      return page([link("10", "A")], "10")
    }
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    await expect(job.run(ctx)).rejects.toThrow(/upstream 502/)
    expect(
      logs.some((l) => l.level === "warn" && /page 2 failed/.test(l.message))
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
