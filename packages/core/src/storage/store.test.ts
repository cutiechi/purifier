import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"

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
