import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../../storage/db"
import { Store } from "../../storage/store"
import type { JobContext } from "../handler"
import { ArchiveAutoGroupJob } from "./archive_auto_group"

function make() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-auto-group-"))
  const db = openDatabase(dir)
  let t = 10_000
  const store = new Store(db, () => t++)
  const job = new ArchiveAutoGroupJob(store)
  return { job, store, dir }
}

function makeCtx(payload: Record<string, unknown> = {}): {
  ctx: JobContext
  logs: string[]
} {
  const logs: string[] = []
  const controller = new AbortController()
  const ctx: JobContext = {
    jobId: 1,
    log: (_l, m) => logs.push(m),
    reportProgress: () => {},
    signal: controller.signal,
    payload,
  }
  return { ctx, logs }
}

describe("ArchiveAutoGroupJob", () => {
  test("同书多章 → upsert 一组；单章跳过", async () => {
    const { job, store, dir } = make()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "10", title: "【夏天的花】（1）作者：甲『伦理』" },
        { tid: "11", title: "【夏天的花】（2）作者：甲『伦理』" },
        { tid: "12", title: "【夏天的花】（3）作者：甲『伦理』" },
        { tid: "99", title: "【独章小说】作者：乙『都市』" },
      ],
      1_000
    )
    const { ctx } = makeCtx({ site: "1", minMembers: 2 })
    const result = await job.run(ctx)
    expect(result.scanned).toBe(4)
    expect(result.groupsUpserted).toBe(1)
    expect(result.membersLinked).toBe(3)
    expect(result.skippedSingles).toBe(1)
    const groups = store.listGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((i) => i.tid).sort()).toEqual([
      "10",
      "11",
      "12",
    ])
    expect(groups[0]!.title).toContain("夏天的花")
    rmSync(dir, { recursive: true, force: true })
  })

  test("site!==1 抛错", async () => {
    const { job, dir } = make()
    await expect(job.run(makeCtx({ site: "2" }).ctx)).rejects.toThrow(/site=1/)
    rmSync(dir, { recursive: true, force: true })
  })

  test("二次运行幂等并入成员", async () => {
    const { job, store, dir } = make()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "1", title: "【书A】（1）作者：甲" },
        { tid: "2", title: "【书A】（2）作者：甲" },
      ],
      1_000
    )
    await job.run(makeCtx().ctx)
    store.upsertArchivePosts(
      "1",
      [{ tid: "3", title: "【书A】（3）作者：甲" }],
      2_000
    )
    const r2 = await job.run(makeCtx().ctx)
    expect(r2.groupsUpserted).toBe(1)
    expect(r2.membersLinked).toBe(3)
    expect(store.listGroups()[0]!.items).toHaveLength(3)
    rmSync(dir, { recursive: true, force: true })
  })

  test("tid 已在其它组 → 跳过该组，任务不失败", async () => {
    const { job, store, dir } = make()
    // 用户已手动把 tid 10 放进自己的组
    store.upsertGroup({
      key: "user-group",
      title: "用户组",
      items: [{ tid: "10", title: "x" }],
    })
    store.upsertArchivePosts(
      "1",
      [
        { tid: "10", title: "【书B】（1）作者：丙" },
        { tid: "11", title: "【书B】（2）作者：丙" },
        { tid: "12", title: "【书B】（3）作者：丙" },
      ],
      1_000
    )
    const { ctx, logs } = makeCtx({ site: "1", minMembers: 2 })
    const result = await job.run(ctx)
    // 整组跳过（含未冲突的 11/12，不抢用户 tid），任务正常完成
    expect(result.groupsUpserted).toBe(0)
    expect(result.skippedConflicts).toBe(1)
    expect(logs.some((l) => l.includes("already in another group"))).toBe(true)
    expect(store.listGroups().map((g) => g.key)).toEqual(["user-group"])
    rmSync(dir, { recursive: true, force: true })
  })
})
