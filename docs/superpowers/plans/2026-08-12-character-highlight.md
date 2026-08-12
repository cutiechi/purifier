# 阅读页人物名称标记与高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读页选中人名并持久化到 SQLite，按 group/post/book 作用域全文高亮；论坛一帖一组。

**Architecture:** `character_names` 表存名单；`Store` 解析作用域并 CRUD；API `/api/me/characters`；纯函数 `characterHighlight`（DOMPurify 之后注入 `<mark class="character-mark--N">`）；前端选区浮条 + 人物面板。不改上游清洗与 DOMPurify 白名单。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19、Tailwind 4、DOMPurify、lucide-react。

**Spec:** `docs/superpowers/specs/2026-08-12-character-highlight-design.md`

## Global Constraints

- Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 验证：`bun run test` / `bun run typecheck` / `bun run build`。
- `/api/me/*` 用 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`。
- **不引入 `site`**；不改 `extractPreHtml` / `sanitizeContentHtml` / DOMPurify 配置。
- `color_index` 存单调递增原值；渲染 `color_index % 6`；`COLOR_COUNT = 6`。
- `scope_id` 一律 TEXT；group 用 `String(group_id)`。
- 组件不做单测；纯函数与 store 进 `bun test`。
- web 通过 `@workspace/core/character-highlight` 子路径导入，避免把 cheerio/sqlite 打进浏览器包。

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
| `apps/web/src/components/character-selection-toolbar.tsx` | 选区浮条 |
| `apps/web/src/components/article-view.tsx` | ContentBody 高亮 + mark 点击 |
| `apps/web/src/components/item-actions.tsx` | 「人物」入口 |
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

在 `store.test.ts` 的表名断言中加入 `"character_names"`（按字母序插在 `"archive_posts"` 与 `"favorites"` 之间），并追加：

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

  // 旧库去重：先造重复再 reopen
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test("migrates duplicate group_items tids keeping min group_id", () => {
  const dir = tempDir()
  const dbPath = join(dir, "purifier.db")
  mkdirSync(dir, { recursive: true })
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

（`migrates...` 用例需 `import { mkdirSync } from "node:fs"` 与已有 `Database`。）

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

  test("upsertGroup cross-group tid throws 409", () => {
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
        items: [{ tid: "1", title: "y" }],
      })
    ).toThrow(ExtractorError)
    try {
      store.upsertGroup({
        key: "b",
        title: "B",
        items: [{ tid: "1", title: "y" }],
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractorError)
      expect((e as ExtractorError).statusCode).toBe(409)
    }
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

将 `deleteGroup` 改为调用 `deleteGroupCascade`（可包在 transaction 里）。`removeGroupItems` 在组空删除时改为调用 `deleteGroupCascade` 而非手写两行 DELETE。

`upsertGroup` 在 insert 循环前：

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
- Modify: `packages/core/src/index.ts`（可选 re-export；子路径必须有）

**Interfaces:**
- Produces:
  - `export const COLOR_COUNT = 6`
  - `export function normalizeCharacterName(raw: string): string | null`
  - `export function characterHighlight(html: string, characters: { name: string; colorIndex: number }[]): string`
  - `export function colorSlot(colorIndex: number): number` → `colorIndex % COLOR_COUNT`

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
    expect(out).not.toMatch(
      /character-mark--0">王小<\/mark>明/
    )
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

  test("literal name with special chars does not inject html", () => {
    const html = "<p>a&quot;b</p>"
    // 正文里若有字面 </mark> 或引号，只作文本匹配；class 不含 name
    const out = characterHighlight("<p>x&lt;/mark&gt;y</p>", [
      { name: "</mark>", colorIndex: 0 },
    ])
    // 净化后文本可能是字面 </mark> 或实体；断言不出现双 mark 嵌套注入
    expect(out.match(/<mark/g)?.length ?? 0).toBeLessThanOrEqual(1)
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
export const COLOR_COUNT = 6

export function colorSlot(colorIndex: number): number {
  return ((colorIndex % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT
}

export function normalizeCharacterName(raw: string): string | null {
  if (/[\n\t]/.test(raw)) return null
  const name = raw.trim()
  if (name.length < 1 || name.length > 32) return null
  return name
}

/**
 * 输入：已 DOMPurify 的 HTML。输出仅额外插入
 * <mark class="character-mark character-mark--N">。
 * 按标签切分，只改文本节点；人名长度降序；不把 name 写入属性。
 */
export function characterHighlight(
  html: string,
  characters: { name: string; colorIndex: number }[]
): string {
  const names = characters
    .filter((c) => c.name.length > 0)
    .slice()
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name))
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
  // 标记已覆盖区间，避免短名吞长名
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

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/character-highlight.test.ts`
Expected: PASS（若「特殊字符」用例与实体切分不一致，按实际 DOMPurify 后文本调整断言，但不得允许把 name 拼进标签）

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
curl -s 'http://127.0.0.1:3001/api/me/characters?kind=post&id=1'
curl -s -X PUT http://127.0.0.1:3001/api/me/characters \
  -H 'content-type: application/json' \
  -d '{"kind":"post","id":"1","name":"甲"}'
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
import { api } from "@/lib/routes"

export type CharacterName = { name: string; colorIndex: number }
export type CharacterScope = { type: string; id: string }

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
      if (json.character) {
        /* ok */
      }
      return json as { characters: CharacterName[] }
    },
    [kind, id]
  )

  const remove = useCallback(
    async (name: string) => {
      const q = new URLSearchParams({ kind, id, name })
      const res = await fetch(`${api.meCharacters}?${q}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "删除失败")
      await reload()
      return json as { removed: number }
    },
    [kind, id, reload]
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

`ArticleView` 把 `characters` / `highlightEnabled` / `onCharacterClick` 透传给 `ContentBody`。

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
- Create: `apps/web/src/components/character-panel.tsx`
- Modify: `apps/web/src/components/item-actions.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`
- Modify: `apps/web/src/pages/BookPage.tsx`

**Interfaces:**
- Consumes: `useCharacters`、`useCharacterHighlightEnabled`、`normalizeCharacterName`
- Produces: 完整阅读页交互

- [ ] **Step 1: 选区浮条**

`character-selection-toolbar.tsx`：监听 `mouseup`（捕获于 `.reading-body` 容器或 document），若选区在 `.reading-body` 内：

1. `const raw = selection.toString()`
2. `normalizeCharacterName(raw)` 为 null → 隐藏
3. 否则在选区 `getBoundingClientRect()` 上方显示固定定位小条
4. 若 `characters.some(c => c.name === name)` → 按钮「取消标记」，否则「标记为人物」
5. Esc / scroll / 点空白关闭

```tsx
// 关键结构示意
<div
  className="fixed z-50 rounded-lg border border-border bg-popover px-2 py-1 shadow-md"
  style={{ top, left }}
>
  <button type="button" onClick={onAction}>
    {exists ? "取消标记" : "标记为人物"}
  </button>
</div>
```

- [ ] **Step 2: 人物面板**

`character-panel.tsx`：接收 `characters`、`enabled`、`setEnabled`、`onRemove`、`error`、`onRetry`。

- 开关：「显示人物高亮」
- 列表：色点（用 `colorSlot` + 同 CSS 类）+ 名 + 删除按钮
- 空态：「在正文中选中人名即可标记」
- 错误：文案 + 重试

- [ ] **Step 3: ItemActions**

增加可选 props：

```ts
characterPanel?: ReactNode
```

或在 actions 行增加独立 Popover「人物」按钮（`Users` lucide 图标），内容为 `CharacterPanel`。推荐独立按钮，避免塞进设置 Popover。

- [ ] **Step 4: ReadPage / BookPage**

```tsx
const { characters, error, reload, add, remove } = useCharacters("post", tid)
const { enabled, setEnabled } = useCharacterHighlightEnabled()
const [markPopup, setMarkPopup] = useState<{ name: string; rect: DOMRect } | null>(null)

// ArticleView / ContentBody 传入 characters、highlightEnabled={enabled}
// onCharacterClick → setMarkPopup
// CharacterSelectionToolbar 绑定 add/remove
// ItemActions 旁挂 CharacterPanel
```

BookPage 用 `useCharacters("book", cid)`。

点 mark 浮层：显示名 + 「取消标记」→ `remove(name)` → 关闭。

- [ ] **Step 5: typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 6: 手动验收（对照 spec）**

1. 未入组帖标记两人名 → 刷新仍在 → 轮色  
2. 同组两章共享；移出组后恢复 post 名单  
3. 书两章同 cid 共享  
4. 关总开关无 mark  
5. 链接内 mark 取消不跳转  
6. export 含 `character_names`  
7. tid 加第二组 409  

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/character-selection-toolbar.tsx \
  apps/web/src/components/character-panel.tsx \
  apps/web/src/components/item-actions.tsx \
  apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): character selection toolbar and panel"
```

---

### Task 7: Spec 状态收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-character-highlight-design.md`（状态改为已实现 / 计划已写）

- [ ] **Step 1:** 将 spec 状态改为：`实施计划见 docs/superpowers/plans/2026-08-12-character-highlight.md`

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-character-highlight-design.md \
  docs/superpowers/plans/2026-08-12-character-highlight.md
git commit -m "docs: character highlight implementation plan"
```

（若本 plan 文件尚未入库，本步一并加入。）

---

## Spec coverage (self-review)

| Spec 要求 | Task |
| --- | --- |
| character_names DDL / 无多余 index | 1 |
| color_index 单调 + 渲染 % 6 | 2, 3, 5 |
| 一帖一组 UNIQUE + 去重日志 | 1, 2 |
| deleteGroupCascade / 空组删 | 2 |
| 入组不合并；离组恢复 post | 2 |
| export character_names | 2 |
| API GET/PUT/DELETE + assertSafeId + 不校验 items | 4 |
| groups 跨组 409 / 同组幂等 | 2, 4 |
| 零改动 extractPreHtml / DOMPurify | 3, 5（显式不改） |
| characterHighlight + 安全/长名 | 3 |
| 选区拒换行；浮条；面板；mark 拦截 | 6 |
| localStorage 总开关不生成 mark | 5, 6 |
| Read + Book 接线 | 6 |
| AGENTS.md | 4 |
| 无 site | Global Constraints |

无 TBD / 占位实现步骤。
