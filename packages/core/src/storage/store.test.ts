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
})
