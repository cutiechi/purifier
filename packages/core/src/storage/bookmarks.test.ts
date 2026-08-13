import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "purifier-bm-"))
}

test("addBookmark round-trip; missing item is not_found", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1000)
  expect(
    store.addBookmark({
      site: "1",
      kind: "post",
      id: "t1",
      quote: "hello",
      scrollProgress: 0.4,
    })
  ).toEqual({ ok: false, reason: "not_found" })
  store.recordVisit("1", "post", "t1", "Title", "/read/t1")
  expect(
    store.addBookmark({
      site: "1",
      kind: "post",
      id: "t1",
      quote: "   ",
      scrollProgress: 0,
    })
  ).toEqual({ ok: false, reason: "invalid_quote" })
  const added = store.addBookmark({
    site: "1",
    kind: "post",
    id: "t1",
    quote: "  hello\nworld  ",
    note: "  n  ",
    scrollProgress: 1.5,
  })
  expect(added.ok).toBe(true)
  if (!added.ok) return
  expect(added.bookmark.quote).toBe("hello world")
  expect(added.bookmark.note).toBe("n")
  expect(added.bookmark.scrollProgress).toBe(1)
  expect(added.bookmark.chapter).toBeNull()
  expect(store.listItemBookmarks("1", "post", "t1")).toHaveLength(1)

  // 码点截断：quote 截到 200 码点、note 截到 80 码点（"😀" 1 码点 = 2 个 UTF-16 单元，验证按码点而非按单元截断）
  const truncated = store.addBookmark({
    site: "1",
    kind: "post",
    id: "t1",
    quote: "😀".repeat(250),
    note: "n".repeat(100),
    scrollProgress: 0,
  })
  expect(truncated.ok).toBe(true)
  if (!truncated.ok) return
  expect(truncated.bookmark.quote).toBe("😀".repeat(200))
  expect(truncated.bookmark.note).toBe("n".repeat(80))
  expect(Array.from(truncated.bookmark.quote)).toHaveLength(200)
  rmSync(dir, { recursive: true, force: true })
})

test("cap 50 per post/chapter; book chapters are separate", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("2", "book", "X", "X", "/book/X")
  for (let i = 0; i < 50; i++) {
    const r = store.addBookmark({
      site: "2",
      kind: "book",
      id: "X",
      quote: `q${i}`,
      scrollProgress: 0,
      chapter: 1,
    })
    expect(r.ok).toBe(true)
  }
  expect(
    store.addBookmark({
      site: "2",
      kind: "book",
      id: "X",
      quote: "overflow",
      scrollProgress: 0,
      chapter: 1,
    })
  ).toEqual({ ok: false, reason: "full" })
  const ch2 = store.addBookmark({
    site: "2",
    kind: "book",
    id: "X",
    quote: "other chapter",
    scrollProgress: 0,
    chapter: 2,
  })
  expect(ch2.ok).toBe(true)
  expect(store.listItemBookmarks("2", "book", "X", 1)).toHaveLength(50)
  expect(store.listItemBookmarks("2", "book", "X", 2)).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})

test("deleteItem and clearHistory cascade bookmarks", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("1", "post", "a", "A", "/read/a")
  store.recordVisit("1", "post", "b", "B", "/read/b")
  store.addBookmark({
    site: "1",
    kind: "post",
    id: "a",
    quote: "qa",
    scrollProgress: 0,
  })
  store.addBookmark({
    site: "1",
    kind: "post",
    id: "b",
    quote: "qb",
    scrollProgress: 0,
  })
  store.deleteItem("1", "post", "a")
  expect(store.listItemBookmarks("1", "post", "a")).toHaveLength(0)
  expect(store.listItemBookmarks("1", "post", "b")).toHaveLength(1)
  store.clearHistory()
  expect(store.listBookmarks({ page: 1 }).total).toBe(0)
  rmSync(dir, { recursive: true, force: true })
})

test("listBookmarks searches quote note title; update and delete note", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("1", "post", "t1", "Alpha", "/read/t1")
  const added = store.addBookmark({
    site: "1",
    kind: "post",
    id: "t1",
    quote: "needle quote",
    note: "memo",
    scrollProgress: 0.2,
  })
  expect(added.ok).toBe(true)
  if (!added.ok) return
  expect(store.listBookmarks({ q: "needle" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "memo" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "Alpha" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "zzz" }).items).toHaveLength(0)
  expect(store.updateBookmarkNote(added.bookmark.id, "")).toBe(true)
  expect(store.listItemBookmarks("1", "post", "t1")[0]?.note).toBe("")
  expect(store.deleteBookmark(added.bookmark.id)).toBe(true)
  expect(store.deleteBookmark(added.bookmark.id)).toBe(false)
  rmSync(dir, { recursive: true, force: true })
})
