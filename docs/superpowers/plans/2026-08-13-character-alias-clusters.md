# 人物多称呼关联与同色高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一作用域内多个称呼可归入同一 cluster，共享一个 hue 高亮；支持挂靠、合并、拆出、改色。

**Architecture:** `character_clusters` 存 hue；`character_names` 挂 `cluster_id`。Store 负责 CRUD / merge / split / recolor / `pruneEmptyClusters`。API `/api/me/characters` 增加 PATCH。纯函数 `characterHighlight` 注入 `--character-mark-h`。前端按 cluster 管理，压平后高亮。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19、Tailwind 4、DOMPurify。

**Spec:** `docs/superpowers/specs/2026-08-13-character-alias-clusters-design.md`

**状态：** 已按 `docs/superpowers/plans/review.md` 修订（#1 索引必须在迁移之后；#2 浮条限高；#3 recolor debounce；#4 保留 v1 mark padding；#7 乐观删除代码；#5 不做提前优化）

## Global Constraints

- Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 验证：`bun run test` / `bun run typecheck` / `bun run build`。
- `/api/me/*` 用 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`。
- **不引入 `site`**；不改 `extractPreHtml` / `sanitizeContentHtml` / DOMPurify 配置。
- `scope_id` 一律 TEXT；group 用 `String(group_id)`。
- 组件不做单测；纯函数与 store 进 `bun test`。
- web / API 一律 `from "@workspace/core/character-highlight"`；**`packages/core/src/index.ts` 不 re-export**。
- Dark 模式：`.dark {…}`（`globals.css`），**不要**用 `prefers-color-scheme`。
- `hue` 整数 0–359；自动配色只用 `pickHue`；用户改色允许撞色。
- 空 cluster 只在 store 里 `pruneEmptyClusters` 清理，API handler 不直接删 cluster。
- `StatsInventory.characters` 仍 `COUNT(*) FROM character_names`。
- `exportBackup().version` 升为 `2`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/storage/types.ts` | `CharacterCluster` / `CharacterMark`；删除 `CharacterName.colorIndex` |
| `packages/core/src/character-highlight.ts` | `pickHue` / `isHue` / `clampHue` / `flattenClusterMarks` / `characterHighlight`；删 `COLOR_COUNT`/`colorSlot` |
| `packages/core/src/storage/db.ts` | 新 DDL；`PRAGMA table_info` 检测 `color_index` 后事务迁移 |
| `packages/core/src/storage/store.ts` | `listClusters`、挂靠/删、merge/split/recolor、cascade 双删、export v2 |
| `packages/core/src/storage/characters.test.ts` | store 行为 |
| `packages/core/src/storage/store.test.ts` | 表名列表、旧表迁移、export version |
| `apps/api/src/index.ts` | GET clusters；PUT `clusterId`；PATCH；405 |
| `AGENTS.md` | API 表 |
| `packages/ui/src/styles/globals.css` | `--character-mark-h` + `.character-swatch` |
| `apps/web/src/hooks/use-characters.ts` | `clusters` + `marks` + merge/split/recolor |
| `apps/web/src/components/character-swatch.tsx` | 色点 |
| `apps/web/src/components/character-panel.tsx` | 分组 / 改色 / 合并 / 拆出 |
| `apps/web/src/components/character-selection-toolbar.tsx` | 挂靠已有组 |
| `apps/web/src/components/character-mark-popover.tsx` | 同组其它称呼 |
| `apps/web/src/components/article-view.tsx` | `{ name, hue }[]` |
| `apps/web/src/pages/ReadPage.tsx` / `BookPage.tsx` | 接线 |

---

### Task 1: 类型与配色纯函数

**Files:**
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/character-highlight.ts`
- Modify: `packages/core/src/character-highlight.test.ts`

**Interfaces:**
- Consumes: 现有 `CharacterScope`
- Produces:
  - `CharacterCluster { id: number; hue: number; names: string[] }`
  - `CharacterMark { name: string; hue: number }`
  - `pickHue(used: number[]): number`
  - `isHue(value: unknown): value is number`
  - `clampHue(hue: number): number`
  - `flattenClusterMarks(clusters: CharacterCluster[]): CharacterMark[]`
  - `LEGACY_SLOT_HUE: readonly number[]` 长度为 6：`[85, 160, 220, 300, 30, 350]`

- [ ] **Step 1: 改类型**

在 `types.ts` 把 `CharacterName` **整段替换**为：

```ts
export interface CharacterCluster {
  id: number
  hue: number
  names: string[]
}

export interface CharacterMark {
  name: string
  hue: number
}
```

不要保留 `colorIndex` 别名。

- [ ] **Step 2: 写 `pickHue` / `isHue` / `clampHue` 失败测试**

在 `character-highlight.test.ts` 追加（先不实现，确认红）：

```ts
import {
  LEGACY_SLOT_HUE,
  clampHue,
  flattenClusterMarks,
  isHue,
  pickHue,
} from "./character-highlight"

test("pickHue empty is 85", () => {
  expect(pickHue([])).toBe(85)
})

test("pickHue maximizes min circular distance", () => {
  expect(pickHue([85])).toBe(265)
  const a = pickHue([85, 265])
  expect(a).not.toBe(85)
  expect(a).not.toBe(265)
})

test("pickHue dedupes used", () => {
  expect(pickHue([85, 85])).toBe(pickHue([85]))
})

test("isHue and clampHue", () => {
  expect(isHue(0)).toBe(true)
  expect(isHue(359)).toBe(true)
  expect(isHue(360)).toBe(false)
  expect(isHue(1.5)).toBe(false)
  expect(isHue("1")).toBe(false)
  expect(clampHue(400)).toBe(40)
  expect(clampHue(-1)).toBe(359)
})

test("flattenClusterMarks copies hue onto each name", () => {
  expect(
    flattenClusterMarks([
      { id: 1, hue: 85, names: ["林远", "少爷"] },
      { id: 2, hue: 160, names: ["乙"] },
    ])
  ).toEqual([
    { name: "林远", hue: 85 },
    { name: "少爷", hue: 85 },
    { name: "乙", hue: 160 },
  ])
})

test("LEGACY_SLOT_HUE maps v1 slots", () => {
  expect(LEGACY_SLOT_HUE).toEqual([85, 160, 220, 300, 30, 350])
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/cutiechi/projects/personal/purifier && bun test packages/core/src/character-highlight.test.ts`

Expected: FAIL（`pickHue` 未导出）

- [ ] **Step 4: 实现纯函数**

`character-highlight.ts` 顶部改为：

```ts
export type {
  CharacterCluster,
  CharacterMark,
  CharacterScope,
} from "./storage/types"

export const LEGACY_SLOT_HUE = [85, 160, 220, 300, 30, 350] as const

export function isHue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 359
}

export function clampHue(hue: number): number {
  if (!Number.isFinite(hue)) return 85
  return ((Math.round(hue) % 360) + 360) % 360
}

export function pickHue(used: number[]): number {
  const uniq = [...new Set(used)]
  if (uniq.length === 0) return 85
  let best = 0
  let bestScore = -1
  for (let h = 0; h < 360; h++) {
    let minD = 360
    for (const u of uniq) {
      const raw = Math.abs(h - u)
      const d = Math.min(raw, 360 - raw)
      if (d < minD) minD = d
    }
    if (minD > bestScore) {
      bestScore = minD
      best = h
    }
  }
  return best
}

export function flattenClusterMarks(
  clusters: CharacterCluster[]
): CharacterMark[] {
  return clusters.flatMap((c) => c.names.map((name) => ({ name, hue: c.hue })))
}
```

本任务**先不要**改 `characterHighlight` 的 `{ colorIndex }` 签名（Task 7）。`colorSlot` / `COLOR_COUNT` 暂时留着，避免半截红一片。类型导出已删 `CharacterName`：若本步 `typecheck` 因 web 失败，可先只跑 `bun test packages/core`。

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test packages/core/src/character-highlight.test.ts`

Expected: PASS（含旧 `characterHighlight` 用例）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/types.ts packages/core/src/character-highlight.ts packages/core/src/character-highlight.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add cluster types and pickHue

EOF
)"
```

---

### Task 2: DDL 与 color_index 迁移

**Files:**
- Modify: `packages/core/src/storage/db.ts`
- Modify: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `LEGACY_SLOT_HUE` from `@workspace/core` 路径不可用（db 在 core 内）→ `import { LEGACY_SLOT_HUE } from "../character-highlight"`
- Produces: `openDatabase()` 保证存在 `character_clusters`；`character_names` 有 `cluster_id`、无 `color_index`；FK `ON DELETE CASCADE`

- [ ] **Step 1: 改表名列表测试并加迁移测试**

`store.test.ts` 的 `creates items/favorites/tags/groups tables` 期望数组插入 `character_clusters`（字母序在 `character_names` 前）：

```ts
expect(rows.map((r) => r.name)).toEqual([
  "archive_cursors",
  "archive_posts",
  "character_clusters",
  "character_names",
  "favorites",
  "group_items",
  "groups",
  "items",
  "job_logs",
  "jobs",
  "reading_sessions",
  "tags",
])
```

把 `character_names table and group_items tid unique` 里 `expect(ddl?.sql).toMatch(/color_index/)` 改成：

```ts
expect(ddl?.sql).toMatch(/cluster_id/)
expect(ddl?.sql).not.toMatch(/color_index/)
```

追加测试（文件底部附近）：

```ts
test("migrates character_names color_index to clusters", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-char-mig-"))
  const raw = new Database(join(dir, "purifier.db"))
  raw.exec(`
    CREATE TABLE character_names (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (scope_type, scope_id, name)
    );
  `)
  raw.query(
    `INSERT INTO character_names VALUES ('post','1','甲',0,1)`
  ).run()
  raw.query(
    `INSERT INTO character_names VALUES ('post','1','乙',7,2)`
  ).run()
  raw.close()

  const db = openDatabase(dir)
  const cols = db.query("PRAGMA table_info(character_names)").all() as {
    name: string
  }[]
  expect(cols.map((c) => c.name)).not.toContain("color_index")
  expect(cols.map((c) => c.name)).toContain("cluster_id")
  const clusters = db
    .query("SELECT hue FROM character_clusters ORDER BY id")
    .all() as { hue: number }[]
  expect(clusters.map((c) => c.hue)).toEqual([85, 160]) // 0→85, 7%6=1→160
  const n = (
    db.query("SELECT COUNT(*) AS n FROM character_names").get() as { n: number }
  ).n
  expect(n).toBe(2)
  expect(
    db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_character_names_cluster'"
      )
      .get()
  ).toBeTruthy()
  db.close()
  openDatabase(dir).close() // 幂等
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`

Expected: FAIL（缺 `character_clusters` 或仍有 `color_index`）

- [ ] **Step 3: 改 DDL + 迁移**

**阻塞：不要把 `CREATE INDEX ... (cluster_id)` 放进 `DDL` 字符串，也不要在 `db.exec(DDL)` 之后立刻建该索引。**

旧库已有 `character_names`（含 `color_index`、无 `cluster_id`）。`CREATE TABLE IF NOT EXISTS character_names` 会跳过，若紧接着 `CREATE INDEX ON character_names (cluster_id)`，SQLite 因列不存在抛错，**已有用户库无法启动**。`idx_character_clusters_scope` 可以较早建（新表会由 DDL 创建），但为顺序清晰，两个索引都放到**迁移块之后**无条件执行。

`db.ts`：

1. `DDL` 里在 `character_names` **之前**加 `character_clusters` 表（与 spec 一致）。
2. 替换 `character_names` 定义为带 `cluster_id REFERENCES character_clusters(id) ON DELETE CASCADE`、无 `color_index`。**DDL 内不要写任何 character_* 的 CREATE INDEX。**
3. 在 `db.exec(DDL)` **之后**、现有 items 迁移附近：先跑 `color_index` 迁移（若需要），**然后**再 `CREATE INDEX IF NOT EXISTS`：

```ts
import { LEGACY_SLOT_HUE } from "../character-highlight"

const charCols = db
  .query("PRAGMA table_info(character_names)")
  .all() as { name: string }[]
if (charCols.some((c) => c.name === "color_index")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS character_clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        hue INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE character_names_new (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cluster_id INTEGER NOT NULL
          REFERENCES character_clusters(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope_type, scope_id, name)
      );
    `)
    const old = db
      .query(
        `SELECT scope_type, scope_id, name, color_index, created_at
         FROM character_names`
      )
      .all() as Array<{
      scope_type: string
      scope_id: string
      name: string
      color_index: number
      created_at: number
    }>
    const insC = db.query(
      `INSERT INTO character_clusters (scope_type, scope_id, hue, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    )
    const insN = db.query(
      `INSERT INTO character_names_new
         (scope_type, scope_id, name, cluster_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    for (const row of old) {
      const slot = ((row.color_index % 6) + 6) % 6
      const hue = LEGACY_SLOT_HUE[slot]!
      const r = insC.run(row.scope_type, row.scope_id, hue, row.created_at)
      insN.run(
        row.scope_type,
        row.scope_id,
        row.name,
        Number(r.lastInsertRowid),
        row.created_at
      )
    }
    db.exec(`DROP TABLE character_names`)
    db.exec(`ALTER TABLE character_names_new RENAME TO character_names`)
    console.log(`migrated ${old.length} character_names rows to clusters`)
  })()
}

db.exec(
  `CREATE INDEX IF NOT EXISTS idx_character_names_cluster
   ON character_names (cluster_id)`
)
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_character_clusters_scope
   ON character_clusters (scope_type, scope_id)`
)
```

索引必须在上面的 `if (color_index)` 事务**之后**（新库：DDL 已有 `cluster_id`，迁移跳过，建索引即可；旧库：先重建表才有该列）。不要把这两句再塞回迁移事务里当唯一入口——新库从不进 `if`，否则新库会缺索引。

注意：旧库可能还没有 `character_clusters`（DDL 的 `CREATE TABLE IF NOT EXISTS` 已在 `db.exec(DDL)` 建过）。迁移事务里的 `CREATE TABLE IF NOT EXISTS character_clusters` 是幂等。若 DDL 已建空 `character_clusters`，直接往里插即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/store.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): migrate character_names onto clusters

EOF
)"
```

---

### Task 3: Store 列表 / 增删 / prune

**Files:**
- Modify: `packages/core/src/storage/store.ts`
- Modify: `packages/core/src/storage/characters.test.ts`

**Interfaces:**
- Consumes: `pickHue`, `isHue`, `CharacterCluster`, `CharacterScope`, `ExtractorError`
- Produces:
  - `listClusters(scope: CharacterScope): CharacterCluster[]`
  - `addCharacter(scope, name: string, clusterId?: number): CharacterCluster`
  - `removeCharacter(scope, name: string): number`（末尾 prune）
  - `pruneEmptyClusters(scope?: CharacterScope): void`
  - **删除** `listCharacters`

- [ ] **Step 1: 改 characters.test.ts 为 cluster 语义**

替换所有 `listCharacters` / `colorIndex` 断言。核心用例（保留原 resolve/cascade 骨架，改数据断言）：

```ts
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
```

`deleteGroupCascade` / 离组 / export 测试里所有 `listCharacters` 改为 `listClusters`，名字用 `.flatMap(c => c.names)`。

`exportBackup includes character_names` 暂留，Task 5 再升 version。

cascade 测试：`listClusters` 空数组即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/characters.test.ts`

Expected: FAIL（`listClusters` 不存在）

- [ ] **Step 3: 实现 store 方法**

`store.ts` import 改为 `CharacterCluster`（不再 `CharacterName`），并 `import { pickHue, isHue } from "../character-highlight"`。

实现要点（同一文件替换 `listCharacters`/`addCharacter`/`removeCharacter`）：

```ts
pruneEmptyClusters(scope?: CharacterScope): void {
  if (scope) {
    this.db.query(
      `DELETE FROM character_clusters
       WHERE scope_type = ?1 AND scope_id = ?2
         AND id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
    ).run(scope.type, scope.id)
  } else {
    this.db.exec(
      `DELETE FROM character_clusters
       WHERE id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
    )
  }
}

listClusters(scope: CharacterScope): CharacterCluster[] {
  const rows = this.db.query(
    `SELECT c.id, c.hue, n.name
     FROM character_clusters c
     JOIN character_names n ON n.cluster_id = c.id
     WHERE c.scope_type = ?1 AND c.scope_id = ?2
     ORDER BY c.created_at, c.id, n.created_at, n.name`
  ).all(scope.type, scope.id) as { id: number; hue: number; name: string }[]
  const map = new Map<number, CharacterCluster>()
  const order: number[] = []
  for (const r of rows) {
    let c = map.get(r.id)
    if (!c) {
      c = { id: r.id, hue: r.hue, names: [] }
      map.set(r.id, c)
      order.push(r.id)
    }
    c.names.push(r.name)
  }
  return order.map((id) => map.get(id)!)
}

getCluster(scope: CharacterScope, clusterId: number): CharacterCluster {
  const all = this.listClusters(scope)
  const hit = all.find((c) => c.id === clusterId)
  if (!hit) throw new ExtractorError("cluster not found", 404)
  return hit
}
```

`addCharacter(scope, name, clusterId?: number)`：

1. 查现有 name：`SELECT cluster_id FROM character_names WHERE scope_type=? AND scope_id=? AND name=?`
2. 若存在且 `clusterId === undefined` 或 `clusterId === existing.cluster_id` → 返回 `getCluster`
3. 若存在且 `clusterId` 不同 → `throw new ExtractorError("character belongs to another cluster", 409)`
4. 若 `clusterId !== undefined`：`getCluster`（404）；`INSERT` name；返回 `getCluster`
5. 否则：`used = listClusters(scope).map(c => c.hue)`；`hue = pickHue(used)`；`INSERT cluster`；`INSERT name`；返回 `getCluster`

`getCluster` 走全量 `listClusters` 即可（个人库量级）。不要为本任务再写单条 SELECT 优化。

`removeCharacter`：DELETE name 后 `this.pruneEmptyClusters(scope)`，返回 changes。

`deleteGroupCascade` 本任务可先仍删 `character_names`（旧语句会因无 `color_index` 仍能按 scope 删 names，但空 clusters 会残留）。**本步就把 cascade 改成 spec 双删**，避免测试红：

```ts
deleteGroupCascade(id: number): void {
  const sid = String(id)
  this.db.query(
    `DELETE FROM character_clusters WHERE scope_type = 'group' AND scope_id = ?1`
  ).run(sid)
  this.db.query(
    `DELETE FROM character_names WHERE scope_type = 'group' AND scope_id = ?1`
  ).run(sid)
  this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
  this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
}
```

全仓搜 `listCharacters`，只应剩 API（下一任务改）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/storage/characters.test.ts packages/core/src/storage/store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/characters.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): cluster CRUD and pruneEmptyClusters

EOF
)"
```

---

### Task 4: merge / split / recolor

**Files:**
- Modify: `packages/core/src/storage/store.ts`
- Modify: `packages/core/src/storage/characters.test.ts`

**Interfaces:**
- Produces:
  - `mergeClusters(scope, clusterIds: number[], hue: number): CharacterCluster[]`
  - `splitCharacter(scope, clusterId: number, name: string): CharacterCluster[]`
  - `recolorCluster(scope, clusterId: number, hue: number): CharacterCluster[]`
  - 非法 hue → `ExtractorError("invalid hue", 400)`

- [ ] **Step 1: 写失败测试**

```ts
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
  expect(() => store.splitCharacter(scope, a.id, "甲")).toThrow(ExtractorError)
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/characters.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现**

```ts
requireHue(hue: number): number {
  if (!isHue(hue)) throw new ExtractorError("invalid hue", 400)
  return hue
}

mergeClusters(scope: CharacterScope, clusterIds: number[], hue: number): CharacterCluster[] {
  const h = this.requireHue(hue)
  const uniq = [...new Set(clusterIds)]
  if (uniq.length < 2) throw new ExtractorError("invalid clusterIds", 400)
  const clusters = uniq.map((id) => this.getCluster(scope, id))
  const targetId = Math.min(...clusters.map((c) => c.id))
  this.db.transaction(() => {
    for (const id of uniq) {
      if (id === targetId) continue
      this.db.query(
        `UPDATE character_names SET cluster_id = ?1
         WHERE cluster_id = ?2 AND scope_type = ?3 AND scope_id = ?4`
      ).run(targetId, id, scope.type, scope.id)
    }
    this.db.query(
      `UPDATE character_clusters SET hue = ?1 WHERE id = ?2`
    ).run(h, targetId)
    this.pruneEmptyClusters(scope)
  })()
  return this.listClusters(scope)
}

splitCharacter(scope: CharacterScope, clusterId: number, name: string): CharacterCluster[] {
  const c = this.getCluster(scope, clusterId)
  if (!c.names.includes(name)) throw new ExtractorError("cluster not found", 404)
  if (c.names.length < 2) throw new ExtractorError("cannot split singleton", 400)
  const hue = pickHue(this.listClusters(scope).map((x) => x.hue))
  this.db.transaction(() => {
    const r = this.db.query(
      `INSERT INTO character_clusters (scope_type, scope_id, hue, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).run(scope.type, scope.id, hue, this.now())
    this.db.query(
      `UPDATE character_names SET cluster_id = ?1
       WHERE scope_type = ?2 AND scope_id = ?3 AND name = ?4`
    ).run(Number(r.lastInsertRowid), scope.type, scope.id, name)
  })()
  return this.listClusters(scope)
}

recolorCluster(scope: CharacterScope, clusterId: number, hue: number): CharacterCluster[] {
  const h = this.requireHue(hue)
  this.getCluster(scope, clusterId)
  this.db.query(`UPDATE character_clusters SET hue = ?1 WHERE id = ?2`).run(h, clusterId)
  return this.listClusters(scope)
}
```

merge 里 `getCluster` 在 transaction 外先校验 404。

`UPDATE ... WHERE cluster_id = ?2 AND scope_type = ?3 AND scope_id = ?4` 里 scope 条件是防御性冗余（`cluster_id` 已绑定 scope），**保留**。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/storage/characters.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/characters.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): merge split and recolor character clusters

EOF
)"
```

---

### Task 5: export version 2 与 inventory

**Files:**
- Modify: `packages/core/src/storage/store.ts`（`exportBackup` 返回类型）
- Modify: `packages/core/src/storage/characters.test.ts`
- Modify: `packages/core/src/storage/store.test.ts`（若有 `version: 1` 断言则改 2）

**Interfaces:**
- Produces: `exportBackup().version === 2`；含 `character_clusters`；`character_names` 含 `cluster_id` 无 `color_index`

- [ ] **Step 1: 扩展 export 测试**

```ts
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
```

全仓搜 `version: 1` 的 export 断言并改为 `2`。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/characters.test.ts`

Expected: FAIL（version 仍为 1）

- [ ] **Step 3: 改 `exportBackup`**

- `version: 2 as const`
- 增加 `SELECT * FROM character_clusters ORDER BY id`
- `character_names` 查询结果类型去掉 `color_index`、加上 `cluster_id`

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/characters.test.ts packages/core/src/storage/store.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): export character clusters as backup version 2

EOF
)"
```

---

### Task 6: API GET / PUT / PATCH / DELETE

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `AGENTS.md`（本任务一起改 API 表，避免文档落后）

**Interfaces:**
- Consumes: `listClusters` / `addCharacter` / `removeCharacter` / `mergeClusters` / `splitCharacter` / `recolorCluster` / `isHue`
- Produces: 见 spec GET/PUT/PATCH/DELETE JSON

- [ ] **Step 1: 改 handlers**

`handleCharactersGet`：

```ts
const clusters = store.listClusters(scope)
return jsonOk({ scope, clusters }, NO_STORE_HEADERS)
```

`handleCharactersPut`：在 parse name 之后：

```ts
let clusterId: number | undefined
if ("clusterId" in body && body.clusterId !== undefined && body.clusterId !== null) {
  if (typeof body.clusterId !== "number" || !Number.isInteger(body.clusterId)) {
    throw new ExtractorError("invalid clusterId", 400)
  }
  clusterId = body.clusterId
}
const cluster = store.addCharacter(scope, name, clusterId)
const clusters = store.listClusters(scope)
return jsonOk({ ok: true, cluster, clusters }, NO_STORE_HEADERS)
```

`handleCharactersDelete` 不变（仍 `removed`），store 已 prune。

新增 `handleCharactersPatch`：

```ts
async function handleCharactersPatch(req: Request): Promise<Response> {
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
  const op = "op" in body ? body.op : undefined
  const scope = store.resolveCharacterScope(kind, id)
  if (op === "merge") {
    const ids = "clusterIds" in body ? body.clusterIds : undefined
    const hue = "hue" in body ? body.hue : undefined
    if (!Array.isArray(ids) || !isHue(hue)) {
      throw new ExtractorError("invalid merge", 400)
    }
    const clusterIds = ids.map((x) => {
      if (typeof x !== "number" || !Number.isInteger(x)) {
        throw new ExtractorError("invalid clusterIds", 400)
      }
      return x
    })
    const clusters = store.mergeClusters(scope, clusterIds, hue)
    return jsonOk({ ok: true, clusters }, NO_STORE_HEADERS)
  }
  // clusterIds 为 [] 时 Array.isArray 为 true，store.mergeClusters 因 uniq.length < 2 抛 400。
  if (op === "split") {
    const clusterId = "clusterId" in body ? body.clusterId : undefined
    const nameRaw = "name" in body ? body.name : undefined
    if (typeof clusterId !== "number" || !Number.isInteger(clusterId)) {
      throw new ExtractorError("invalid clusterId", 400)
    }
    if (typeof nameRaw !== "string") throw new ExtractorError("invalid name", 400)
    const name = normalizeCharacterName(nameRaw)
    if (!name) throw new ExtractorError("invalid name", 400)
    const clusters = store.splitCharacter(scope, clusterId, name)
    return jsonOk({ ok: true, clusters }, NO_STORE_HEADERS)
  }
  if (op === "recolor") {
    const clusterId = "clusterId" in body ? body.clusterId : undefined
    const hue = "hue" in body ? body.hue : undefined
    if (typeof clusterId !== "number" || !Number.isInteger(clusterId)) {
      throw new ExtractorError("invalid clusterId", 400)
    }
    if (!isHue(hue)) throw new ExtractorError("invalid hue", 400)
    const clusters = store.recolorCluster(scope, clusterId, hue)
    return jsonOk({ ok: true, clusters }, NO_STORE_HEADERS)
  }
  throw new ExtractorError("invalid op", 400)
}
```

路由：

```ts
case "/api/me/characters": {
  if (req.method === "GET") return handleCharactersGet(url)
  if (req.method === "PUT") return await handleCharactersPut(req)
  if (req.method === "PATCH") return await handleCharactersPatch(req)
  if (req.method === "DELETE") return handleCharactersDelete(url)
  throw new ExtractorError("method not allowed", 405)
}
```

`import { normalizeCharacterName, isHue } from "@workspace/core/character-highlight"`

- [ ] **Step 2: 更新 AGENTS.md API 表**

替换 characters 三行为：

| 方法 | 路径 | 行为 |
| GET | `/api/me/characters` | `{ scope, clusters: [{ id, hue, names }] }` |
| PUT | `/api/me/characters` | body `{ kind, id, name, clusterId? }` → `{ ok, cluster, clusters }`；跨组同名 409 |
| PATCH | `/api/me/characters` | body `{ kind, id, op: merge\|split\|recolor, ... }` → `{ ok, clusters }` |
| DELETE | `/api/me/characters` | `{ ok, removed }` |

export 行改为含 `character_clusters`，并注明 `version: 2`。

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`

Expected: API/core 过；web 仍可能因 `CharacterName` / `colorIndex` 红（Task 8–9 修）。若 `packages/core` 与 `apps/api` 的 typecheck 可单独跑则先保证这两包 PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts AGENTS.md
git commit -m "$(cat <<'EOF'
feat(api): cluster characters list attach merge split recolor

EOF
)"
```

---

### Task 7: 高亮纯函数与 CSS

**Files:**
- Modify: `packages/core/src/character-highlight.ts`
- Modify: `packages/core/src/character-highlight.test.ts`
- Modify: `packages/ui/src/styles/globals.css`

**Interfaces:**
- Consumes: `CharacterMark` / `clampHue`
- Produces: `characterHighlight(html, characters: CharacterMark[]): string` 输出  
  `<mark class="character-mark" style="--character-mark-h: H">`  
  删除 `COLOR_COUNT`、`colorSlot`

- [ ] **Step 1: 改高亮测试**

把所有 `{ name, colorIndex: N }` 改成 `{ name, hue: LEGACY_SLOT_HUE[N] ?? N }`。期望 HTML：

```ts
'<mark class="character-mark" style="--character-mark-h: 160">王小明</mark>'
```

（原 slot 1 → 160。）锚点用例 slot 2 → hue 220。CJK 用例 hue 85。

删 `colorSlot wraps` 测试。加：

```ts
test("clamps hue in style attribute", () => {
  const out = characterHighlight("<p>甲</p>", [{ name: "甲", hue: 400 }])
  expect(out).toContain('style="--character-mark-h: 40"')
  expect(out).not.toMatch(/400/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/character-highlight.test.ts`

Expected: FAIL（仍输出 `character-mark--N`）

- [ ] **Step 3: 改 `characterHighlight`**

`characters: CharacterMark[]`（或 `{ name: string; hue: number }[]`）。hits 存 `hue: number`（`clampHue`）。输出：

```ts
out += `<mark class="character-mark" style="--character-mark-h: ${h.hue}">`
```

删除 `COLOR_COUNT` 与 `colorSlot`。

- [ ] **Step 4: 改 CSS**

删除 `.character-mark--0`…`--5` 及其 `.dark` 规则。用 hue 变量生成 `--character-mark-bg`。

**保留**现有 `.reading-body mark.character-mark` 的 `color` / `border-radius` / `padding: 0 0.1em` / `background`（这是 v1 已有排版，不是本功能新增；不要删 padding）。

```css
.character-mark,
.character-swatch {
  --character-mark-bg: oklch(0.92 0.06 var(--character-mark-h));
}
.dark .character-mark,
.dark .character-swatch {
  --character-mark-bg: oklch(0.35 0.06 var(--character-mark-h));
}
.reading-body mark.character-mark {
  color: inherit;
  border-radius: 0.15em;
  padding: 0 0.1em;
  background: var(--character-mark-bg);
}
.character-swatch {
  background: var(--character-mark-bg);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test packages/core`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/character-highlight.ts packages/core/src/character-highlight.test.ts packages/ui/src/styles/globals.css
git commit -m "$(cat <<'EOF'
feat(highlight): color marks with oklch hue variable

EOF
)"
```

---

### Task 8: Hook、色点、正文类型

**Files:**
- Create: `apps/web/src/components/character-swatch.tsx`
- Modify: `apps/web/src/hooks/use-characters.ts`
- Modify: `apps/web/src/components/article-view.tsx`

**Interfaces:**
- Consumes: `CharacterCluster`, `CharacterMark`, `flattenClusterMarks`
- Produces:
  - `useCharacters` → `{ clusters, marks, scope, error, loading, reload, add, remove, merge, split, recolor }`
  - `add(name: string, clusterId?: number)`
  - `merge(clusterIds: number[], hue: number)` 等 PATCH
  - `ContentBody`/`ArticleView` 的 `characters?: CharacterMark[]`
  - `CharacterSwatch({ hue }: { hue: number })`

- [ ] **Step 1: `character-swatch.tsx`**

```tsx
import { clampHue } from "@workspace/core/character-highlight"
import { cn } from "@workspace/ui/lib/utils"

export function CharacterSwatch({
  hue,
  className,
}: {
  hue: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("character-swatch size-2.5 shrink-0 rounded-full", className)}
      style={{ ["--character-mark-h"]: String(clampHue(hue)) } as React.CSSProperties}
    />
  )
}
```

若 React 类型不在作用域，改用 `import type { CSSProperties } from "react"`。

- [ ] **Step 2: 重写 `use-characters.ts`**

State：`clusters: CharacterCluster[]`。  
`marks = useMemo(() => flattenClusterMarks(clusters), [clusters])`。

GET：`setClusters(json.clusters ?? [])`。

`add(name, clusterId?)`：PUT body 带可选 `clusterId`；成功 `setClusters(json.clusters)`。

`remove`：乐观更新滤掉该 name、丢掉空 cluster；失败 `reload`：

```ts
setClusters((prev) =>
  prev
    .map((c) =>
      c.names.includes(name)
        ? { ...c, names: c.names.filter((n) => n !== name) }
        : c
    )
    .filter((c) => c.names.length > 0)
)
```

最后一个称呼被删时乐观更新会去掉该 cluster，与 store `pruneEmptyClusters` 一致。

`merge` / `split` / `recolor`：`fetch` PATCH `{ kind, id, op, ... }`，成功 `setClusters(json.clusters)`，失败 throw。

- [ ] **Step 3: `article-view.tsx`**

两处 `characters?: { name: string; colorIndex: number }[]` 改为 `{ name: string; hue: number }[]`。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/character-swatch.tsx apps/web/src/hooks/use-characters.ts apps/web/src/components/article-view.tsx
git commit -m "$(cat <<'EOF'
feat(web): cluster-aware character hook and hue swatch

EOF
)"
```

（此步 `typecheck` 仍会因 Panel/Toolbar/Pages 红，下一任务修。）

---

### Task 9: 面板、浮条、mark 浮层、页面接线

**Files:**
- Modify: `apps/web/src/components/character-panel.tsx`
- Modify: `apps/web/src/components/character-selection-toolbar.tsx`
- Modify: `apps/web/src/components/character-mark-popover.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`
- Modify: `apps/web/src/pages/BookPage.tsx`

**Interfaces:**
- Consumes: `clusters` / `marks` / `add(name, clusterId?)` / `merge` / `split` / `recolor` / `CharacterSwatch`
- Produces: spec 第 3 节 UI

- [ ] **Step 1: Popover**

Props：`{ name, rect, hue?: number, clusterNames?: string[], onRemove, onClose }`。

色点用 `<CharacterSwatch hue={hue} />`。  
`clusterNames.filter(n => n !== name)` 非空时在人名下用 `text-xs text-muted-foreground` 显示 `同组：A / B`。

- [ ] **Step 2: Toolbar**

Props：`clusters: CharacterCluster[]`；`onAdd: (name: string, clusterId?: number) => void`；`onRemove` 不变。

`exists = clusters.some(c => c.names.includes(anchor.name))`。

已存在：只渲染「取消标记」。

不存在：主按钮「标记为人物」→ `onAdd(name)`；其下 cluster 列表容器 `className="flex max-h-48 flex-col overflow-y-auto"`（人名很多时不要撑出视口），每项：`<CharacterSwatch hue={c.hue} />` + `c.names.join(" / ")` → `onAdd(name, c.id)`。浮条整体仍 `flex-col`。

- [ ] **Step 3: Panel**

Props 用 `clusters: CharacterCluster[]`，并增加：

```ts
onRemove: (name: string) => void
onSplit: (clusterId: number, name: string) => void
onMerge: (clusterIds: number[], hue: number) => void
onRecolor: (clusterId: number, hue: number) => void
```

本地 state：`recolorId: number | null`、`mergeFrom: number | null`、`mergeHue: number`。

每个 cluster 一行：

- `<CharacterSwatch hue={c.hue} />` 点击 → `setRecolorId(c.id)`；若已打开则显示 range。React 里 range 的 `onChange` 会在拖动中连续触发，**不要**每次都 `onRecolor`。本地 `draftHue` 跟滑块；用 **200ms debounce** 调 `onRecolor`（覆盖旧 iOS 上 `pointerup` 可能不触发）。卸载或关掉滑块时 `clearTimeout`。
  ```tsx
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitHue = (id: number, hue: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onRecolor(id, hue), 200)
  }
  // <input type="range" min={0} max={359} className="reading-range"
  //   value={draftHue} onChange={(e) => { const h = Number(e.target.value); setDraftHue(h); commitHue(c.id, h) }} />
  ```
- `c.names` 各一枚：名 + 删除；`c.names.length > 1` 时「拆出」→ `onSplit(c.id, name)`
- 「与其他人合并」→ `setMergeFrom(c.id)`；`mergeFrom === c.id` 时列出其它组按钮「并入」，点后用两组 hue 做成两个色块（点选 `mergeHue`）+ range；确认 `onMerge([mergeFrom, otherId], mergeHue)` 后 `setMergeFrom(null)`

merge 成功后不要保留 `mergeFrom`（父组件会换新 clusters；本组件在 confirm 时清 state）。

空态文案可改为：「还没有人物。在正文中选中人名即可标记；也可把多个称呼并成同一人，颜色会一致。」

- [ ] **Step 4: ReadPage / BookPage**

```ts
const {
  clusters, marks, error: charactersError, loading, reload: reloadCharacters,
  add, remove, merge, split, recolor,
} = useCharacters(...)
```

- `ArticleView characters={marks}`
- `CharacterPanel clusters={clusters} onSplit=... onMerge=... onRecolor=...`
- `CharacterSelectionToolbar clusters={clusters} onAdd={(n, cid) => void handleAdd(n, cid)}`
- Popover：

```ts
const cluster = clusters.find((c) => c.names.includes(markPopup.name))
// hue={cluster?.hue} clusterNames={cluster?.names}
```

`handleAdd` 改为 `(name: string, clusterId?: number)`，调用 `add(name, clusterId)`。409 时 `setMutationError` 为「该称呼已属于其他人，请到面板合并」。

全仓搜 `colorIndex`、`colorSlot`、`CharacterName`、`listCharacters`、`characters.find`，清零。

- [ ] **Step 5: 验证**

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/character-panel.tsx apps/web/src/components/character-selection-toolbar.tsx apps/web/src/components/character-mark-popover.tsx apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): alias attach merge split and recolor UI

EOF
)"
```

---

## 手动验收（实现后）

1. 标记「林远」，选「少爷」挂同一组 → 同色；第三人不同色。
2. 面板改色（含切 `.dark`）→ 组内称呼与色点一起变。
3. 合并两组并拉色相条 → 同色；无悬空合并 UI。
4. 拆出「少爷」→ 新色；「林远」不变。
5. 关高亮无 mark；链接内 mark 取消且不跳转。
6. **回归：** 同组两帖共享；离组后恢复旧 post 名单（若有）。
7. `/api/me/export` 的 JSON `version === 2` 且含 `character_clusters`。

## Self-review（对照 spec）

| Spec | Task |
| --- | --- |
| cluster 表 + names.cluster_id | 2 |
| pickHue / 迁移 hue 映射 | 1, 2 |
| PRAGMA color_index 检测 | 2 |
| pruneEmptyClusters | 3 |
| deleteGroupCascade 双删 | 3 |
| PUT 挂靠 / 409 | 3, 6 |
| PATCH merge/split/recolor | 4, 6 |
| 路由加 PATCH | 6 |
| export v2 | 5 |
| inventory 按 names 计数 | 5 |
| highlight `--character-mark-h` | 7 |
| `.character-swatch` 暗色 | 7, 8 |
| useCharacters clusters/marks | 8 |
| article-view hue 类型 | 8 |
| 浮条挂靠、面板合并/拆/改色、popover 同组 | 9 |
| merge 后清选中 | 9（`mergeFrom` 确认时清空） |
| 不改上游 HTML / DOMPurify | 全局约束 |
| v1 离组回归 | 手动 6 |
| 索引在迁移后创建（旧库不崩） | 2 |
| 浮条 cluster 列表限高 | 9 |
| recolor debounce 200ms | 9 |
