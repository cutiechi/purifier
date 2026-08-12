import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExtractorError } from "../extractor/types"
import { openDatabase } from "./db"
import { Store } from "./store"

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-chars-"))
  const store = new Store(openDatabase(dir))
  return { dir, store }
}

describe("characters", () => {
  test("resolve post without group → post scope", () => {
    const { dir, store } = tempStore()
    expect(store.resolveCharacterScope("post", "42")).toEqual({
      type: "post",
      id: "42",
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("resolve post in group → group scope", () => {
    const { dir, store } = tempStore()
    const g = store.upsertGroup({
      key: "k",
      title: "T",
      items: [{ tid: "42", title: "ch1" }],
    })
    expect(store.resolveCharacterScope("post", "42")).toEqual({
      type: "group",
      id: String(g.id),
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("resolve book → book scope", () => {
    const { dir, store } = tempStore()
    expect(store.resolveCharacterScope("book", "MjI")).toEqual({
      type: "book",
      id: "MjI",
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("addCharacter color_index starts at 0 and increments", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    expect(store.addCharacter(scope, "甲").colorIndex).toBe(0)
    expect(store.addCharacter(scope, "乙").colorIndex).toBe(1)
    const again = store.addCharacter(scope, "甲")
    expect(again.colorIndex).toBe(0) // 幂等不改色
    expect(store.listCharacters(scope)).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("removeCharacter and empty MAX resets", () => {
    const { dir, store } = tempStore()
    const scope = { type: "book" as const, id: "c1" }
    store.addCharacter(scope, "甲")
    store.addCharacter(scope, "乙")
    expect(store.removeCharacter(scope, "甲")).toBe(1)
    expect(store.removeCharacter(scope, "甲")).toBe(0)
    store.removeCharacter(scope, "乙")
    expect(store.addCharacter(scope, "丙").colorIndex).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteGroupCascade clears group characters", () => {
    const { dir, store } = tempStore()
    const g = store.upsertGroup({
      key: "k",
      title: "T",
      items: [{ tid: "1", title: "a" }],
    })
    const scope = { type: "group" as const, id: String(g.id) }
    store.addCharacter(scope, "甲")
    store.deleteGroup(g.id)
    expect(store.listCharacters(scope)).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test("remove last item auto-deletes group characters", () => {
    const { dir, store } = tempStore()
    const g = store.upsertGroup({
      key: "k",
      title: "T",
      items: [{ tid: "1", title: "a" }],
    })
    store.addCharacter({ type: "group", id: String(g.id) }, "甲")
    const r = store.removeGroupItems(g.id, ["1"])
    expect(r.deleted).toBe(true)
    expect(store.listCharacters({ type: "group", id: String(g.id) })).toEqual(
      []
    )
    rmSync(dir, { recursive: true, force: true })
  })

  test("upsertGroup cross-group tid throws 409 and rolls back whole batch", () => {
    const { dir, store } = tempStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "1", title: "x" }],
    })
    expect(() =>
      store.upsertGroup({
        key: "b",
        title: "B",
        items: [
          { tid: "1", title: "冲突" },
          { tid: "2", title: "应一并回滚" },
        ],
      })
    ).toThrow(ExtractorError)
    try {
      store.upsertGroup({
        key: "b",
        title: "B",
        items: [
          { tid: "1", title: "冲突" },
          { tid: "2", title: "应一并回滚" },
        ],
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractorError)
      expect((e as ExtractorError).statusCode).toBe(409)
    }
    // 整批回滚：组 b 不应存在，tid 2 也不应进任何组
    expect(store.listGroups().map((g) => g.key)).toEqual(["a"])
    const orphan = store.listGroups().flatMap((g) => g.items.map((i) => i.tid))
    expect(orphan).toEqual(["1"])
    expect(store.resolveCharacterScope("post", "2").type).toBe("post")
    rmSync(dir, { recursive: true, force: true })
  })

  test("upsertGroup same-group duplicate is idempotent", () => {
    const { dir, store } = tempStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "1", title: "old" }],
    })
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "1", title: "new" }],
    })
    expect(g.items).toEqual([{ tid: "1", title: "old" }])
    rmSync(dir, { recursive: true, force: true })
  })

  test("leaving group restores post scope names", () => {
    const { dir, store } = tempStore()
    store.addCharacter({ type: "post", id: "1" }, "独有")
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "1", title: "x" }],
    })
    store.addCharacter({ type: "group", id: String(g.id) }, "组内")
    expect(store.resolveCharacterScope("post", "1").type).toBe("group")
    expect(
      store
        .listCharacters(store.resolveCharacterScope("post", "1"))
        .map((c) => c.name)
    ).toEqual(["组内"])
    store.removeGroupItems(g.id, ["1"])
    expect(store.resolveCharacterScope("post", "1")).toEqual({
      type: "post",
      id: "1",
    })
    expect(
      store.listCharacters({ type: "post", id: "1" }).map((c) => c.name)
    ).toEqual(["独有"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("exportBackup includes character_names", () => {
    const { dir, store } = tempStore()
    store.addCharacter({ type: "post", id: "9" }, "甲")
    const bak = store.exportBackup()
    expect(Array.isArray(bak.character_names)).toBe(true)
    expect(bak.character_names.length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
