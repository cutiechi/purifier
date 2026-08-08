import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../storage/db"
import { Store } from "../storage/store"
import { sleep } from "./sleep"
import type { JobHandler, JobContext, JobResult } from "./handler"
import { JobRunner } from "./runner"

function makeRunner() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-runner-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  const runner = new JobRunner(store)
  return { runner, store, dir }
}

class FakeHandler implements JobHandler {
  type = "fake"
  ticks = 0
  async run(ctx: JobContext): Promise<JobResult> {
    ctx.log("info", "start")
    for (let i = 0; i < 3; i++) {
      if (ctx.signal.aborted) break
      await sleep(5)
      this.ticks++
      ctx.log("info", `tick ${i}`)
    }
    return { ticks: this.ticks }
  }
}

class FailingHandler implements JobHandler {
  type = "failing"
  async run(): Promise<JobResult> {
    throw new Error("boom")
  }
}

/** 全同步重活：若 runner 不 defer，会堵死 start() 与事件循环 */
class SyncHeavyHandler implements JobHandler {
  type = "sync_heavy"
  entered = false
  async run(ctx: JobContext): Promise<JobResult> {
    this.entered = true
    // 故意不 await：模拟 auto_group 类同步扫库
    let n = 0
    for (let i = 0; i < 200_000; i++) n += i
    ctx.log("info", `sum=${n}`)
    return { n }
  }
}

describe("JobRunner", () => {
  test("正常完成 → succeeded，result 写入，logs 齐全", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FakeHandler())
    const job = await runner.start("fake")
    expect(job.status).toBe("running")
    // 等异步完成
    await sleep(80)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("succeeded")
    expect(done.result).toBe(JSON.stringify({ ticks: 3 }))
    const logs = store.listJobLogs(job.id, { limit: 100, offset: 0 })
    expect(logs.map((l) => l.message)).toEqual([
      "start",
      "tick 0",
      "tick 1",
      "tick 2",
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test("stop 中途 → aborted，logs 截断，sleep 不等完整 delay", async () => {
    const { runner, store, dir } = makeRunner()
    const handler = new FakeHandler()
    runner.register(handler)
    const job = await runner.start("fake")
    await sleep(8) // 让它跑 1-2 tick
    expect(runner.stop(job.id)).toBe(true)
    await sleep(50) // 等 finally
    const done = store.getJob(job.id)!
    expect(done.status).toBe("aborted")
    expect(handler.ticks).toBeLessThan(3)
    rmSync(dir, { recursive: true, force: true })
  })

  test("同 type 二次 start → 抛错（单例）", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FakeHandler())
    const job = await runner.start("fake")
    await expect(runner.start("fake")).rejects.toThrow(/already running/)
    // 清理：停掉后台 job 并等 finally，避免写已删目录
    runner.stop(job.id)
    await sleep(40)
    void store
    rmSync(dir, { recursive: true, force: true })
  })

  test("handler 抛错 → failed + error 写入", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FailingHandler())
    const job = await runner.start("failing")
    await sleep(30)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("failed")
    expect(done.error).toContain("boom")
    rmSync(dir, { recursive: true, force: true })
  })

  test("recoverOnStartup 同时清 running 与 pending", () => {
    const { runner, store, dir } = makeRunner()
    // 手动塞两个残留行
    const a = store.createJob("fake", null) // pending
    const b = store.createJob("fake", null)
    store.markRunning(b.id)
    runner.recoverOnStartup()
    expect(store.getJob(a.id)?.status).toBe("interrupted")
    expect(store.getJob(b.id)?.status).toBe("interrupted")
    rmSync(dir, { recursive: true, force: true })
  })

  test("全同步 handler 不阻塞 start 返回", async () => {
    const { runner, store, dir } = makeRunner()
    const handler = new SyncHeavyHandler()
    runner.register(handler)
    const t0 = Date.now()
    const job = await runner.start("sync_heavy")
    const startMs = Date.now() - t0
    // start 应立即返回 running，且重活尚未进入（setTimeout 0 推迟）
    expect(job.status).toBe("running")
    expect(handler.entered).toBe(false)
    expect(startMs).toBeLessThan(50)
    await sleep(100)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("succeeded")
    expect(handler.entered).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("未知 type → 抛错", async () => {
    const { runner, dir } = makeRunner()
    await expect(runner.start("unknown")).rejects.toThrow(/unknown job type/)
    rmSync(dir, { recursive: true, force: true })
  })
})
