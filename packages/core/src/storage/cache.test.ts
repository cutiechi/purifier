import { describe, expect, test } from "bun:test"
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
    await writeContentCache(dir, "post", "10", "<html>hi</html>")
    const hit = await readContentCache(dir, "post", "10")
    expect(hit?.data).toBe("<html>hi</html>")
    expect(hit?.sizeBytes).toBeGreaterThan(0)
    expect(hit?.mtimeMs).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("missing file returns null", async () => {
    const dir = tempDir()
    expect(await readContentCache(dir, "post", "999")).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("overwrite replaces content", async () => {
    const dir = tempDir()
    await writeContentCache(dir, "book", "2", "v1")
    await writeContentCache(dir, "book", "2", "v2")
    expect((await readContentCache(dir, "book", "2"))?.data).toBe("v2")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("replies cache", () => {
  test("stores empty array too", async () => {
    const dir = tempDir()
    await writeRepliesCache(dir, "10", [])
    expect(await readRepliesCache(dir, "10")).not.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("clearCache", () => {
  test("removes all files and is idempotent", async () => {
    const dir = tempDir()
    await writeContentCache(dir, "post", "1", "a")
    await writeContentCache(dir, "book", "2", "b")
    await writeRepliesCache(dir, "1", [])
    expect(await clearCache(dir)).toBe(3)
    expect(await clearCache(dir)).toBe(0)
    expect(await readContentCache(dir, "post", "1")).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
