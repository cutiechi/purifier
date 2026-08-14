import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-jobs-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

/** 造三个任务：a 论坛成功、b 书库失败、c 论坛暂停中（makeStore 的 now 每次 +1） */
function seedThree(store: Store) {
  const a = store.createJob("archive_posts", null)
  store.markRunning(a.id)
  store.markFinished(a.id, "succeeded", { pages: 1 }, null)
  const b = store.createJob("archive_books", null)
  store.markRunning(b.id)
  store.markFinished(b.id, "failed", null, "boom")
  const c = store.createJob("archive_posts", null)
  store.markRunning(c.id)
  store.markPaused(c.id)
  return { a, b, c }
}

describe("jobs store", () => {
  test("createJob + getJob 往返；payload JSON 序列化", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", { site: "1", delayMs: 800 })
    expect(job.id).toBeGreaterThan(0)
    expect(job.status).toBe("pending")
    expect(job.type).toBe("archive_posts")
    expect(job.payload).toBe(JSON.stringify({ site: "1", delayMs: 800 }))
    expect(job.result).toBeNull()
    expect(job.created_at).toBe(1_000)
    const got = store.getJob(job.id)
    expect(got?.id).toBe(job.id)
    expect(store.getJob(9999)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("markRunning pending→running 返回 true；非 pending 返回 false", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    expect(store.markRunning(job.id)).toBe(true)
    const running = store.getJob(job.id)!
    expect(running.status).toBe("running")
    expect(running.started_at).toBe(1_001)
    // 再 mark 一次（已 running）→ false
    expect(store.markRunning(job.id)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("markFinished 写终态 + finished_at + result/error", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    store.markFinished(job.id, "succeeded", { pages: 3 }, null)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("succeeded")
    expect(done.result).toBe(JSON.stringify({ pages: 3 }))
    expect(done.error).toBeNull()
    expect(done.finished_at).toBe(1_002)
    rmSync(dir, { recursive: true, force: true })
  })

  test("hasRunningOfType 单例检测", () => {
    const { store, dir } = makeStore()
    expect(store.hasRunningOfType("archive_posts")).toBe(false)
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    expect(store.hasRunningOfType("archive_posts")).toBe(true)
    store.markFinished(job.id, "succeeded", null, null)
    expect(store.hasRunningOfType("archive_posts")).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listJobs type/status 过滤 + created_at DESC", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null)
    const b = store.createJob("other", null)
    store.markRunning(a.id)
    const all = store.listJobs({ limit: 100, offset: 0 })
    expect(all.map((j) => j.id)).toEqual([b.id, a.id]) // DESC by created_at
    const archived = store.listJobs({
      type: "archive_posts",
      limit: 100,
      offset: 0,
    })
    expect(archived.map((j) => j.id)).toEqual([a.id])
    const running = store.listJobs({ status: "running", limit: 100, offset: 0 })
    expect(running.map((j) => j.id)).toEqual([a.id])
    rmSync(dir, { recursive: true, force: true })
  })

  test("countJobs 全量 / type / status 过滤与 listJobs 一致", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null)
    store.markRunning(a.id) // running
    store.createJob("other", null) // pending
    expect(store.countJobs({})).toBe(2)
    expect(store.countJobs({ type: "archive_posts" })).toBe(1)
    expect(store.countJobs({ status: "running" })).toBe(1)
    expect(store.countJobs({ status: "pending" })).toBe(1)
    expect(store.countJobs({ type: "archive_posts", status: "running" })).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("markStaleJobsInterrupted 同时清 running 与 pending", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null) // pending
    const b = store.createJob("archive_posts", null)
    store.markRunning(b.id) // running
    const removed = store.markStaleJobsInterrupted()
    expect(removed).toBe(2)
    expect(store.getJob(a.id)?.status).toBe("interrupted")
    expect(store.getJob(b.id)?.status).toBe("interrupted")
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteJob 删 job；CASCADE 清日志；幂等", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.appendJobLog(job.id, "info", "x")
    store.deleteJob(job.id)
    expect(store.getJob(job.id)).toBeNull()
    expect(store.listJobLogs(job.id, { limit: 10, offset: 0 })).toHaveLength(0)
    expect(() => store.deleteJob(job.id)).not.toThrow() // 幂等
    rmSync(dir, { recursive: true, force: true })
  })

  test("appendJobLog + listJobLogs ASC/DESC + level 过滤", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.appendJobLog(job.id, "info", "first")
    store.appendJobLog(job.id, "warn", "second")
    store.appendJobLog(job.id, "error", "third")
    const asc = store.listJobLogs(job.id, { limit: 100, offset: 0 })
    expect(asc.map((l) => l.message)).toEqual(["first", "second", "third"])
    const desc = store.listJobLogs(job.id, {
      limit: 100,
      offset: 0,
      order: "desc",
    })
    expect(desc.map((l) => l.message)).toEqual(["third", "second", "first"])
    const warns = store.listJobLogs(job.id, {
      limit: 100,
      offset: 0,
      level: "warn",
    })
    expect(warns.map((l) => l.message)).toEqual(["second"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("markPaused/markResumed 往返，不改 started_at", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    const startedAt = store.getJob(job.id)!.started_at
    expect(store.markPaused(job.id)).toBe(true)
    expect(store.getJob(job.id)!.status).toBe("paused")
    expect(store.getJob(job.id)!.started_at).toBe(startedAt)
    expect(store.markPaused(job.id)).toBe(false) // 已 paused
    expect(store.markResumed(job.id)).toBe(true)
    expect(store.getJob(job.id)!.status).toBe("running")
    expect(store.getJob(job.id)!.started_at).toBe(startedAt)
    expect(store.markResumed(job.id)).toBe(false) // 已 running
    rmSync(dir, { recursive: true, force: true })
  })

  test("hasRunningOfType 把 paused 算占用", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    store.markPaused(job.id)
    expect(store.hasRunningOfType("archive_posts")).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("markStaleJobsInterrupted 覆盖 paused", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    store.markPaused(job.id)
    expect(store.markStaleJobsInterrupted()).toBe(1)
    expect(store.getJob(job.id)!.status).toBe("interrupted")
    rmSync(dir, { recursive: true, force: true })
  })

  test("listJobs 默认 created_at desc；order=asc 反转", () => {
    const { store, dir } = makeStore()
    const { a, b, c } = seedThree(store)
    const desc = store.listJobs({ limit: 10, offset: 0 })
    expect(desc.map((j) => j.id)).toEqual([c.id, b.id, a.id])
    const asc = store.listJobs({ limit: 10, offset: 0, order: "asc" })
    expect(asc.map((j) => j.id)).toEqual([a.id, b.id, c.id])
    rmSync(dir, { recursive: true, force: true })
  })

  test("status 聚合 active/finished：list 与 count 一致", () => {
    const { store, dir } = makeStore()
    const { a, b, c } = seedThree(store)
    const active = store.listJobs({ status: "active", limit: 10, offset: 0 })
    expect(active.map((j) => j.id)).toEqual([c.id])
    expect(store.countJobs({ status: "active" })).toBe(1)
    const finished = store.listJobs({
      status: "finished",
      limit: 10,
      offset: 0,
    })
    expect(finished.map((j) => j.id)).toEqual([b.id, a.id])
    expect(store.countJobs({ status: "finished" })).toBe(2)
    expect(
      store.countJobs({ type: "archive_posts", status: "finished" })
    ).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("sort=duration：进行中按 now 计，同耗时 tie-break created_at desc，NULL 排最后", () => {
    const { store, dir } = makeStore()
    const { a, b, c } = seedThree(store)
    const d = store.createJob("archive_posts", null) // pending：started_at NULL
    const rows = store.listJobs({ limit: 10, offset: 0, sort: "duration" })
    // c 进行中（now - started_at 最大）；a/b 终态同为 1ms → created_at desc（b 后建）在前；d NULL 末尾
    expect(rows.map((j) => j.id)).toEqual([c.id, b.id, a.id, d.id])
    rmSync(dir, { recursive: true, force: true })
  })

  test("sort=type（asc）与 sort=status 生效", () => {
    const { store, dir } = makeStore()
    const { a, b, c } = seedThree(store)
    const byType = store.listJobs({
      limit: 10,
      offset: 0,
      sort: "type",
      order: "asc",
    })
    expect(byType.map((j) => j.type)).toEqual([
      "archive_books",
      "archive_posts",
      "archive_posts",
    ])
    // status 序：running(0) > paused(1) > pending(2) > interrupted(3) > failed(4) > aborted(5) > succeeded(6)
    const byStatus = store.listJobs({ limit: 10, offset: 0, sort: "status" })
    expect(byStatus.map((j) => j.id)).toEqual([c.id, b.id, a.id])
    expect(byStatus.map((j) => j.status)).toEqual([
      "paused",
      "failed",
      "succeeded",
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteJobsMany 只删终态，removed 不计 CASCADE 日志", () => {
    const { store, dir } = makeStore()
    const { a, b, c } = seedThree(store)
    store.appendJobLog(a.id, "info", "log line") // FK CASCADE 行不计入 removed
    expect(store.deleteJobsMany([])).toBe(0)
    expect(store.deleteJobsMany([a.id, b.id])).toBe(2)
    expect(store.getJob(a.id)).toBeNull()
    expect(store.listJobLogs(a.id, { limit: 10, offset: 0 })).toEqual([])
    expect(store.deleteJobsMany([c.id])).toBe(0) // paused 不删
    expect(store.getJob(c.id)!.status).toBe("paused")
    rmSync(dir, { recursive: true, force: true })
  })
})
