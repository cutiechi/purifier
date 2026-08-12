# 阅读页人物名称标记与高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读页选中人名并持久化到 SQLite，按 group/post/book 作用域全文高亮；论坛一帖一组。

**Architecture:** `character_names` 表存名单；`Store` 解析作用域并 CRUD；API `/api/me/characters`；纯函数 `characterHighlight`（DOMPurify 之后注入 `<mark class="character-mark--N">`）；前端选区浮条 + 人物面板。不改上游清洗与 DOMPurify 白名单。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19、Tailwind 4、DOMPurify、lucide-react。

**Spec:** `docs/superpowers/specs/2026-08-12-character-highlight-design.md`

**状态：** 已按 `docs/superpowers/plans/review.md` 修订（B1/B3/I2/I4/I5/I6/I8 + S 系列）

## Global Constraints

- Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 验证：`bun run test` / `bun run typecheck` / `bun run build`。
- `/api/me/*` 用 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`。
- **不引入 `site`**；不改 `extractPreHtml` / `sanitizeContentHtml` / DOMPurify 配置。
- `color_index` 存单调递增原值；渲染 `color_index % COLOR_COUNT`；`COLOR_COUNT = 6`。
- `scope_id` 一律 TEXT；group 用 `String(group_id)`。
- 组件不做单测；纯函数与 store 进 `bun test`。
- web / API 一律 `from "@workspace/core/character-highlight"`；**`packages/core/src/index.ts` 不 re-export**（仅 package.json 子路径）。
- Dark 模式：项目用 `@custom-variant dark (&:is(.dark *))` + `.dark {…}`（`globals.css`），人物色块写 `.dark .character-mark--N`，**不要**用 `prefers-color-scheme`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/storage/db.ts` | DDL `character_names`；`group_items.tid` UNIQUE 迁移 |
| `packages/core/src/storage/types.ts` | `CharacterScope` / `CharacterName` 类型 |
| `packages/core/src/storage/store.ts` | 作用域解析、CRUD、cascade、upsert 409、export |
| `packages/core/src/character-highlight.ts` | `normalizeCharacterName` / `characterHighlight` / `COLOR_COUNT` |
| `packages/core/package.json` | 子路径 export |
| `apps/api/src/index.ts` | `/api/me/characters`；groups 409 |
| `AGENTS.md` | API 表 |
| `apps/web/package.json` | 依赖 `@workspace/core` |
| `apps/web/src/lib/routes.ts` | `api.meCharacters` |
| `packages/ui/src/styles/globals.css` | `.character-mark--0..5` |
| `apps/web/src/hooks/use-characters.ts` | 拉名单 / 增删 / 高亮开关 |
| `apps/web/src/components/character-panel.tsx` | 人物面板 |
| `apps/web/src/components/character-selection-toolbar.tsx` | 选区浮条（仅 mouseup 选区） |
| `apps/web/src/components/character-mark-popover.tsx` | 点 mark 后的取消浮层（独立组件） |
| `apps/web/src/components/article-view.tsx` | ContentBody / ArticleView 高亮 props |
| `apps/web/src/components/item-actions.tsx` | Settings Popover 内「人物」section |
| `apps/web/src/pages/ReadPage.tsx` / `BookPage.tsx` | 接线 |

---

### Task 1: DDL + tid UNIQUE 迁移

**Files:**
- Modify: `packages/core/src/storage/db.ts`
- Modify: `packages/core/src/storage/store.test.ts`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `openDatabase()` 保证存在 `character_names` 表；`group_items` 上有唯一索引 `group_items_tid_unique`

- [ ] **Step 1: 写失败测试**

**必须先改**已有 `creates items/favorites/tags/groups tables` 的完整期望数组（精确相等，漏改会立刻红）：

```ts
expect(rows.map((r) => r.name)).toEqual([
  "archive_cursors",
  "archive_posts",
  "character_names", // ← 按字母序插在 archive_posts 与 favorites 之间
  "favorites",
  "group_items",
  "groups",
  "items",
  "job_logs",
  "jobs",
  "tags",
])
```

并追加：

```ts
test("character_names table and group_items tid unique", () => {
  const dir = tempDir()
  const db = openDatabase(dir)
  const ddl = db
    .query(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='character_names'"
    )
    .get() as { sql: string } | null
  expect(ddl?.sql).toMatch(/color_index/)
  expect(ddl?.sql).toMatch(/PRIMARY\s+KEY\s*\(\s*scope_type,\s*scope_id,\s*name/i)

  const idx = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='group_items_tid_unique'"
    )
    .get() as { name: string } | null
  expect(idx?.name).toBe("group_items_tid_unique")

  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test("migrates duplicate group_items tids keeping min group_id", () => {
  const dir = tempDir()
  // tempDir() 已是存在的空目录，不要再 mkdirSync
  const dbPath = join(dir, "purifier.db")
  const raw = new Database(dbPath)
  raw.exec(`
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT, genre TEXT,
      favorited INTEGER NOT NULL DEFAULT 0,
      favorited_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE group_items (
      group_id INTEGER NOT NULL,
      tid TEXT NOT NULL,
      title TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, tid)
    );
    INSERT INTO groups (id, key, title, favorited, created_at, updated_at)
      VALUES (1, 'a', 'A', 0, 1, 1), (2, 'b', 'B', 0, 1, 1);
    INSERT INTO group_items (group_id, tid, title, added_at) VALUES
      (1, '100', 'x', 1), (2, '100', 'y', 1);
  `)
  raw.close()

  const db = openDatabase(dir)
  const rows = db
    .query("SELECT group_id, tid FROM group_items WHERE tid='100'")
    .all() as { group_id: number; tid: string }[]
  expect(rows).toEqual([{ group_id: 1, tid: "100" }])
  const idx = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='group_items_tid_unique'"
    )
    .get()
  expect(idx).toBeTruthy()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
```

**实施提示（B2）：** 迁移不可逆。对真实 `data/purifier.db` 动手前可先跑  
`SELECT tid, COUNT(*) AS n FROM group_items GROUP BY tid HAVING n > 1;`  
确认重复量；当前无 `site` 列，与 spec YAGNI 一致。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: FAIL（缺表 / 缺索引）

- [ ] **Step 3: 实现 DDL + 迁移**

在 `db.ts` 的 `DDL` 末尾（`archive_cursors` 之后）追加：

```sql
CREATE TABLE IF NOT EXISTS character_names (
  scope_type  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  color_index INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id, name)
);
```

在 `openDatabase` 中、`return db` 之前追加迁移：

```ts
  // group_items.tid 全局唯一（一帖一组）
  const tidUnique = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='group_items_tid_unique'"
    )
    .get()
  if (!tidUnique) {
    db.transaction(() => {
      const before = (
        db.query("SELECT COUNT(*) AS n FROM group_items").get() as { n: number }
      ).n
      db.exec(`
        DELETE FROM group_items
        WHERE rowid NOT IN (
          SELECT MIN(rowid) FROM group_items GROUP BY tid
        )
      `)
      const after = (
        db.query("SELECT COUNT(*) AS n FROM group_items").get() as { n: number }
      ).n
      const removed = before - after
      if (removed > 0) {
        console.log(
          `[db] removed ${removed} duplicate group_items rows for tid UNIQUE`
        )
      }
      db.exec(
        "CREATE UNIQUE INDEX group_items_tid_unique ON group_items(tid)"
      )
    })()
  }
```

新库：`CREATE TABLE IF NOT EXISTS character_names` 已由 `db.exec(DDL)` 覆盖；UNIQUE 索引用上面幂等块创建（新库无重复）。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add character_names table and unique group tid"
```

---

### Task 2: Store CRUD、作用域、cascade、upsert 409、export

**Files:**
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/store.ts`
- Create: `packages/core/src/storage/characters.test.ts`
- Modify: `packages/core/src/storage/groups.test.ts`（跨组 409 / cascade）

**Interfaces:**
- Consumes: `character_names` 表；`ExtractorError`
- Produces:
  - `type CharacterScopeType = "group" | "post" | "book"`
  - `interface CharacterScope { type: CharacterScopeType; id: string }`
  - `interface CharacterName { name: string; colorIndex: number }`
  - `resolveCharacterScope(kind: ItemKind, id: string): CharacterScope`
  - `listCharacters(scope: CharacterScope): CharacterName[]`
  - `addCharacter(scope: CharacterScope, name: string): CharacterName`
  - `removeCharacter(scope: CharacterScope, name: string): number`
  - `deleteGroupCascade(id: number): void`（替换/被 `deleteGroup` 与空组删除调用）
  - `upsertGroup`：跨组 tid → throw `ExtractorError(..., 409)`
  - `exportBackup()` 含 `character_names`

- [ ] **Step 1: 写失败测试** `characters.test.ts`

```ts
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
    store.addCharacter(
      { type: "group", id: String(g.id) },
      "甲"
    )
    const r = store.removeGroupItems(g.id, ["1"])
    expect(r.deleted).toBe(true)
    expect(
      store.listCharacters({ type: "group", id: String(g.id) })
    ).toEqual([])
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
    const orphan = store
      .listGroups()
      .flatMap((g) => g.items.map((i) => i.tid))
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
      store.listCharacters(store.resolveCharacterScope("post", "1")).map(
        (c) => c.name
      )
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/characters.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 类型 + Store 实现**

`types.ts` 追加：

```ts
export type CharacterScopeType = "group" | "post" | "book"

export interface CharacterScope {
  type: CharacterScopeType
  id: string
}

export interface CharacterName {
  name: string
  colorIndex: number
}
```

`store.ts`：从 `../extractor/types` 引入 `ExtractorError`；实现上述方法。要点：

```ts
resolveCharacterScope(kind: ItemKind, id: string): CharacterScope {
  if (kind === "book") return { type: "book", id }
  const row = this.db
    .query("SELECT group_id FROM group_items WHERE tid = ?1 LIMIT 1")
    .get(id) as { group_id: number } | null
  if (row) return { type: "group", id: String(row.group_id) }
  return { type: "post", id }
}

listCharacters(scope: CharacterScope): CharacterName[] {
  const rows = this.db
    .query(
      `SELECT name, color_index FROM character_names
       WHERE scope_type = ?1 AND scope_id = ?2
       ORDER BY created_at, name`
    )
    .all(scope.type, scope.id) as { name: string; color_index: number }[]
  return rows.map((r) => ({ name: r.name, colorIndex: r.color_index }))
}

addCharacter(scope: CharacterScope, name: string): CharacterName {
  const existing = this.db
    .query(
      `SELECT name, color_index FROM character_names
       WHERE scope_type = ?1 AND scope_id = ?2 AND name = ?3`
    )
    .get(scope.type, scope.id, name) as
    | { name: string; color_index: number }
    | null
  if (existing) {
    return { name: existing.name, colorIndex: existing.color_index }
  }
  const maxRow = this.db
    .query(
      `SELECT MAX(color_index) AS m FROM character_names
       WHERE scope_type = ?1 AND scope_id = ?2`
    )
    .get(scope.type, scope.id) as { m: number | null }
  const colorIndex = (maxRow.m ?? -1) + 1
  this.db
    .query(
      `INSERT INTO character_names
         (scope_type, scope_id, name, color_index, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .run(scope.type, scope.id, name, colorIndex, this.now())
  return { name, colorIndex }
}

removeCharacter(scope: CharacterScope, name: string): number {
  return Number(
    this.db
      .query(
        `DELETE FROM character_names
         WHERE scope_type = ?1 AND scope_id = ?2 AND name = ?3`
      )
      .run(scope.type, scope.id, name).changes ?? 0
  )
}

deleteGroupCascade(id: number): void {
  this.db
    .query(
      `DELETE FROM character_names
       WHERE scope_type = 'group' AND scope_id = ?1`
    )
    .run(String(id))
  this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
  this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
}
```

将 `deleteGroup` 改为调用 `deleteGroupCascade`（可包在 transaction 里）。

**`removeGroupItems` 签名与返回值不变**：仍返回 `{ removed: number; deleted: boolean }`。仅把空组分支里原先手写的两行 `DELETE group_items` / `DELETE groups` **替换为** `this.deleteGroupCascade(id)`（仍设 `deleted = true`）。非空分支的 `UPDATE updated_at` 逻辑不动。

`upsertGroup` 在 insert 循环前（整个函数仍在 `transaction` 内；抛 409 则**整批回滚**，含同请求里其它未冲突 tid）：

```ts
for (const it of input.items) {
  const other = this.db
    .query(
      `SELECT group_id FROM group_items
       WHERE tid = ?1 AND group_id <> ?2`
    )
    .get(it.tid, row.id) as { group_id: number } | null
  if (other) {
    throw new ExtractorError("tid already in another group", 409)
  }
}
// 然后保持 INSERT OR IGNORE
```

`exportBackup` 增加：

```ts
const character_names = this.db
  .query("SELECT * FROM character_names ORDER BY scope_type, scope_id, name")
  .all()
// return { ..., character_names }
```

并更新返回类型。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/storage/characters.test.ts src/storage/groups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/store.ts \
  packages/core/src/storage/characters.test.ts packages/core/src/storage/groups.test.ts
git commit -m "feat(core): character names store CRUD and one-tid-one-group"
```

---

### Task 3: `characterHighlight` 纯函数

**Files:**
- Create: `packages/core/src/character-highlight.ts`
- Create: `packages/core/src/character-highlight.test.ts`
- Modify: `packages/core/package.json`（exports）
- **不修改** `packages/core/src/index.ts`（不 re-export，仅子路径）

**Interfaces:**
- Produces:
  - `export const COLOR_COUNT = 6`
  - `export function normalizeCharacterName(raw: string): string | null`
  - `export function characterHighlight(html: string, characters: { name: string; colorIndex: number }[]): string`
  - `export function colorSlot(colorIndex: number): number` → `colorIndex % COLOR_COUNT`
  - `export type { CharacterName, CharacterScope } from "./storage/types"`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import {
  COLOR_COUNT,
  characterHighlight,
  colorSlot,
  normalizeCharacterName,
} from "./character-highlight"

describe("normalizeCharacterName", () => {
  test("trims and rejects newlines/tabs/empty/overlong", () => {
    expect(normalizeCharacterName(" 甲 ")).toBe("甲")
    expect(normalizeCharacterName("甲\n乙")).toBeNull()
    expect(normalizeCharacterName("甲\t乙")).toBeNull()
    expect(normalizeCharacterName("   ")).toBeNull()
    expect(normalizeCharacterName("x".repeat(33))).toBeNull()
  })
})

describe("characterHighlight", () => {
  test("wraps longest name first", () => {
    const html = "<p>王小明和王小</p>"
    const out = characterHighlight(html, [
      { name: "王小", colorIndex: 0 },
      { name: "王小明", colorIndex: 1 },
    ])
    expect(out).toContain(
      '<mark class="character-mark character-mark--1">王小明</mark>'
    )
    expect(out).not.toMatch(/character-mark--0">王小<\/mark>明/)
  })

  test("does not break anchors", () => {
    const html = '<p>见<a href="/read/1">王芳</a>来</p>'
    const out = characterHighlight(html, [
      { name: "王芳", colorIndex: 2 },
    ])
    expect(out).toBe(
      '<p>见<a href="/read/1"><mark class="character-mark character-mark--2">王芳</mark></a>来</p>'
    )
  })

  test("name is never parsed as HTML / does not match escaped entities", () => {
    // DOMPurify 后文本是实体；选区 name 是未转义字面量 → 不匹配（期望）
    const out = characterHighlight("<p>x&lt;/mark&gt;y</p>", [
      { name: "</mark>", colorIndex: 0 },
    ])
    expect(out).toBe("<p>x&lt;/mark&gt;y</p>")

    const out2 = characterHighlight("<p>a&quot;b</p>", [
      { name: 'a"b', colorIndex: 0 },
    ])
    expect(out2).toBe("<p>a&quot;b</p>")

    const out3 = characterHighlight("<p>a&lt;b</p>", [
      { name: "a<b", colorIndex: 0 },
    ])
    expect(out3).toBe("<p>a&lt;b</p>")
    expect(out3.includes("<mark")).toBe(false)
  })

  test("safe wrap for plain CJK names", () => {
    const out = characterHighlight("<p>你好甲世界</p>", [
      { name: "甲", colorIndex: 0 },
    ])
    expect(out).toBe(
      '<p>你好<mark class="character-mark character-mark--0">甲</mark>世界</p>'
    )
  })

  test("colorSlot wraps", () => {
    expect(colorSlot(0)).toBe(0)
    expect(colorSlot(6)).toBe(0)
    expect(COLOR_COUNT).toBe(6)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/character-highlight.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`character-highlight.ts`：

```ts
export type { CharacterName, CharacterScope } from "./storage/types"

export const COLOR_COUNT = 6

export function colorSlot(colorIndex: number): number {
  // color_index 来自 COALESCE(MAX,-1)+1，恒 ≥ 0
  return colorIndex % COLOR_COUNT
}

export function normalizeCharacterName(raw: string): string | null {
  if (/[\n\t]/.test(raw)) return null
  const name = raw.trim()
  if (name.length < 1 || name.length > 32) return null
  return name
}

/**
 * 输入约定：已 DOMPurify 净化的 HTML；文本节点中无裸 `<`
 *（`<` 已是 `&lt;`），因此用 `/(<[^>]*>)/` 切标签安全。
 * 复杂度约 O(正文长度 × 人名数 × 名字长度)；当前章节量级可接受，
 * 超长卡顿可后续换 Aho-Corasick。
 * 输出仅额外插入 <mark class="character-mark character-mark--N">；
 * 不把 name 写入属性。
 */
export function characterHighlight(
  html: string,
  characters: { name: string; colorIndex: number }[]
): string {
  const names = characters
    .filter((c) => c.name.length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.name.length - a.name.length || a.name.localeCompare(b.name)
    )
  if (!names.length) return html

  const parts = html.split(/(<[^>]*>)/)
  return parts
    .map((part) => {
      if (!part || part.startsWith("<")) return part
      return highlightText(part, names)
    })
    .join("")
}

function highlightText(
  text: string,
  names: { name: string; colorIndex: number }[]
): string {
  const taken = new Array<boolean>(text.length).fill(false)
  type Hit = { start: number; end: number; slot: number }
  const hits: Hit[] = []

  for (const { name, colorIndex } of names) {
    let from = 0
    while (from <= text.length - name.length) {
      const i = text.indexOf(name, from)
      if (i < 0) break
      const end = i + name.length
      let overlap = false
      for (let j = i; j < end; j++) {
        if (taken[j]) {
          overlap = true
          break
        }
      }
      if (!overlap) {
        for (let j = i; j < end; j++) taken[j] = true
        hits.push({ start: i, end, slot: colorSlot(colorIndex) })
      }
      from = i + 1
    }
  }

  hits.sort((a, b) => a.start - b.start)
  let out = ""
  let cursor = 0
  for (const h of hits) {
    out += text.slice(cursor, h.start)
    out += `<mark class="character-mark character-mark--${h.slot}">`
    out += text.slice(h.start, h.end)
    out += `</mark>`
    cursor = h.end
  }
  out += text.slice(cursor)
  return out
}
```

`package.json` exports 增加：

```json
"./character-highlight": "./src/character-highlight.ts"
```

**不要**改 `src/index.ts`。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/character-highlight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/character-highlight.ts \
  packages/core/src/character-highlight.test.ts packages/core/package.json
git commit -m "feat(core): characterHighlight pure function"
```

---

### Task 4: API `/api/me/characters` + groups 409 + AGENTS + routes

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `AGENTS.md`
- Modify: `apps/web/src/lib/routes.ts`

**Interfaces:**
- Consumes: Store 方法；`normalizeCharacterName`；`assertSafeId`
- Produces: `GET|PUT|DELETE /api/me/characters`

- [ ] **Step 1: 实现 handlers**（本仓无独立 API 测试基建；用手动 curl + typecheck。store 层已覆盖核心逻辑。）

在 `index.ts` 增加（靠近其它 me handlers）：

```ts
import { normalizeCharacterName } from "@workspace/core/character-highlight"

function parseMeKindId(kindRaw: unknown, idRaw: unknown): {
  kind: ItemKind
  id: string
} {
  if (kindRaw !== "post" && kindRaw !== "book") {
    throw new ExtractorError("invalid kind", 400)
  }
  if (typeof idRaw !== "string") throw new ExtractorError("invalid id", 400)
  assertSafeId(idRaw)
  return { kind: kindRaw, id: idRaw }
}

function handleCharactersGet(url: URL): Response {
  const { kind, id } = parseMeKindId(
    url.searchParams.get("kind"),
    url.searchParams.get("id")
  )
  const scope = store.resolveCharacterScope(kind, id)
  const characters = store.listCharacters(scope)
  return jsonOk({ scope, characters }, NO_STORE_HEADERS)
}

async function handleCharactersPut(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    throw new ExtractorError("invalid json body", 400)
  }
  const { kind, id } = parseMeKindId(
    "kind" in body ? body.kind : undefined,
    "id" in body ? body.id : undefined
  )
  const nameRaw = "name" in body ? body.name : undefined
  if (typeof nameRaw !== "string") {
    throw new ExtractorError("invalid name", 400)
  }
  const name = normalizeCharacterName(nameRaw)
  if (!name) throw new ExtractorError("invalid name", 400)
  const scope = store.resolveCharacterScope(kind, id)
  const character = store.addCharacter(scope, name)
  const characters = store.listCharacters(scope)
  return jsonOk({ ok: true, character, characters }, NO_STORE_HEADERS)
}

function handleCharactersDelete(url: URL): Response {
  const { kind, id } = parseMeKindId(
    url.searchParams.get("kind"),
    url.searchParams.get("id")
  )
  const nameRaw = url.searchParams.get("name") ?? ""
  const name = normalizeCharacterName(nameRaw)
  if (!name) throw new ExtractorError("invalid name", 400)
  const scope = store.resolveCharacterScope(kind, id)
  const removed = store.removeCharacter(scope, name)
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}
```

在 `switch` 增加：

```ts
case "/api/me/characters": {
  if (req.method === "GET") return handleCharactersGet(url)
  if (req.method === "PUT") return await handleCharactersPut(req)
  if (req.method === "DELETE") return handleCharactersDelete(url)
  throw new ExtractorError("method not allowed", 405)
}
```

`handleGroupUpsert`：`upsertGroup` 已抛 `ExtractorError` 409，外层 `toErrorResponse` 已映射——确认 `route`/`fetch` 路径会 catch（现有 `Bun.serve` fetch 应用了 `toErrorResponse`）。无需额外包装。

`routes.ts`：

```ts
meCharacters: "/api/me/characters",
```

`AGENTS.md` API 表追加三行（GET/PUT/DELETE `/api/me/characters`），并在 groups PUT 说明中注明 tid 跨组 409。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: 手动冒烟（可选，有 API 在跑时）**

```bash
# GET 空
curl -s 'http://127.0.0.1:3001/api/me/characters?kind=post&id=1'
# PUT
curl -s -X PUT http://127.0.0.1:3001/api/me/characters \
  -H 'content-type: application/json' \
  -d '{"kind":"post","id":"1","name":"甲"}'
# DELETE 后 GET 应无「甲」
curl -s -X DELETE 'http://127.0.0.1:3001/api/me/characters?kind=post&id=1&name=%E7%94%B2'
curl -s 'http://127.0.0.1:3001/api/me/characters?kind=post&id=1'
# 入组后再 GET，断言 scope.type === "group"（先 PUT /api/me/groups 再 GET characters）
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts apps/web/src/lib/routes.ts AGENTS.md
git commit -m "feat(api): /api/me/characters endpoints"
```

---

### Task 5: ContentBody 高亮 + CSS + web 依赖

**Files:**
- Modify: `apps/web/package.json`（加 `"@workspace/core": "workspace:*"`）
- Modify: `apps/web/src/components/article-view.tsx`
- Modify: `packages/ui/src/styles/globals.css`
- Create: `apps/web/src/hooks/use-characters.ts`

**Interfaces:**
- Consumes: `characterHighlight`, `colorSlot`, `COLOR_COUNT`, `api.meCharacters`
- Produces: `useCharacters(kind, id)`；`ContentBody` 接受 `characters` + `highlightEnabled` + `onCharacterClick`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun install
```

`apps/web/package.json` dependencies 增加 `"@workspace/core": "workspace:*"`。

- [ ] **Step 2: CSS**

Dark 模式已确认用 `.dark` 类（`@custom-variant dark (&:is(.dark *))`），色块用 `.dark .character-mark--N`。

在 `globals.css` `.reading-body` 块后追加：

```css
.reading-body mark.character-mark {
  color: inherit;
  border-radius: 0.15em;
  padding: 0 0.1em;
  background: var(--character-mark-bg);
}
.character-mark--0 { --character-mark-bg: oklch(0.92 0.06 85); }
.character-mark--1 { --character-mark-bg: oklch(0.92 0.06 160); }
.character-mark--2 { --character-mark-bg: oklch(0.92 0.06 220); }
.character-mark--3 { --character-mark-bg: oklch(0.92 0.06 300); }
.character-mark--4 { --character-mark-bg: oklch(0.92 0.06 30); }
.character-mark--5 { --character-mark-bg: oklch(0.92 0.06 350); }
.dark .character-mark--0 { --character-mark-bg: oklch(0.35 0.06 85); }
.dark .character-mark--1 { --character-mark-bg: oklch(0.35 0.06 160); }
.dark .character-mark--2 { --character-mark-bg: oklch(0.35 0.06 220); }
.dark .character-mark--3 { --character-mark-bg: oklch(0.35 0.06 300); }
.dark .character-mark--4 { --character-mark-bg: oklch(0.35 0.06 30); }
.dark .character-mark--5 { --character-mark-bg: oklch(0.35 0.06 350); }
```

- [ ] **Step 3: `use-characters.ts`**

```ts
import { useCallback, useEffect, useState } from "react"
import type {
  CharacterName,
  CharacterScope,
} from "@workspace/core/character-highlight"
import { api } from "@/lib/routes"

const HIGHLIGHT_KEY = "purifier:character-highlight"

export function useCharacterHighlightEnabled() {
  const [enabled, setEnabled] = useState(() => {
    try {
      const v = localStorage.getItem(HIGHLIGHT_KEY)
      return v !== "0"
    } catch {
      return true
    }
  })
  const set = useCallback((next: boolean) => {
    setEnabled(next)
    try {
      localStorage.setItem(HIGHLIGHT_KEY, next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [])
  return { enabled, setEnabled: set }
}

export function useCharacters(kind: "post" | "book", id: string) {
  const [characters, setCharacters] = useState<CharacterName[]>([])
  const [scope, setScope] = useState<CharacterScope | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `${api.meCharacters}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "加载人物失败")
        return
      }
      setScope(json.scope)
      setCharacters(json.characters ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载人物失败")
    } finally {
      setLoading(false)
    }
  }, [kind, id])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (name: string) => {
      const res = await fetch(api.meCharacters, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "标记失败")
      setCharacters(json.characters ?? [])
      return json as { characters: CharacterName[] }
    },
    [kind, id]
  )

  // 与 add 一致：乐观更新本地列表，失败再 reload 回滚（避免 loading 闪烁）
  const remove = useCallback(
    async (name: string) => {
      const prev = characters
      setCharacters((c) => c.filter((x) => x.name !== name))
      const q = new URLSearchParams({ kind, id, name })
      const res = await fetch(`${api.meCharacters}?${q}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) {
        setCharacters(prev)
        throw new Error(json.error || "删除失败")
      }
      return json as { removed: number }
    },
    [kind, id, characters]
  )

  return { characters, scope, error, loading, reload, add, remove }
}
```

- [ ] **Step 4: 改造 `ContentBody`**

```tsx
import {
  characterHighlight,
} from "@workspace/core/character-highlight"

export function ContentBody({
  html,
  characters = [],
  highlightEnabled = true,
  onCharacterClick,
}: {
  html: string
  characters?: { name: string; colorIndex: number }[]
  highlightEnabled?: boolean
  onCharacterClick?: (name: string, rect: DOMRect) => void
}) {
  const navigate = useNavigate()
  const safeHtml = useMemo(() => {
    const purified = sanitizeBodyHtml(html)
    if (!highlightEnabled || characters.length === 0) return purified
    return characterHighlight(purified, characters)
  }, [html, characters, highlightEnabled])

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const mark = target.closest("mark.character-mark")
      if (mark) {
        e.preventDefault()
        e.stopPropagation()
        const name = mark.textContent ?? ""
        if (name && onCharacterClick) {
          onCharacterClick(name, mark.getBoundingClientRect())
        }
        return
      }
      const a = target.closest("a")
      if (!a) return
      const href = a.getAttribute("href")
      if (!href?.startsWith("/read/") && !href?.startsWith("/book/")) return
      e.preventDefault()
      navigate(href)
    },
    [navigate, onCharacterClick]
  )

  return (
    <div
      className="reading-body text-foreground/85"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
      onClick={onClick}
    />
  )
}
```

`ArticleView` **显式新增 props**（全部可选，默认与现行为一致）：

```ts
export function ArticleView({
  title,
  meta,
  contentHtml,
  sourceUrl,
  currentTid,
  actions,
  footer,
  progress,
  characters,
  highlightEnabled,
  onCharacterClick,
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
  progress?: number
  characters?: { name: string; colorIndex: number }[]
  highlightEnabled?: boolean
  onCharacterClick?: (name: string, rect: DOMRect) => void
}) {
  // …现有结构…
  // <ContentBody
  //   html={contentHtml}
  //   characters={characters}
  //   highlightEnabled={highlightEnabled}
  //   onCharacterClick={onCharacterClick}
  // />
}
```

- [ ] **Step 5: typecheck + test**

Run: `bun run typecheck && bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/hooks/use-characters.ts \
  apps/web/src/components/article-view.tsx packages/ui/src/styles/globals.css
git commit -m "feat(web): wire character highlight into ContentBody"
```

---

### Task 6: 选区浮条 + 人物面板 + ItemActions / 页面接线

**Files:**
- Create: `apps/web/src/components/character-selection-toolbar.tsx`
- Create: `apps/web/src/components/character-mark-popover.tsx`
- Create: `apps/web/src/components/character-panel.tsx`
- Modify: `apps/web/src/components/item-actions.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`
- Modify: `apps/web/src/pages/BookPage.tsx`

**Interfaces:**
- Consumes: `useCharacters`、`useCharacterHighlightEnabled`、`normalizeCharacterName`、`ArticleView` 新 props
- Produces: 完整阅读页交互

- [ ] **Step 1: 选区浮条**（仅选中文字触发）

`character-selection-toolbar.tsx`：监听 `mouseup`；选区须在 `.reading-body` 内：

1. `normalizeCharacterName(selection.toString())` 为 null → 隐藏
2. 在选区 `getBoundingClientRect()` 上方 `fixed` 小条（`z-50`）
3. 已存在 →「取消标记」，否则「标记为人物」
4. Esc / scroll / 点空白关闭

```tsx
<div
  className="fixed z-50 rounded-lg border border-border bg-popover px-2 py-1 shadow-md"
  style={{ top, left }}
>
  <button type="button" onClick={onAction}>
    {exists ? "取消标记" : "标记为人物"}
  </button>
</div>
```

- [ ] **Step 2: mark 点击浮层**（独立组件，勿与选区浮条混用）

`character-mark-popover.tsx`：

```tsx
export function CharacterMarkPopover({
  name,
  rect,
  onRemove,
  onClose,
}: {
  name: string
  rect: DOMRect
  onRemove: () => void
  onClose: () => void
}) {
  // fixed 定位于 rect 上方；显示人名 + 「取消标记」
  // Esc / 点空白 → onClose
}
```

- [ ] **Step 3: 人物面板**

`character-panel.tsx`：`characters`、`enabled`、`setEnabled`、`onRemove`、`error`、`onRetry`。

- 开关「显示人物高亮」；色点 + 名 + 删除；空态引导；错误可重试

- [ ] **Step 4: ItemActions —— 复用现有 Settings Popover**

**不要**再加第二个独立 Popover（与现有 `Settings2` fixed 浮窗叠层冲突）。

在现有 `ItemActions` Popover 内容里、`ReadingSettingsPanel` **之上**加分隔线 +「人物」section：

```tsx
{/* 人物 */}
{characterSlot}
<div className="my-2 border-t border-border" />
{/* 阅读偏好 */}
<ReadingSettingsPanel />
```

新增可选 prop：

```ts
characterSlot?: ReactNode
```

页面传入：

```tsx
<ItemActions
  ...
  characterSlot={
    <CharacterPanel
      characters={characters}
      enabled={enabled}
      setEnabled={setEnabled}
      onRemove={(n) => void remove(n)}
      error={error}
      onRetry={() => void reload()}
    />
  }
/>
```

- [ ] **Step 5: ReadPage / BookPage**

```tsx
const { characters, error, reload, add, remove } = useCharacters("post", tid)
const { enabled, setEnabled } = useCharacterHighlightEnabled()
const [markPopup, setMarkPopup] = useState<{
  name: string
  rect: DOMRect
} | null>(null)

<ArticleView
  ...
  characters={characters}
  highlightEnabled={enabled}
  onCharacterClick={(name, rect) => setMarkPopup({ name, rect })}
  actions={
    <ItemActions
      ...
      characterSlot={<CharacterPanel ... />}
    />
  }
/>
<CharacterSelectionToolbar
  characters={characters}
  onAdd={(n) => void add(n)}
  onRemove={(n) => void remove(n)}
/>
{markPopup && (
  <CharacterMarkPopover
    name={markPopup.name}
    rect={markPopup.rect}
    onRemove={() => {
      void remove(markPopup.name)
      setMarkPopup(null)
    }}
    onClose={() => setMarkPopup(null)}
  />
)}
```

BookPage 用 `useCharacters("book", cid)`，其余同构。

- [ ] **Step 6: typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 7: 手动验收（对照 spec）**

1. 未入组帖标记两人名 → 刷新仍在 → 轮色  
2. 同组两章共享；移出组后恢复 post 名单  
3. 书两章同 cid 共享  
4. 关总开关无 mark  
5. 链接内 mark 取消不跳转  
6. export 含 `character_names`  
7. tid 加第二组 409  

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/character-selection-toolbar.tsx \
  apps/web/src/components/character-mark-popover.tsx \
  apps/web/src/components/character-panel.tsx \
  apps/web/src/components/item-actions.tsx \
  apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): character selection toolbar and panel"
```

---

### Task 7: Spec 状态收尾（可选；状态链接多半已写好）

若 spec 状态行尚未指向本 plan，补一行后随实现末次 commit 带上即可，不必单独成 commit。

---

## Spec coverage (self-review)

| Spec 要求 | Task |
| --- | --- |
| character_names DDL / 无多余 index | 1 |
| color_index 单调 + 渲染 % 6 | 2, 3, 5 |
| 一帖一组 UNIQUE + 去重日志 | 1, 2 |
| deleteGroupCascade / 空组删；`removeGroupItems` 返回不变 | 2 |
| 入组不合并；离组恢复 post | 2 |
| export character_names | 2 |
| API GET/PUT/DELETE + assertSafeId + 不校验 items | 4 |
| groups 跨组 409 整批回滚 / 同组幂等 | 2, 4 |
| 零改动 extractPreHtml / DOMPurify | 3, 5 |
| `normalizeCharacterName` 单测 + 选区拒换行 | 3, 6 |
| characterHighlight 安全/长名/实体不匹配 | 3 |
| 选区浮条；mark 浮层；面板；Settings 内 section | 6 |
| localStorage 总开关不生成 mark | 5, 6 |
| Read + Book + ArticleView 新 props | 5, 6 |
| AGENTS.md | 4 |
| 无 site；index.ts 不 re-export | Global / 3 |

无 TBD / 占位实现步骤。
