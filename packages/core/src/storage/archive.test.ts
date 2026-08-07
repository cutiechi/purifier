import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-"))
  const db = openDatabase(dir)
  let t = 5_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

describe("archive store", () => {
  test("upsertArchivePosts 全新批 → inserted=N, updated=0", () => {
    const { store, dir } = makeStore()
    const res = store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "A" },
        { tid: "101", title: "B" },
      ],
      9_000
    )
    expect(res).toEqual({ inserted: 2, updated: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("标题不变批 → inserted=0, updated=0，archived_at 不变", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts("1", [{ tid: "100", title: "A" }], 9_000)
    const res = store.upsertArchivePosts(
      "1",
      [{ tid: "100", title: "A" }],
      99_000
    )
    expect(res).toEqual({ inserted: 0, updated: 0 })
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items[0]!.archived_at).toBe(9_000) // 未刷新
    expect(list.items[0]!.first_seen_at).toBe(9_000)
    rmSync(dir, { recursive: true, force: true })
  })

  test("标题变化批 → updated=N，archived_at 刷新、first_seen_at 保留", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts("1", [{ tid: "100", title: "A" }], 9_000)
    const res = store.upsertArchivePosts(
      "1",
      [{ tid: "100", title: "A 改" }],
      99_000
    )
    expect(res).toEqual({ inserted: 0, updated: 1 })
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items[0]!.title).toBe("A 改")
    expect(list.items[0]!.archived_at).toBe(99_000)
    expect(list.items[0]!.first_seen_at).toBe(9_000)
    rmSync(dir, { recursive: true, force: true })
  })

  test("混合批（新+变+不变）三类计数", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "旧A" },
        { tid: "101", title: "不变B" },
      ],
      9_000
    )
    const res = store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "新A" }, // 变
        { tid: "101", title: "不变B" }, // 不变
        { tid: "102", title: "C" }, // 新
      ],
      99_000
    )
    expect(res).toEqual({ inserted: 1, updated: 1 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("空批早返回 {0,0}", () => {
    const { store, dir } = makeStore()
    expect(store.upsertArchivePosts("1", [], 9_000)).toEqual({
      inserted: 0,
      updated: 0,
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("listArchivePosts 三种 sort + q 过滤 + 分页", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "300", title: "香蕉" },
        { tid: "100", title: "苹果" },
        { tid: "200", title: "Apple" },
      ],
      9_000
    )
    // sort title asc（NOCASE）
    const byTitle = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "title",
    })
    expect(byTitle.items.map((i) => i.title)).toEqual([
      "Apple",
      "苹果",
      "香蕉",
    ])
    // sort tid desc
    const byTid = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(byTid.items.map((i) => i.tid)).toEqual(["300", "200", "100"])
    // sort archived_at desc（同 ts，按 tid desc 兜底由 SQL 决定，此处只验数量）
    const byArchived = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "archived_at",
    })
    expect(byArchived.items).toHaveLength(3)
    // q 过滤
    const q = store.listArchivePosts("1", {
      q: "app",
      page: 1,
      limit: 10,
      sort: "title",
    })
    expect(q.items.map((i) => i.title)).toEqual(["Apple"])
    // 分页 nextPage
    const page1 = store.listArchivePosts("1", {
      page: 1,
      limit: 2,
      sort: "tid",
    })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextPage).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listArchivePosts 非法 sort 抛错", () => {
    const { store, dir } = makeStore()
    expect(() =>
      store.listArchivePosts("1", {
        page: 1,
        limit: 10,
        // @ts-expect-error 测试非法入参
        sort: "evil; DROP TABLE",
      })
    ).toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})
