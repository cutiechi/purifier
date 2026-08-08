import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-groups-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

describe("groups", () => {
  test("upsertGroup 新建组并返回含成员", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "A（1）" },
        { tid: "11", title: "A（2）" },
      ],
      author: "作者",
      genre: "都市",
    })
    expect(g.id).toBeGreaterThan(0)
    expect(g.title).toBe("A")
    expect(g.author).toBe("作者")
    expect(g.genre).toBe("都市")
    expect(g.favorited).toBe(false)
    expect(g.items.map((i) => i.tid)).toEqual(["10", "11"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("同 key 二次 upsert 只落一组、并入新成员、保留首快照", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "改过的标题" },
        { tid: "12", title: "A（3）" },
      ],
    })
    expect(store.listGroups()).toHaveLength(1)
    const g = store.listGroups()[0]!
    expect(g.items.map((i) => i.tid)).toEqual(["10", "12"])
    expect(g.items[0]!.title).toBe("A（1）") // IGNORE 保持首次快照
    rmSync(dir, { recursive: true, force: true })
  })

  test("空 items 不建组", () => {
    const { store, dir } = makeStore()
    expect(() =>
      store.upsertGroup({ key: "x", title: "X", items: [] })
    ).toThrow()
    expect(store.listGroups()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("removeGroupItems 移除成员；移除最后成员自动删组", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "A（1）" },
        { tid: "11", title: "A（2）" },
      ],
    })
    expect(store.removeGroupItems(g.id, ["10"])).toEqual({
      removed: 1,
      deleted: false,
    })
    expect(store.listGroups()[0]!.items.map((i) => i.tid)).toEqual(["11"])
    expect(store.removeGroupItems(g.id, ["11"])).toEqual({
      removed: 1,
      deleted: true,
    })
    expect(store.listGroups()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("removeGroupItems 组不存在返回 removed 0 / deleted false；deleteGroup 幂等", () => {
    const { store, dir } = makeStore()
    expect(store.removeGroupItems(9999, ["1"])).toEqual({
      removed: 0,
      deleted: false,
    })
    expect(() => store.deleteGroup(9999)).not.toThrow()
    expect(store.listGroups()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("upsert 同 key：author/genre 已有值不覆盖，title 刷新", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      author: "老作者",
      items: [{ tid: "1", title: "A（1）" }],
    })
    store.upsertGroup({
      key: "a",
      title: "A2", // title 随 upsert 刷新
      author: "新作者", // 已有 → COALESCE 保留旧值
      genre: "都市", // 空 → 补写
      items: [{ tid: "2", title: "A（2）" }],
    })
    const g = store.listGroups()[0]!
    expect(g.title).toBe("A2")
    expect(g.author).toBe("老作者")
    expect(g.genre).toBe("都市")
    rmSync(dir, { recursive: true, force: true })
  })

  test("setGroupFavorite 不修改 updated_at", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "1", title: "A（1）" }],
    })
    const id = store.listGroups()[0]!.id
    const before = store.listGroups()[0]!.updated_at
    store.setGroupFavorite(id, true)
    const after = store.listGroups()[0]!
    expect(after.favorited).toBe(true)
    expect(after.updated_at).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteGroup 级联清理 group_items", () => {
    const { store, db, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    store.deleteGroup(g.id)
    const rows = db.query("SELECT COUNT(*) AS n FROM group_items").get() as {
      n: number
    }
    expect(Number(rows.n)).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("setGroupFavorite 置位/复位，取消后 favorited_at 为 NULL；组不存在返回 false", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    expect(store.setGroupFavorite(g.id, true)).toBe(true)
    expect(store.listGroups()[0]!.favorited).toBe(true)
    expect(store.listGroups()[0]!.favorited_at).not.toBeNull()
    store.setGroupFavorite(g.id, false)
    const after = store.listGroups()[0]!
    expect(after.favorited).toBe(false)
    expect(after.favorited_at).toBeNull()
    expect(store.setGroupFavorite(9999, true)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listGroups 内嵌成员、q 过滤、updated_at DESC", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "Alpha",
      items: [{ tid: "1", title: "Alpha（1）" }],
    })
    store.upsertGroup({
      key: "b",
      title: "Beta",
      items: [{ tid: "2", title: "Beta（1）" }],
    })
    expect(store.listGroups().map((g) => g.title)).toEqual(["Beta", "Alpha"])
    expect(store.listGroups("alpha").map((g) => g.title)).toEqual(["Alpha"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("listGroupsPage 分页 + favorited + sort + 成员标题搜索", () => {
    const { store, dir } = makeStore()
    for (let i = 1; i <= 25; i++) {
      store.upsertGroup({
        key: `k${i}`,
        title: `Book ${String(i).padStart(2, "0")}`,
        items: [
          { tid: String(100 + i), title: `Book ${i}（1）` },
          ...(i % 5 === 0
            ? [{ tid: String(200 + i), title: `Book ${i}（2）` }]
            : []),
        ],
      })
    }
    store.setGroupFavorite(store.listGroups()[0]!.id, true)

    const p1 = store.listGroupsPage({ page: 1, limit: 10, sort: "title" })
    expect(p1.total).toBe(25)
    expect(p1.items).toHaveLength(10)
    expect(p1.nextPage).toBe(2)
    expect(p1.items[0]!.title).toBe("Book 01")

    const p3 = store.listGroupsPage({ page: 3, limit: 10, sort: "title" })
    expect(p3.items).toHaveLength(5)
    expect(p3.nextPage).toBeUndefined()

    const fav = store.listGroupsPage({ favorited: true, page: 1 })
    expect(fav.total).toBe(1)
    expect(fav.items[0]!.favorited).toBe(true)

    // 按成员标题搜
    const byMember = store.listGroupsPage({ q: "Book 5（2）", page: 1 })
    expect(byMember.total).toBe(1)
    expect(byMember.items[0]!.title).toBe("Book 05")

    // 章节数：Book 05/10/15/20/25 各 2 章，其余 1
    const byCh = store.listGroupsPage({ page: 1, limit: 5, sort: "chapters" })
    expect(byCh.items.every((g) => g.items.length === 2)).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })
})
