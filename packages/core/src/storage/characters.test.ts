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

  test("addCharacter creates cluster hue 85 then a different hue", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "甲")
    expect(a.hue).toBe(85)
    expect(a.names).toEqual(["甲"])
    const b = store.addCharacter(scope, "乙")
    expect(b.hue).not.toBe(a.hue)
    expect(store.addCharacter(scope, "甲").id).toBe(a.id) // 幂等
    expect(store.listClusters(scope)).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("addCharacter with clusterId inherits hue", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "林远")
    const b = store.addCharacter(scope, "少爷", a.id)
    expect(b.id).toBe(a.id)
    expect(b.hue).toBe(a.hue)
    expect(b.names).toEqual(["林远", "少爷"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("addCharacter cross-cluster name is 409", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    store.addCharacter(scope, "甲")
    const b = store.addCharacter(scope, "乙")
    expect(() => store.addCharacter(scope, "甲", b.id)).toThrow(ExtractorError)
    rmSync(dir, { recursive: true, force: true })
  })

  test("remove last name prunes empty cluster", () => {
    const { dir, store } = tempStore()
    const scope = { type: "book" as const, id: "c1" }
    store.addCharacter(scope, "甲")
    store.addCharacter(scope, "乙")
    expect(store.removeCharacter(scope, "甲")).toBe(1)
    expect(store.removeCharacter(scope, "甲")).toBe(0)
    store.removeCharacter(scope, "乙")
    expect(store.listClusters(scope)).toEqual([])
    expect(store.addCharacter(scope, "丙").hue).toBe(85)
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
    expect(store.listClusters(scope)).toEqual([])
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
    expect(store.listClusters({ type: "group", id: String(g.id) })).toEqual([])
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
        .listClusters(store.resolveCharacterScope("post", "1"))
        .flatMap((c) => c.names)
    ).toEqual(["组内"])
    store.removeGroupItems(g.id, ["1"])
    expect(store.resolveCharacterScope("post", "1")).toEqual({
      type: "post",
      id: "1",
    })
    expect(
      store.listClusters({ type: "post", id: "1" }).flatMap((c) => c.names)
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

  test("exportBackup includes character_clusters version 2", () => {
    const { dir, store } = tempStore()
    store.addCharacter({ type: "post", id: "9" }, "甲")
    const bak = store.exportBackup()
    expect(bak.version).toBe(2)
    expect(bak.character_clusters.length).toBe(1)
    expect(bak.character_names[0]).toHaveProperty("cluster_id")
    expect(bak.character_names[0]).not.toHaveProperty("color_index")
    rmSync(dir, { recursive: true, force: true })
  })

  test("inventory characters counts names not clusters", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "林远")
    store.addCharacter(scope, "少爷", a.id)
    expect(store.getStats().inventory.characters).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("mergeClusters moves names to min id and sets hue", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "甲")
    const b = store.addCharacter(scope, "乙")
    const out = store.mergeClusters(scope, [b.id, a.id], 10)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe(Math.min(a.id, b.id))
    expect(out[0]!.hue).toBe(10)
    expect(out[0]!.names.sort()).toEqual(["乙", "甲"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("splitCharacter assigns a new hue", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "林远")
    store.addCharacter(scope, "少爷", a.id)
    const out = store.splitCharacter(scope, a.id, "少爷")
    expect(out).toHaveLength(2)
    const orig = out.find((c) => c.names.includes("林远"))!
    const neu = out.find((c) => c.names.includes("少爷"))!
    expect(neu.id).not.toBe(orig.id)
    expect(neu.hue).not.toBe(orig.hue)
    rmSync(dir, { recursive: true, force: true })
  })

  test("split singleton is 400", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "甲")
    expect(() => store.splitCharacter(scope, a.id, "甲")).toThrow(
      ExtractorError
    )
    rmSync(dir, { recursive: true, force: true })
  })

  test("recolorCluster only changes that cluster", () => {
    const { dir, store } = tempStore()
    const scope = { type: "post" as const, id: "1" }
    const a = store.addCharacter(scope, "甲")
    const b = store.addCharacter(scope, "乙")
    store.recolorCluster(scope, a.id, 33)
    expect(store.getCluster(scope, a.id).hue).toBe(33)
    expect(store.getCluster(scope, b.id).hue).toBe(b.hue)
    rmSync(dir, { recursive: true, force: true })
  })
})
