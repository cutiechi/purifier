import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertSafeId,
  clearCache,
  contentCachePath,
  readContentCache,
  readRepliesCache,
  repliesCachePath,
  writeContentCache,
  writeRepliesCache,
} from "./cache"
import { ExtractorError } from "../extractor/types"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "purifier-cache-"))
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "purifier-cache-"))
})

describe("assertSafeId", () => {
  test("rejects path traversal / invalid chars", () => {
    for (const bad of ["a/b", "../x", "x y", "", "a.b"]) {
      expect(() => assertSafeId(bad)).toThrow(ExtractorError)
    }
    for (const ok of ["1", "a1B2", "12345"]) {
      expect(() => assertSafeId(ok)).not.toThrow()
    }
  })
})

describe("content cache", () => {
  test("write → read round-trip with metadata", async () => {
    const dir = tempDir()
    await writeContentCache(dir, "1", "post", "10", "<html>hi</html>")
    const hit = await readContentCache(dir, "1", "post", "10")
    expect(hit?.data).toBe("<html>hi</html>")
    expect(hit?.sizeBytes).toBeGreaterThan(0)
    expect(hit?.mtimeMs).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("missing file returns null", async () => {
    const dir = tempDir()
    expect(await readContentCache(dir, "1", "post", "999")).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("overwrite replaces content", async () => {
    const dir = tempDir()
    await writeContentCache(dir, "1", "book", "2", "v1")
    await writeContentCache(dir, "1", "book", "2", "v2")
    expect((await readContentCache(dir, "1", "book", "2"))?.data).toBe("v2")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("content cache site + chapter", () => {
  test("same cid different site does not collide", async () => {
    await writeContentCache(dir, "1", "book", "X", "cool18-html")
    await writeContentCache(dir, "2", "book", "X", "xbook-html")
    expect((await readContentCache(dir, "1", "book", "X"))!.data).toBe(
      "cool18-html"
    )
    expect((await readContentCache(dir, "2", "book", "X"))!.data).toBe(
      "xbook-html"
    )
  })
  test("toc vs chapter different files", async () => {
    await writeContentCache(dir, "2", "book", "X", "toc")
    await writeContentCache(dir, "2", "book", "X", "ch1", 1)
    expect((await readContentCache(dir, "2", "book", "X"))!.data).toBe("toc")
    expect((await readContentCache(dir, "2", "book", "X", 1))!.data).toBe("ch1")
  })
  test("invalid site rejected", async () => {
    expect(() => writeContentCache(dir, "../evil", "book", "X", "h")).toThrow()
  })
})

describe("replies cache", () => {
  test("stores empty array too", async () => {
    const dir = tempDir()
    await writeRepliesCache(dir, "1", "10", [])
    expect(await readRepliesCache(dir, "1", "10")).not.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("clearCache", () => {
  test("removes all files and is idempotent", async () => {
    const dir = tempDir()
    await writeContentCache(dir, "1", "post", "1", "a")
    await writeContentCache(dir, "1", "book", "2", "b")
    await writeRepliesCache(dir, "1", "1", [])
    expect(await clearCache(dir)).toBe(3)
    expect(await clearCache(dir)).toBe(0)
    expect(await readContentCache(dir, "1", "post", "1")).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
