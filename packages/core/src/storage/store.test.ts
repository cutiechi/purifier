import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store, normalizeTag } from "./store"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "purifier-db-"))
}

describe("openDatabase", () => {
  test("creates items/favorites/tags tables", () => {
    const dir = tempDir()
    const db = openDatabase(dir)
    const rows = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all() as { name: string }[]
    expect(rows.map((r) => r.name)).toEqual(["favorites", "items", "tags"])
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("is idempotent on second open", () => {
    const dir = tempDir()
    openDatabase(dir).close()
    const db = openDatabase(dir) // 不抛错即通过
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-store-"))
  let t = 1_000
  const store = new Store(openDatabase(dir), () => t++)
  return { store, dir }
}

describe("recordVisit / getState", () => {
  test("new visit counts 1 and upsert increments + overwrites title", () => {
    const { store } = makeStore()
    store.recordVisit("post", "10", "标题A", "urlA")
    expect(store.getState("post", "10")?.visit_count).toBe(1)
    store.recordVisit("post", "10", "标题A2", "urlA")
    const state = store.getState("post", "10")
    expect(state?.visit_count).toBe(2)
    expect(state?.title).toBe("标题A2")
    expect(state?.first_seen_at).toBe(1000)
    expect(state?.last_visited_at).toBe(1001)
  })

  test("missing item returns null", () => {
    const { store } = makeStore()
    expect(store.getState("post", "nope")).toBeNull()
  })
})

describe("deleteItem / clearHistory", () => {
  test("deleteItem removes item favorites and tags", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    store.addFavorite("post", "1")
    store.setTags("post", "1", ["科幻"])
    expect(store.deleteItem("post", "1")).toBe(true)
    expect(store.getState("post", "1")).toBeNull()
    expect(store.listFavorites({}).items).toEqual([])
    expect(store.listTags()).toEqual([])
    expect(store.deleteItem("post", "1")).toBe(false)
  })

  test("deleteItems batch and clearHistory", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "A", "u")
    store.recordVisit("book", "2", "B", "u")
    store.recordVisit("post", "3", "C", "u")
    store.setTags("post", "1", ["x"])
    expect(
      store.deleteItems([
        { kind: "post", id: "1" },
        { kind: "book", id: "2" },
        { kind: "post", id: "missing" },
      ])
    ).toBe(2)
    expect(store.listHistory({}).items.map((i) => i.id)).toEqual(["3"])
    expect(store.clearHistory()).toBe(1)
    expect(store.listHistory({}).items).toEqual([])
    expect(store.clearHistory()).toBe(0)
  })
})

describe("favorites", () => {
  test("addFavorite fails for missing item", () => {
    const { store } = makeStore()
    expect(store.addFavorite("post", "1")).toBe(false)
  })

  test("add/remove favorite toggles state", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    expect(store.addFavorite("post", "1")).toBe(true)
    expect(store.getState("post", "1")?.favorited).toBe(true)
    store.removeFavorite("post", "1")
    expect(store.getState("post", "1")?.favorited).toBe(false)
  })
})

describe("setTags / normalize", () => {
  test("setTags replaces the whole set", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    expect(store.setTags("post", "1", ["科幻", "长篇"])).toEqual([
      "科幻",
      "长篇",
    ])
    store.setTags("post", "1", ["连载中"])
    expect(store.getState("post", "1")?.tags).toEqual(["连载中"])
  })

  test("setTags normalizes and dedupes", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    store.setTags("post", "1", ["  科幻  ", "科 幻", "科幻", "", "  "])
    expect(store.getState("post", "1")?.tags).toEqual(["科幻", "科 幻"])
  })

  test("truncates tags to 24 code points", () => {
    expect(normalizeTag("超长标签".repeat(10))?.length).toBe(24)
    expect(normalizeTag("   ")).toBeNull()
  })

  test("setTags returns null for missing item", () => {
    const { store } = makeStore()
    expect(store.setTags("book", "9", ["x"])).toBeNull()
  })

  test("deleteTag removes the tag from all items", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T1", "u1")
    store.recordVisit("post", "2", "T2", "u2")
    store.setTags("post", "1", ["科幻", "长篇"])
    store.setTags("post", "2", ["科幻"])
    expect(store.deleteTag("科幻")).toBe(2)
    expect(store.getState("post", "1")?.tags).toEqual(["长篇"])
    expect(store.getState("post", "2")?.tags).toEqual([])
    expect(store.listTags()).toEqual([{ tag: "长篇", count: 1 }])
    expect(store.deleteTag("不存在")).toBe(0)
    expect(store.deleteTag("  ")).toBe(0)
  })
})

function seed(store: Store) {
  store.recordVisit("post", "1", "Alpha 星", "u1")
  store.recordVisit("book", "2", "Beta 书", "u2")
  store.recordVisit("post", "3", "gamma 贴", "u3")
  store.setTags("post", "1", ["科幻"])
  store.setTags("post", "3", ["随笔"])
  store.addFavorite("book", "2")
}

describe("listHistory", () => {
  test("orders by last_visited_at desc", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({})
    expect(res.items.map((i) => i.id)).toEqual(["3", "2", "1"])
    expect(res.nextPage).toBeUndefined()
  })

  test("matches title substring case-insensitively and tag exactly", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listHistory({ q: "ALPHA" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
    expect(store.listHistory({ q: "科幻" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
  })

  test("filters by kind and aggregates tags/favorited", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({ kind: "book" })
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.tags).toEqual([])
    expect(res.items[0]?.favorited).toBe(true)
    const posts = store.listHistory({ kind: "post" })
    expect(posts.items.map((i) => i.id)).toEqual(["3", "1"])
    expect(posts.items.find((i) => i.id === "1")?.tags).toEqual(["科幻"])
  })

  test("paginates 20 per page", () => {
    const { store } = makeStore()
    for (let i = 0; i < 25; i++) {
      store.recordVisit("post", String(i), `T${i}`, "u")
    }
    const p1 = store.listHistory({ page: 1 })
    expect(p1.items).toHaveLength(20)
    expect(p1.nextPage).toBe(2)
    const p2 = store.listHistory({ page: 2 })
    expect(p2.items).toHaveLength(5)
    expect(p2.nextPage).toBeUndefined()
  })
})

describe("listFavorites", () => {
  test("orders by favorited_at desc and returns favorited_at", () => {
    const { store } = makeStore()
    seed(store)
    store.recordVisit("post", "10", "Ten", "u")
    store.addFavorite("post", "10")
    const res = store.listFavorites({})
    expect(res.items.map((i) => i.id)).toEqual(["10", "2"])
    expect(res.items[0]?.favorited_at).toBeDefined()
    expect(res.items.every((i) => i.favorited)).toBe(true)
  })

  test("searches within favorites", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listFavorites({ q: "beta" }).items.map((i) => i.id)).toEqual([
      "2",
    ])
  })
})

describe("listTags", () => {
  test("counts desc, tie by tag asc", () => {
    const { store } = makeStore()
    seed(store)
    store.setTags("book", "2", ["科幻", "历史"])
    const res = store.listTags()
    expect(res).toEqual([
      { tag: "科幻", count: 2 },
      { tag: "历史", count: 1 },
      { tag: "随笔", count: 1 },
    ])
  })
})

describe("listByTag", () => {
  test("filters exactly by tag, then q and kind", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listByTag("科幻", {}).items.map((i) => i.id)).toEqual(["1"])
    expect(store.listByTag("科", {}).items).toHaveLength(0) // 精确匹配
    expect(store.listByTag("科幻", { kind: "book" }).items).toHaveLength(0)
  })
})
