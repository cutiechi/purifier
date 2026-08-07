# 持久化分组 · 搜索相似 · 收藏分组 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「同书章节折叠」从纯前端临时组升级为 SQLite 持久化分组：支持按书名「搜索相似」并把结果原地并入分组、分组作为独立收藏实体在收藏页展示。

**Architecture:** 三层。`packages/core` 新增 `groups` / `group_items` 两表（`PRAGMA foreign_keys = ON`），`Store` 增加 5 个分组方法；`apps/api` 新增 `/api/me/groups*` 路由（前缀匹配挂在 `switch` 前）；`apps/web` 新增 `/groups` 分组管理页、共享 `SimilarSearchPanel` 组件，并接入全部折叠页与 Me 列表。组 key 由前端 `normalizeTitleKey(parseListTitle(title).title)` 计算随请求传入，服务端当不透明标识（不搬标题解析）。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19 + React Router 7、Tailwind 4、lucide-react。

## Global Constraints

- 全仓 Prettier：**无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`**（所有代码块按此写）。
- TypeScript `strict`；核心验证 `bun run test` / `bun run typecheck` / `bun run build`。
- 分组只收录论坛帖（`kind=post, site=1`）；`xbookcn`（site=2）不参与。
- 组 key 由前端计算，服务端不解析标题；`key` ≤128、`title` ≤512、`tid` 非空且 `/^[A-Za-z0-9]+$/` ≤64。
- `/api/me/*` 响应一律 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`，`ExtractorError` 带 statusCode。
- `GET /api/me/favorites` 响应结构不变；收藏页分组区块由前端单独拉 `GET /api/me/groups` 过滤 `favorited`。
- App.tsx 全部同步 import，不引入 React.lazy；具体路由注册在 catch-all `path="*"` 之前。
- 前端路径常量只放 `routes.ts`；`lib/groups.ts` 只放类型与纯函数 helper。
- 组件不做单测（仓库无组件测试基建），靠 typecheck + 手动验证；纯函数进 `bun test`。

---

## Task 1: DB 表结构 + 外键开关

**Files:**
- Modify: `packages/core/src/storage/db.ts`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `openDatabase()` 保证建出 `groups` / `group_items` 表且 `PRAGMA foreign_keys = 1`。

- [ ] **Step 1: 写失败测试**

修改 `store.test.ts` 的 `openDatabase` 用例，断言新表与 FK 开关：

```ts
test("creates items/favorites/tags/groups tables", () => {
  const dir = tempDir()
  const db = openDatabase(dir)
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  expect(rows.map((r) => r.name)).toEqual([
    "favorites",
    "group_items",
    "groups",
    "items",
    "tags",
  ])
  const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }
  expect(fk.foreign_keys).toBe(1)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: FAIL（表名断言 mismatch，`foreign_keys` 为 0）。

- [ ] **Step 3: 实现 DDL + 外键**

在 `db.ts` 的 `DDL` 常量末尾（`idx_favorites_time` 索引之后）追加：

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  genre TEXT,
  favorited INTEGER NOT NULL DEFAULT 0,
  favorited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_items (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  tid TEXT NOT NULL,
  title TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, tid)
);
```

在 `openDatabase` 中紧跟 `db.exec("PRAGMA journal_mode = WAL;")` 之后加一行：

```ts
db.exec("PRAGMA foreign_keys = ON;")
```

（无需参与 `needRebuild` 迁移：新表 `CREATE TABLE IF NOT EXISTS` 即可。）

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add groups tables and enable foreign_keys pragma"
```

---

## Task 2: Store 分组方法

**Files:**
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/store.ts`
- Test: Create `packages/core/src/storage/groups.test.ts`

**Interfaces:**
- Consumes: `Store` 类（`this.db: Database`、`this.now: () => number`）。
- Produces:

```ts
export interface GroupMember { tid: string; title: string }
export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}

// Store 新增方法：
listGroups(q?: string): Group[]
upsertGroup(input: { key: string; title: string; items: GroupMember[]; author?: string | null; genre?: string | null }): Group
deleteGroup(id: number): void
removeGroupItems(id: number, tids: string[]): { removed: number; deleted: boolean }
setGroupFavorite(id: number, favorited: boolean): boolean
```

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/storage/groups.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-groups-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

describe("groups", () => {
  test("upsertGroup 新建组并返回含成员", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "A（1）" },
        { tid: "11", title: "A（2）" },
      ],
      author: "作者",
      genre: "都市",
    })
    expect(g.id).toBeGreaterThan(0)
    expect(g.title).toBe("A")
    expect(g.author).toBe("作者")
    expect(g.genre).toBe("都市")
    expect(g.favorited).toBe(false)
    expect(g.items.map((i) => i.tid)).toEqual(["10", "11"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("同 key 二次 upsert 只落一组、并入新成员、保留首快照", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "改过的标题" },
        { tid: "12", title: "A（3）" },
      ],
    })
    expect(store.listGroups()).toHaveLength(1)
    const g = store.listGroups()[0]!
    expect(g.items.map((i) => i.tid)).toEqual(["10", "12"])
    expect(g.items[0]!.title).toBe("A（1）") // IGNORE 保持首次快照
    rmSync(dir, { recursive: true, force: true })
  })

  test("空 items 不建组", () => {
    const { store, dir } = makeStore()
    expect(() =>
      store.upsertGroup({ key: "x", title: "X", items: [] })
    ).toThrow()
    expect(store.listGroups()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("removeGroupItems 移除成员；移除最后成员自动删组", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [
        { tid: "10", title: "A（1）" },
        { tid: "11", title: "A（2）" },
      ],
    })
    expect(store.removeGroupItems(g.id, ["10"])).toEqual({
      removed: 1,
      deleted: false,
    })
    expect(store.listGroups()[0]!.items.map((i) => i.tid)).toEqual(["11"])
    expect(store.removeGroupItems(g.id, ["11"])).toEqual({
      removed: 1,
      deleted: true,
    })
    expect(store.listGroups()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteGroup 级联清理 group_items", () => {
    const { store, db, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    store.deleteGroup(g.id)
    const rows = db
      .query("SELECT COUNT(*) AS n FROM group_items")
      .get() as { n: number }
    expect(Number(rows.n)).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("setGroupFavorite 置位/复位，取消后 favorited_at 为 NULL；组不存在返回 false", () => {
    const { store, dir } = makeStore()
    const g = store.upsertGroup({
      key: "a",
      title: "A",
      items: [{ tid: "10", title: "A（1）" }],
    })
    expect(store.setGroupFavorite(g.id, true)).toBe(true)
    expect(store.listGroups()[0]!.favorited).toBe(true)
    expect(store.listGroups()[0]!.favorited_at).not.toBeNull()
    store.setGroupFavorite(g.id, false)
    const after = store.listGroups()[0]!
    expect(after.favorited).toBe(false)
    expect(after.favorited_at).toBeNull()
    expect(store.setGroupFavorite(9999, true)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listGroups 内嵌成员、q 过滤、updated_at DESC", () => {
    const { store, dir } = makeStore()
    store.upsertGroup({
      key: "a",
      title: "Alpha",
      items: [{ tid: "1", title: "Alpha（1）" }],
    })
    store.upsertGroup({
      key: "b",
      title: "Beta",
      items: [{ tid: "2", title: "Beta（1）" }],
    })
    expect(store.listGroups().map((g) => g.title)).toEqual(["Beta", "Alpha"])
    expect(store.listGroups("alpha").map((g) => g.title)).toEqual(["Alpha"])
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/groups.test.ts`
Expected: FAIL（`store.upsertGroup is not a function` / `listGroups is not a function`）。

- [ ] **Step 3: 实现类型与方法**

在 `packages/core/src/storage/types.ts` 末尾追加：

```ts
export interface GroupMember {
  tid: string
  title: string
}

export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}
```

在 `packages/core/src/storage/store.ts` 的 `Store` 类内、`close()` 之前追加以下方法：

```ts
listGroups(q?: string): Group[] {
  const rows = this.db
    .query(
      `SELECT id, key, title, author, genre, favorited, favorited_at, created_at, updated_at
       FROM groups
       WHERE (?1 = '' OR title LIKE '%' || ?1 || '%' COLLATE NOCASE)
       ORDER BY updated_at DESC, id DESC`
    )
    .all(q ?? "") as {
    id: number
    key: string
    title: string
    author: string | null
    genre: string | null
    favorited: number
    favorited_at: number | null
    created_at: number
    updated_at: number
  }[]
  const items = this.db
    .query("SELECT group_id, tid, title FROM group_items ORDER BY added_at, rowid")
    .all() as { group_id: number; tid: string; title: string }[]
  const byGroup = new Map<number, GroupMember[]>()
  for (const it of items) {
    const arr = byGroup.get(it.group_id)
    if (arr) arr.push({ tid: it.tid, title: it.title })
    else byGroup.set(it.group_id, [{ tid: it.tid, title: it.title }])
  }
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    title: r.title,
    author: r.author,
    genre: r.genre,
    favorited: r.favorited === 1,
    favorited_at: r.favorited_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    items: byGroup.get(r.id) ?? [],
  }))
}

upsertGroup(input: {
  key: string
  title: string
  items: GroupMember[]
  author?: string | null
  genre?: string | null
}): Group {
  if (input.items.length === 0) {
    throw new Error("items must not be empty")
  }
  const now = this.now()
  const run = this.db.transaction(() => {
    this.db
      .query(
        `INSERT INTO groups (key, title, author, genre, favorited, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
         ON CONFLICT(key) DO UPDATE SET
           title      = excluded.title,
           author     = COALESCE(groups.author, excluded.author),
           genre      = COALESCE(groups.genre,  excluded.genre),
           updated_at = excluded.updated_at`
      )
      .run(input.key, input.title, input.author ?? null, input.genre ?? null, now)
    // ON CONFLICT DO UPDATE 路径下 last_insert_rowid() 不可靠，统一按 key 回查
    const row = this.db
      .query("SELECT id FROM groups WHERE key = ?1")
      .get(input.key) as { id: number }
    const insert = this.db.query(
      "INSERT OR IGNORE INTO group_items (group_id, tid, title, added_at) VALUES (?1, ?2, ?3, ?4)"
    )
    for (const it of input.items) insert.run(row.id, it.tid, it.title, now)
    return row.id
  })
  const id = run()
  return this.listGroups().find((g) => g.id === id)!
}

deleteGroup(id: number): void {
  const run = this.db.transaction(() => {
    this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
    this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
  })
  run()
}

removeGroupItems(
  id: number,
  tids: string[]
): { removed: number; deleted: boolean } {
  let removed = 0
  const run = this.db.transaction(() => {
    const del = this.db.query(
      "DELETE FROM group_items WHERE group_id = ?1 AND tid = ?2"
    )
    for (const tid of tids) removed += Number(del.run(id, tid).changes ?? 0)
    const remaining = this.db
      .query("SELECT COUNT(*) AS n FROM group_items WHERE group_id = ?1")
      .get(id) as { n: number }
    if (Number(remaining.n ?? 0) === 0) {
      this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
      this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
      return true
    }
    this.db
      .query("UPDATE groups SET updated_at = ?2 WHERE id = ?1")
      .run(id, this.now())
    return false
  })
  return { removed, deleted: run() }
}

setGroupFavorite(id: number, favorited: boolean): boolean {
  const exists = this.db
    .query("SELECT 1 FROM groups WHERE id = ?1")
    .get(id)
  if (!exists) return false
  if (favorited) {
    this.db
      .query(
        "UPDATE groups SET favorited = 1, favorited_at = ?2 WHERE id = ?1"
      )
      .run(id, this.now())
  } else {
    this.db
      .query("UPDATE groups SET favorited = 0, favorited_at = NULL WHERE id = ?1")
      .run(id)
  }
  return true
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && bun test src/storage/groups.test.ts`
Expected: PASS（7 个用例）。再跑 `cd packages/core && bun test` 确认既有 store/cache 测试不回归。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/store.ts packages/core/src/storage/groups.test.ts
git commit -m "feat(core): add Store group methods (list/upsert/delete/removeItems/setFavorite)"
```

---

## Task 3: API `/api/me/groups*` 路由

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `store.listGroups / upsertGroup / deleteGroup / removeGroupItems / setGroupFavorite`（Task 2）、`ExtractorError` / `jsonOk` / `jsonError` / `NO_STORE_HEADERS`（已 import）。
- Produces: 新端点 `GET /api/me/groups?q=`、`PUT /api/me/groups`、`DELETE /api/me/groups/:id`、`DELETE /api/me/groups/:id/items`、`PUT|DELETE /api/me/groups/:id/favorite`。

（仓库无 API 集成测试基建，本任务验证方式 = typecheck + 手动 curl。）

- [ ] **Step 1: 加 handler 函数**

在 `apps/api/src/index.ts` 中、`handleCacheClear` 之后追加：

```ts
function handleGroupsList(url: URL): Response {
  const q = url.searchParams.get("q")?.trim() ?? ""
  return jsonOk({ groups: store.listGroups(q) }, NO_STORE_HEADERS)
}

function isGroupMember(it: unknown): it is { tid: string; title: string } {
  if (!it || typeof it !== "object") return false
  const tid = "tid" in it ? it.tid : undefined
  const title = "title" in it ? it.title : undefined
  return (
    typeof tid === "string" &&
    /^[A-Za-z0-9]+$/.test(tid) &&
    tid.length <= 64 &&
    typeof title === "string" &&
    title.length > 0 &&
    title.length <= 512
  )
}

/** 移除成员 body 单条：只要 { tid }（与 upsert 不同，不含 title） */
function isGroupTidRef(it: unknown): it is { tid: string } {
  if (!it || typeof it !== "object") return false
  const tid = "tid" in it ? it.tid : undefined
  return (
    typeof tid === "string" &&
    /^[A-Za-z0-9]+$/.test(tid) &&
    tid.length <= 64
  )
}

async function handleGroupUpsert(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    throw new ExtractorError("invalid json body", 400)
  }
  const key = "key" in body ? body.key : undefined
  const title = "title" in body ? body.title : undefined
  const items = "items" in body ? body.items : undefined
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 128 ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > 512
  ) {
    throw new ExtractorError("invalid key or title", 400)
  }
  if (!Array.isArray(items) || items.length === 0 || !items.every(isGroupMember)) {
    throw new ExtractorError("items must be a non-empty {tid,title}[]", 400)
  }
  const author = "author" in body && typeof body.author === "string" ? body.author : null
  const genre = "genre" in body && typeof body.genre === "string" ? body.genre : null
  const group = store.upsertGroup({
    key,
    title,
    author,
    genre,
    items: items.map((it) => ({ tid: it.tid, title: it.title })),
  })
  return jsonOk({ ok: true, group }, NO_STORE_HEADERS)
}

function handleGroupDelete(id: number): Response {
  store.deleteGroup(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

async function handleGroupItemsDelete(
  req: Request,
  id: number
): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    throw new ExtractorError("invalid json body", 400)
  }
  const items = "items" in body ? body.items : undefined
  if (!Array.isArray(items) || items.length === 0 || !items.every(isGroupTidRef)) {
    throw new ExtractorError("items must be a non-empty {tid}[]", 400)
  }
  const { removed, deleted } = store.removeGroupItems(
    id,
    items.map((it) => it.tid)
  )
  return jsonOk({ ok: true, removed, deleted }, NO_STORE_HEADERS)
}

function handleGroupFavorite(id: number, favorited: boolean): Response {
  const ok = store.setGroupFavorite(id, favorited)
  if (!ok) throw new ExtractorError("group not found", 404)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}
```

- [ ] **Step 2: 挂路由（放在 `switch (pathname)` 前）**

在 `route()` 中 `try {` 之后、`switch (pathname) {` 之前插入：

```ts
    // /api/me/groups 子资源（id 数字；放在 switch 前独立前缀分支，不干扰 SPA fallback）
    const groupsSub = pathname.match(
      /^\/api\/me\/groups\/(\d+)(?:\/(items|favorite))?$/
    )
    if (groupsSub) {
      const id = Number(groupsSub[1])
      const sub = groupsSub[2]
      if (sub === undefined) {
        if (req.method !== "DELETE") {
          throw new ExtractorError("method not allowed", 405)
        }
        return handleGroupDelete(id)
      }
      if (sub === "items") {
        if (req.method !== "DELETE") {
          throw new ExtractorError("method not allowed", 405)
        }
        return await handleGroupItemsDelete(req, id)
      }
      if (req.method === "PUT") return handleGroupFavorite(id, true)
      if (req.method === "DELETE") return handleGroupFavorite(id, false)
      throw new ExtractorError("method not allowed", 405)
    }
    if (pathname === "/api/me/groups") {
      if (req.method === "GET") return handleGroupsList(url)
      if (req.method === "PUT") return await handleGroupUpsert(req)
      throw new ExtractorError("method not allowed", 405)
    }
```

- [ ] **Step 3: typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: PASS（无未使用变量/类型错误）。

- [ ] **Step 4: 手动冒烟（可选，需上游可达或跳过网络部分）**

Run:
```bash
bun run dev:api
curl -s 'http://127.0.0.1:3001/api/me/groups'            # 期望 {"groups":[]}
curl -s -X PUT 'http://127.0.0.1:3001/api/me/groups' \
  -H 'content-type: application/json' \
  -d '{"key":"a","title":"A","items":[{"tid":"1","title":"A（1）"}]}'
curl -s 'http://127.0.0.1:3001/api/me/groups'            # 期望 1 组
curl -s -X PUT 'http://127.0.0.1:3001/api/me/groups/1/favorite'
curl -s -X DELETE 'http://127.0.0.1:3001/api/me/groups/1'
curl -s -X PUT 'http://127.0.0.1:3001/api/me/groups' \
  -H 'content-type: application/json' -d '{"key":"","title":"","items":[]}'  # 期望 400
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add /api/me/groups endpoints"
```

---

## Task 4: 前端 lib（book-groups 导出 + groups helper）

**Files:**
- Modify: `apps/web/src/lib/book-groups.ts`
- Create: `apps/web/src/lib/groups.ts`
- Test: Create `apps/web/src/lib/groups.test.ts`

**Interfaces:**
- Consumes: `book-groups.ts` 的 `normalizeTitleKey`（已导出）与新增导出的 `stripTrailingChapterMarker`、`pickHeaderMeta`；`title-parse.ts` 的 `parseListTitle`。
- Produces:

```ts
// lib/groups.ts
export interface GroupMember { tid: string; title: string }
export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}
export function groupKeyFromTitle(rawTitle: string): string
export function groupSearchTitle(rawTitle: string): string   // 展示书名（strip 章节标记）
export function pickGroupMeta(members: { title: string }[]): { author: string | null; genre: string | null }
```

- [ ] **Step 1: 导出 book-groups 私有函数**

在 `book-groups.ts` 中，把 `function stripTrailingChapterMarker` 改为 `export function stripTrailingChapterMarker`；把 `function pickHeaderMeta` 改为 `export function pickHeaderMeta`。

- [ ] **Step 2: 写失败测试**

创建 `apps/web/src/lib/groups.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { groupBooks } from "@/lib/book-groups"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  pickGroupMeta,
} from "@/lib/groups"

describe("groupKeyFromTitle", () => {
  test("与折叠分组同源：书名号/方括号/裸书名同 key", () => {
    expect(groupKeyFromTitle("【马屌少年】（1）作者：小明")).toBe(
      groupKeyFromTitle("《马屌少年》（2）")
    )
    expect(groupKeyFromTitle("马屌少年")).toBe("马屌少年")
  })

  test("章节标记剥离后并入同 key", () => {
    expect(groupKeyFromTitle("马屌少年（1）作者：小明")).toBe(
      groupKeyFromTitle("马屌少年（完）")
    )
  })

  test("与 groupBooks 对同一 raw 列表产出的 key 一致", () => {
    const raws = ["【马屌少年】（1）作者：小明", "马屌少年（2）", "《为妻子种下一片森林》（13）"]
    const grouped = groupBooks(
      raws.map((t, i) => ({ title: t, tid: String(i) })),
      (l) => l.title,
      (l) => l.tid
    )
    for (const g of grouped) {
      if (g.type === "group") {
        expect(groupKeyFromTitle(g.items[0]!.title)).toBe(g.key)
      }
    }
  })
})

describe("groupSearchTitle", () => {
  test("剥离尾随章节标记", () => {
    expect(groupSearchTitle("马屌少年（2）作者：小明")).toBe("马屌少年")
    expect(groupSearchTitle("【马屌少年】（完）")).toBe("马屌少年")
  })
})

describe("pickGroupMeta", () => {
  test("取首个非空作者/题材", () => {
    const meta = pickGroupMeta([
      { title: "A（1）" },
      { title: "A（2）作者：小明" },
      { title: "A（3）『都市』" },
    ])
    expect(meta).toEqual({ author: "小明", genre: "都市" })
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/web && bun test src/lib/groups.test.ts`
Expected: FAIL（`@/lib/groups` 模块不存在）。

- [ ] **Step 4: 实现 `lib/groups.ts`**

```ts
import {
  normalizeTitleKey,
  pickHeaderMeta,
  stripTrailingChapterMarker,
} from "@/lib/book-groups"
import { parseListTitle } from "@/lib/title-parse"

export interface GroupMember {
  tid: string
  title: string
}

export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}

/** 组 key 与折叠分组同源：normalizeTitleKey(parseListTitle(title).title) */
export function groupKeyFromTitle(rawTitle: string): string {
  return normalizeTitleKey(parseListTitle(rawTitle).title)
}

/** 展示书名：解析后 title 再剥尾随章节标记（与折叠组头一致） */
export function groupSearchTitle(rawTitle: string): string {
  const parsed = parseListTitle(rawTitle)
  return stripTrailingChapterMarker(parsed.title || rawTitle).trim()
}

/** 展示作者/题材：包一层复用 book-groups 的 pickHeaderMeta（组内首个非空） */
export function pickGroupMeta(
  members: { title: string }[]
): { author: string | null; genre: string | null } {
  return pickHeaderMeta(members, (m) => m.title)
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/web && bun test src/lib/groups.test.ts`
Expected: PASS。再跑 `cd apps/web && bun test` 确认 `book-groups.test.ts` 不回归。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/book-groups.ts apps/web/src/lib/groups.ts apps/web/src/lib/groups.test.ts
git commit -m "feat(web): add group lib helpers reusing book-groups normalization"
```

---

## Task 5: 共享组件 SimilarSearchPanel

**Files:**
- Modify: `apps/web/src/lib/routes.ts`（只加 `api.meGroups` 常量）
- Create: `apps/web/src/components/similar-search-panel.tsx`

**Interfaces:**
- Consumes: `api.meGroups`（本任务加）、`api.browse`、`parseListTitle` / `formatTitleMeta`、`pickGroupMeta`（Task 4）、`readPath`、`Group`（Task 4）。
- Produces:

```tsx
export function SimilarSearchPanel({
  title,          // 展示书名（搜索关键词 + PUT title）
  groupKey,       // 分组 key
  seedItems,      // 创建分组时的初始成员
  onChanged,      // 加入成功后回调
}: { title: string; groupKey: string; seedItems: GroupMember[]; onChanged?: () => void })
```

- [ ] **Step 1: routes.ts 加常量**

在 `apps/web/src/lib/routes.ts` 的 `api` 对象中加一行：

```ts
  meGroups: "/api/me/groups",
```

- [ ] **Step 2: 实现组件**

创建 `apps/web/src/components/similar-search-panel.tsx`：

```tsx
import { useEffect, useRef, useState } from "react"
import { IconSearch } from "@/components/icons"
import { PostCard, PostList } from "@/components/post-card"
import { Spinner } from "@/components/ui-state"
import { type Group, type GroupMember, pickGroupMeta } from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

interface SearchHit {
  index: number
  title: string
  tid: string
}

interface BrowseResponse {
  links: SearchHit[]
  nextPage: number | null
}

export function SimilarSearchPanel({
  title,
  groupKey,
  seedItems,
  onChanged,
  showTrigger = true,
}: {
  title: string
  groupKey: string
  seedItems: GroupMember[]
  onChanged?: () => void
  /** false：折叠组场景，trigger 由 CollapsibleBookGroup 渲染，面板自身展开渲染结果 */
  showTrigger?: boolean
}) {
  const [open, setOpen] = useState(!showTrigger)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<SearchHit[]>([])
  const [known, setKnown] = useState<Set<string>>(
    () => new Set(seedItems.map((s) => s.tid))
  )
  const [busyTid, setBusyTid] = useState<string | null>(null)
  // seedItems 随父级每次渲染重建，用 ref 避免进 effect 依赖造成重复拉取
  const seedRef = useRef(seedItems)
  seedRef.current = seedItems

  async function load() {
    setLoading(true)
    setError("")
    try {
      // 「已加入」以服务端为准：每次展开都拉（个人组量小，不做跨页缓存）
      let serverTids: Set<string> = new Set()
      const gRes = await fetch(api.meGroups)
      if (gRes.ok) {
        const gJson = (await gRes.json()) as { groups: Group[] }
        serverTids = new Set(
          (gJson.groups ?? []).find((g) => g.key === groupKey)?.items.map((i) => i.tid) ??
            []
        )
      }
      const res = await fetch(
        `${api.browse}?q=${encodeURIComponent(title)}&site=1`
      )
      const json = (await res.json()) as BrowseResponse
      if (!res.ok) {
        setError((json as { error?: string }).error || "请求失败")
        return
      }
      setResults(json.links ?? [])
      setKnown(new Set([...serverTids, ...seedRef.current.map((s) => s.tid)]))
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  // open 变化时拉取（showTrigger=false 时挂载即 open，重展开=重挂载=重拉，符合"以服务端为准"）
  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, groupKey])

  async function addToGroup(hit: SearchHit) {
    setBusyTid(hit.tid)
    try {
      const meta = pickGroupMeta([
        ...seedRef.current,
        { tid: hit.tid, title: hit.title },
      ])
      const res = await fetch(api.meGroups, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: groupKey,
          title,
          author: meta.author,
          genre: meta.genre,
          items: [
            ...seedRef.current,
            { tid: hit.tid, title: hit.title },
          ],
        }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        setError(json.error || "加入失败")
        return
      }
      setKnown((prev) => new Set(prev).add(hit.tid))
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setBusyTid(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            open
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <IconSearch size={13} />
          搜索相似
        </button>
      )}
      {open && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
          {loading ? (
            <Spinner className="py-4" />
          ) : error ? (
            <div className="flex flex-col items-start gap-2 py-2">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg bg-accent px-2.5 py-1 text-xs text-foreground"
              >
                重试
              </button>
            </div>
          ) : results.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              没有找到「{title}」相关内容
            </p>
          ) : (
            <PostList className="gap-1.5">
              {results.map((hit) => {
                const parsed = parseListTitle(hit.title)
                const added = known.has(hit.tid)
                return (
                  <div key={hit.tid} className="flex items-center gap-2">
                    <PostCard
                      href={readPath(hit.tid)}
                      title={parsed.title || hit.title}
                      subtitle={formatTitleMeta(parsed) || undefined}
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      disabled={added || busyTid === hit.tid}
                      onClick={() => void addToGroup(hit)}
                      className={cn(
                        "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                        added
                          ? "bg-muted/50 text-muted-foreground"
                          : "bg-accent text-foreground hover:bg-accent/80"
                      )}
                    >
                      {added
                        ? "已加入"
                        : busyTid === hit.tid
                          ? "加入中…"
                          : "加入本组"}
                    </button>
                  </div>
                )
              })}
            </PostList>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/routes.ts apps/web/src/components/similar-search-panel.tsx
git commit -m "feat(web): add SimilarSearchPanel component"
```

---

## Task 6: CollapsibleBookGroup 支持 similar

**Files:**
- Modify: `apps/web/src/components/collapsible-book-group.tsx`

**Interfaces:**
- Consumes: `SimilarSearchPanel`（Task 5）、`GroupMember`（Task 4）、`IconSearch`。
- Produces: `CollapsibleBookGroup` 新增可选 prop：

```ts
similar?: {
  title: string
  groupKey: string
  seedItems: GroupMember[]
  onChanged?: () => void
}
```

- [ ] **Step 1: 修改组件**

在 `collapsible-book-group.tsx` 中加 `useState` import 与 `IconSearch` import，并新增 `similar` prop 与 `showSimilar` state。完整替换后的组件体：

```tsx
import { type ReactNode, useId, useState } from "react"
import { IconBookOpen, IconChevronDown, IconSearch } from "@/components/icons"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { type GroupMember } from "@/lib/groups"
import { cn } from "@workspace/ui/lib/utils"

export function CollapsibleBookGroup({
  title,
  summary,
  count,
  bookKey,
  isExpanded,
  onToggle,
  trailing,
  similar,
  children,
}: {
  title: string
  summary?: string
  count: number
  bookKey: string
  isExpanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  similar?: {
    title: string
    groupKey: string
    seedItems: GroupMember[]
    onChanged?: () => void
  }
  children: ReactNode
}) {
  const contentId = `book-content-${useId()}`
  void bookKey
  const [showSimilar, setShowSimilar] = useState(false)
  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left sm:gap-3.5 sm:px-4 sm:py-4"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconBookOpen size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
            {title}
          </span>
          {summary && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        {trailing}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          共 {count} 章
        </span>
        <IconChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground/50 transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>
      {similar && (
        <div className="border-t border-border/60 px-3.5 py-1.5 sm:px-4">
          <SimilarSearchPanel
            title={similar.title}
            groupKey={similar.groupKey}
            seedItems={similar.seedItems}
            onChanged={similar.onChanged}
          />
        </div>
      )}
      {isExpanded && (
        <div
          id={contentId}
          role="region"
          aria-label={title}
          className="flex flex-col gap-2 px-3.5 pb-3.5 transition-opacity duration-150 sm:gap-2.5 sm:px-4 sm:pb-4"
        >
          {children}
          {similar && showSimilar && (
            <SimilarSearchPanel
              title={similar.title}
              groupKey={similar.groupKey}
              seedItems={similar.seedItems}
              onChanged={similar.onChanged}
            />
          )}
        </div>
      )}
    </div>
  )
}
```

> 折叠组用法：trigger 由 `CollapsibleBookGroup` 自己渲染（常驻、点击时联动展开），`SimilarSearchPanel` 只负责结果区（`showTrigger={false}`，挂载即展开）。

- [ ] **Step 1: SimilarSearchPanel 增加 `showTrigger` prop**

已在 Task 5 的实现中带 `showTrigger?: boolean`（默认 `true`；`false` 时隐藏自带 trigger、`open` 初始为 `true`）。此处无需改动，仅确认 Task 5 已落地。

- [ ] **Step 2: CollapsibleBookGroup 实现**

```tsx
import { type ReactNode, useId, useState } from "react"
import { IconBookOpen, IconChevronDown, IconSearch } from "@/components/icons"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { type GroupMember } from "@/lib/groups"
import { cn } from "@workspace/ui/lib/utils"

export function CollapsibleBookGroup({
  title,
  summary,
  count,
  bookKey,
  isExpanded,
  onToggle,
  trailing,
  similar,
  children,
}: {
  title: string
  summary?: string
  count: number
  bookKey: string
  isExpanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  similar?: {
    title: string
    groupKey: string
    seedItems: GroupMember[]
    onChanged?: () => void
  }
  children: ReactNode
}) {
  const contentId = `book-content-${useId()}`
  void bookKey
  const [showSimilar, setShowSimilar] = useState(false)
  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left sm:gap-3.5 sm:px-4 sm:py-4"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconBookOpen size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
            {title}
          </span>
          {summary && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        {trailing}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          共 {count} 章
        </span>
        <IconChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground/50 transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>
      {similar && (
        <button
          type="button"
          onClick={() => {
            if (!isExpanded) onToggle()
            setShowSimilar((v) => !v)
          }}
          aria-expanded={showSimilar}
          className="flex items-center gap-1.5 border-t border-border/60 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-4"
        >
          <IconSearch size={13} />
          搜索相似
        </button>
      )}
      {isExpanded && (
        <div
          id={contentId}
          role="region"
          aria-label={title}
          className="flex flex-col gap-2 px-3.5 pb-3.5 transition-opacity duration-150 sm:gap-2.5 sm:px-4 sm:pb-4"
        >
          {children}
          {similar && showSimilar && (
            <SimilarSearchPanel
              title={similar.title}
              groupKey={similar.groupKey}
              seedItems={similar.seedItems}
              onChanged={similar.onChanged}
              showTrigger={false}
            />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/collapsible-book-group.tsx apps/web/src/components/similar-search-panel.tsx
git commit -m "feat(web): CollapsibleBookGroup similar trigger with expand linkage"
```

---

## Task 7: 单条包装 SimilarPostCard / SimilarMeItemCard

**Files:**
- Create: `apps/web/src/components/similar-post-card.tsx`
- Create: `apps/web/src/components/similar-me-item-card.tsx`

**Interfaces:**
- Consumes: `ListPostCard`、`MeItemCard` / `MeListItem`、`SimilarSearchPanel`、`groupKeyFromTitle` / `groupSearchTitle`（Task 4）、`SiteId`。
- Produces:

```tsx
export function SimilarPostCard(props: {
  href: string
  rawTitle: string
  tid: string
  site: SiteId
  rank?: number
  index?: number
  statValue?: number | string
  statUnit?: string
  showGenre?: boolean
  className?: string
}): ReactNode

export function SimilarMeItemCard(props: {
  item: MeListItem
  trailing?: ReactNode
}): ReactNode
```

- [ ] **Step 1: 实现 SimilarPostCard**

创建 `apps/web/src/components/similar-post-card.tsx`：

```tsx
import { type ReactNode } from "react"
import { ListPostCard } from "@/components/list-post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  type GroupMember,
} from "@/lib/groups"
import type { SiteId } from "@/lib/routes"

export function SimilarPostCard({
  href,
  rawTitle,
  tid,
  site,
  rank,
  index,
  statValue,
  statUnit,
  showGenre,
  className,
}: {
  href: string
  rawTitle: string
  tid: string
  site: SiteId
  rank?: number
  index?: number
  statValue?: number | string
  statUnit?: string
  showGenre?: boolean
  className?: string
}): ReactNode {
  const groupKey = groupKeyFromTitle(rawTitle)
  if (site !== "1" || !groupKey) {
    return (
      <ListPostCard
        href={href}
        rawTitle={rawTitle}
        rank={rank}
        index={index}
        statValue={statValue}
        statUnit={statUnit}
        showGenre={showGenre}
        className={className}
      />
    )
  }
  const seed: GroupMember = { tid, title: rawTitle }
  return (
    <div className="flex flex-col gap-1.5">
      <ListPostCard
        href={href}
        rawTitle={rawTitle}
        rank={rank}
        index={index}
        statValue={statValue}
        statUnit={statUnit}
        showGenre={showGenre}
        className={className}
      />
      <SimilarSearchPanel
        title={groupSearchTitle(rawTitle)}
        groupKey={groupKey}
        seedItems={[seed]}
      />
    </div>
  )
}
```

- [ ] **Step 2: 实现 SimilarMeItemCard**

创建 `apps/web/src/components/similar-me-item-card.tsx`：

```tsx
import { type ReactNode } from "react"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  type GroupMember,
} from "@/lib/groups"

export function SimilarMeItemCard({
  item,
  trailing,
}: {
  item: MeListItem
  trailing?: ReactNode
}): ReactNode {
  const groupKey = groupKeyFromTitle(item.title)
  if (item.kind !== "post" || item.site !== "1" || !groupKey) {
    return <MeItemCard item={item} trailing={trailing} />
  }
  const seed: GroupMember = { tid: item.id, title: item.title }
  return (
    <div className="flex flex-col gap-1.5">
      <MeItemCard item={item} trailing={trailing} />
      <SimilarSearchPanel
        title={groupSearchTitle(item.title)}
        groupKey={groupKey}
        seedItems={[seed]}
      />
    </div>
  )
}
```

- [ ] **Step 3: typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/similar-post-card.tsx apps/web/src/components/similar-me-item-card.tsx
git commit -m "feat(web): single-post similar wrappers"
```

---

## Task 8: 分组页 `/groups` + 路由注册

**Files:**
- Create: `apps/web/src/pages/GroupPage.tsx`
- Modify: `apps/web/src/lib/routes.ts`（`routes.groups` + NAV 项）
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `api.meGroups`、`Group`（Task 4）、`SimilarSearchPanel`、`useExpandedBooks`、`PageHeader` / `PageShell` / `AsyncBody` / `PostList`、lucide `Star` / `Trash2` / `ChevronDown`。
- Produces: `/groups` 页面；`routes.groups = "/groups"`；NAV 加「分组」；App 注册路由。

- [ ] **Step 1: routes.ts 加路径与导航**

在 `routes` 对象加 `groups: "/groups",`；在 `NAV_ITEMS` 中「搜索」之后插入：

```ts
  {
    href: routes.groups,
    label: "分组",
    sites: ["1"],
    match: (p: string) => p === routes.groups,
  },
```

- [ ] **Step 2: 实现 GroupPage**

创建 `apps/web/src/pages/GroupPage.tsx`：

```tsx
import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Star, Trash2 } from "lucide-react"
import { IconBookOpen } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { AsyncBody } from "@/components/ui-state"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { type Group } from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

function GroupCard({
  group,
  isExpanded,
  onToggle,
  onChanged,
}: {
  group: Group
  isExpanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function toggleFavorite() {
    setBusy(true)
    try {
      await fetch(`${api.meGroups}/${group.id}/favorite`, {
        method: group.favorited ? "DELETE" : "PUT",
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(tid: string) {
    const res = await fetch(`${api.meGroups}/${group.id}/items`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ tid }] }),
    })
    if (res.ok) onChanged()
  }

  async function deleteGroup() {
    if (!window.confirm(`删除分组「${group.title}」？`)) return
    const res = await fetch(`${api.meGroups}/${group.id}`, { method: "DELETE" })
    if (res.ok) onChanged()
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 sm:px-4 sm:pt-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconBookOpen size={15} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {group.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {[group.author, group.genre].filter(Boolean).join(" · ") ||
                `共 ${group.items.length} 章`}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            共 {group.items.length} 章
          </span>
          <ChevronDown
            size={16}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => void toggleFavorite()}
          disabled={busy}
          aria-label={group.favorited ? "取消收藏分组" : "收藏分组"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50",
            group.favorited
              ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
              : "bg-muted/70 text-muted-foreground hover:bg-accent"
          )}
        >
          <Star size={15} className={group.favorited ? "fill-current" : undefined} />
        </button>
      </div>
      <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
        <SimilarSearchPanel
          title={group.title}
          groupKey={group.key}
          seedItems={group.items}
          onChanged={onChanged}
        />
      </div>
      {isExpanded && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3.5 py-3 sm:px-4">
          {group.items.map((m) => {
            const parsed = parseListTitle(m.title)
            const sub = formatTitleMeta(
              parsed.chapters ? { ...parsed, chapters: null } : parsed
            )
            return (
              <div key={m.tid} className="flex items-center gap-2">
                <a
                  href={readPath(m.tid)}
                  className="flex min-w-0 flex-1 flex-col rounded-xl bg-muted/40 px-3 py-2 transition-colors hover:bg-accent/60"
                >
                  <span className="line-clamp-1 text-sm font-medium text-foreground">
                    {parsed.chapters || m.title}
                  </span>
                  {sub && (
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  )}
                </a>
                <button
                  type="button"
                  onClick={() => void removeMember(m.tid)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  移除
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => void deleteGroup()}
            className="mt-1 flex items-center justify-center gap-1.5 self-end rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={13} />
            删除分组
          </button>
        </div>
      )}
    </div>
  )
}

export default function GroupPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const { isExpanded, toggle } = useExpandedBooks("groups")

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(api.meGroups)
      const json = (await res.json()) as { groups: Group[] }
      if (!res.ok) {
        setError(String((json as { error?: string }).error || "请求失败"))
        return
      }
      setGroups(json.groups ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <PageShell>
      <PageHeader
        title="分组"
        description="手动维护的收藏分组，可用「搜索相似」补全书目"
      />
      <AsyncBody
        loading={loading}
        error={error}
        empty={groups.length === 0}
        onRetry={() => void reload()}
        emptyText="还没有分组，去列表页点「搜索相似」创建"
      >
        <PostList>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              isExpanded={isExpanded(`group:${g.id}`)}
              onToggle={() => toggle(`group:${g.id}`)}
              onChanged={reload}
            />
          ))}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
```

- [ ] **Step 3: App.tsx 注册路由**

在 `apps/web/src/App.tsx` 中：

- 加 import：`import GroupPage from "@/pages/GroupPage"`
- 在 `<Route path="/tags" ... />` 之后、`<Route path="*" ... />` 之前加：

```tsx
      <Route path="/groups" element={<GroupPage />} />
```

- [ ] **Step 4: typecheck + 手动验证**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

手动（`bun run dev`，需上游可达或先用 Task 3 的 curl 预置数据）：
- 打开 `/groups`：空态文案正确；
- 有分组时：星标收藏切换、展开成员、移除成员（最后一个成员移除后整组消失）、删除分组（confirm）；
- 「搜索相似」展开结果并可「加入本组」。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/GroupPage.tsx apps/web/src/lib/routes.ts apps/web/src/App.tsx
git commit -m "feat(web): add /groups page with group management"
```

---

## Task 9: 收藏页「已收藏的分组」区块

**Files:**
- Create: `apps/web/src/components/favorited-group-card.tsx`
- Modify: `apps/web/src/pages/FavoritesPage.tsx`

**Interfaces:**
- Consumes: `api.meGroups`、`Group`（Task 4）、`MeListPage` 的 `toolbar` 插槽、`parseQuery` / `parsePage`。
- Produces: `FavoritedGroupCard({ group, onChanged }: { group: Group; onChanged: () => void })`；FavoritesPage 在 `q` 空 / `kind` 空 / `page === 1` 时经 `toolbar` 渲染区块。

- [ ] **Step 1: 实现 FavoritedGroupCard**

创建 `apps/web/src/components/favorited-group-card.tsx`：

```tsx
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { IconBookOpen } from "@/components/icons"
import { type Group } from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

export function FavoritedGroupCard({
  group,
  onChanged,
}: {
  group: Group
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function unfavorite() {
    setBusy(true)
    try {
      await fetch(`${api.meGroups}/${group.id}/favorite`, { method: "DELETE" })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <div className="flex items-center gap-2 px-3.5 py-3 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconBookOpen size={15} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {group.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.author ?? `共 ${group.items.length} 章`}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            共 {group.items.length} 章
          </span>
          <ChevronDown
            size={16}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void unfavorite()}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          取消收藏
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3.5 py-3 sm:px-4">
          {group.items.map((m) => {
            const parsed = parseListTitle(m.title)
            const sub = formatTitleMeta(
              parsed.chapters ? { ...parsed, chapters: null } : parsed
            )
            return (
              <a
                key={m.tid}
                href={readPath(m.tid)}
                className="flex min-w-0 flex-col rounded-xl bg-muted/40 px-3 py-2 transition-colors hover:bg-accent/60"
              >
                <span className="line-clamp-1 text-sm font-medium text-foreground">
                  {parsed.chapters || m.title}
                </span>
                {sub && (
                  <span className="text-xs text-muted-foreground">{sub}</span>
                )}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 修改 FavoritesPage**

替换 `apps/web/src/pages/FavoritesPage.tsx` 为：

```tsx
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { FavoritedGroupCard } from "@/components/favorited-group-card"
import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { PostList } from "@/components/post-card"
import { type Group } from "@/lib/groups"
import { api, meListQuery, parsePage, parseQuery } from "@/lib/routes"

function UnfavoriteButton({
  item,
  reload,
}: {
  item: MeListItem
  reload: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`取消收藏「${item.title}」？`)) return
        setBusy(true)
        try {
          const res = await fetch(
            `${api.meFavorites}?kind=${item.kind}&id=${encodeURIComponent(item.id)}`,
            { method: "DELETE" }
          )
          if (res.ok) reload()
        } finally {
          setBusy(false)
        }
      }}
      className="min-h-9 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:min-h-0"
    >
      取消收藏
    </button>
  )
}

export default function FavoritesPage() {
  const [searchParams] = useSearchParams()
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)
  const showGroups = !q && !kind && page === 1

  const [groups, setGroups] = useState<Group[]>([])
  const [groupsError, setGroupsError] = useState("")

  const reloadGroups = useCallback(async () => {
    try {
      const res = await fetch(api.meGroups)
      if (!res.ok) {
        setGroupsError("分组加载失败")
        return
      }
      const json = (await res.json()) as { groups: Group[] }
      setGroups((json.groups ?? []).filter((g) => g.favorited))
      setGroupsError("")
    } catch {
      setGroupsError("分组加载失败")
    }
  }, [])

  useEffect(() => {
    if (showGroups) void reloadGroups()
    else setGroups([])
  }, [showGroups, reloadGroups])

  const renderTrailing = useCallback(
    (item: MeListItem, reload: () => void) => (
      <UnfavoriteButton item={item} reload={reload} />
    ),
    []
  )

  const toolbar = useCallback(() => {
    if (!showGroups) return null
    return (
      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          已收藏的分组
        </h2>
        {groupsError && (
          <p className="mb-2 text-xs text-destructive">{groupsError}</p>
        )}
        {groups.length > 0 && (
          <PostList>
            {groups.map((g) => (
              <FavoritedGroupCard
                key={g.id}
                group={g}
                onChanged={reloadGroups}
              />
            ))}
          </PostList>
        )}
      </section>
    )
  }, [showGroups, groups, groupsError, reloadGroups])

  return (
    <MeListPage
      title="收藏"
      description="收藏的贴子、书库与分组"
      bookGroupScope="favorites"
      buildUrl={(q2, kind2, page2) =>
        `${api.meFavorites}?${meListQuery({ q: q2, kind: kind2, page: page2 })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
      toolbar={toolbar}
    />
  )
}
```

- [ ] **Step 3: typecheck + 手动验证**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

手动：
- 收藏一个分组（分组页星标）→ 收藏页出现「已收藏的分组」区块；
- 展开区块成员 → 可跳转 `/read/:tid`；
- 点「取消收藏」→ 区块即时消失；
- 收藏列表为空时区块仍可见；搜索/筛选状态下区块不显示。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/favorited-group-card.tsx apps/web/src/pages/FavoritesPage.tsx
git commit -m "feat(web): favorites page favorited-groups section"
```

---

## Task 10: 各处接线「搜索相似」

**Files:**
- Modify（逐页，模式一致）：
  - `apps/web/src/pages/HomePage.tsx`
  - `apps/web/src/pages/BrowsePage.tsx`
  - `apps/web/src/pages/SearchPage.tsx`
  - `apps/web/src/pages/FeaturedPage.tsx`
  - `apps/web/src/pages/TrendingPage.tsx`
  - `apps/web/src/pages/CommentsPage.tsx`
  - `apps/web/src/components/picks-sections.tsx`
  - `apps/web/src/components/me-list-page.tsx`

**Interfaces:**
- Consumes: `SimilarPostCard` / `SimilarMeItemCard`（Task 7）、`CollapsibleBookGroup` 的 `similar` prop（Task 6）、`GroupMember`。
- Produces: 所有折叠页与 Me 列表的折叠组带 `similar`，单条带包装。

通用模式（每页两处改动）：

**A. 折叠组**：`<CollapsibleBookGroup>` 加 prop：

```tsx
similar={{
  title: g.title,
  groupKey: g.key,
  seedItems: g.items.map((l) => ({ tid: l.tid, title: l.title })),
}}
```

（Me 列表 `g.items` 是 `MeListItem`：`g.items.map((it) => ({ tid: it.id, title: it.title }))`。）

**B. 单条**：`<ListPostCard .../>` → `<SimilarPostCard ... tid={...} site={site} />`，原 props 全部保留并补 `tid` / `site`。

- [ ] **Step 1: HomePage**

单条分支：

```tsx
            g.type === "single" ? (
              <SimilarPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                tid={g.item.tid}
                site={site}
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((l) => ({
                    tid: l.tid,
                    title: l.title,
                  })),
                }}
              >
```

import 加：`import { SimilarPostCard } from "@/components/similar-post-card"`。`GroupMember` 类型无需在此 import（inline object 由 prop 类型推导）。

- [ ] **Step 2: BrowsePage / SearchPage**

两页单条分支结构与 HomePage 完全一致（`site === "2" ? bookPath(g.item.tid, { site }) : readPath(g.item.tid, site)`）。BrowsePage 单条分支替换为：

```tsx
              <SimilarPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                tid={g.item.tid}
                site={site}
                showGenre
              />
```

SearchPage 单条分支相同代码（该页 `href` 分支与 BrowsePage 一致）。两页折叠组都加：

```tsx
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((l) => ({
                    tid: l.tid,
                    title: l.title,
                  })),
                }}
```

（组内子卡保持原样：BrowsePage `readPath(link.tid, site)`，SearchPage `readPath(link.tid, site)`。）两页均补 import：`import { SimilarPostCard } from "@/components/similar-post-card"`。

- [ ] **Step 3: FeaturedPage**

单条分支（带 `index`）替换为：

```tsx
              <SimilarPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
                tid={g.item.tid}
                site="1"
                index={g.item.index || indexOfItem.get(g.item.tid) || 1}
                showGenre
              />
```

折叠组加 `similar`（与 Step 2 相同的 prop 块，`seedItems` 取 `l.tid`/`l.title`）。import 补 `SimilarPostCard`。

- [ ] **Step 4: TrendingPage / CommentsPage**

单条分支带 `rank` / `statValue` / `statUnit`，换成：

```tsx
              <SimilarPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                tid={g.item.tid}
                site={site}
                rank={g.item.rank}
                statValue={formatCount(g.item.reads)}
                statUnit="读"
                showGenre
              />
```

（CommentsPage 无 site=2 分支，`href={readPath(g.item.tid)}`、`site="1"`、`statUnit="评"`。）折叠组加 `similar`。import 补 `SimilarPostCard`。

- [ ] **Step 5: picks-sections.tsx（仅 PostList 路径）**

`PostList` 分支的 `grouped.map`：

- 单条 `<PostCard ...>` 包一层：

```tsx
                      <SimilarPostCard
                        key={g.item.tid}
                        href={readPath(g.item.tid)}
                        rawTitle={g.item.title}
                        tid={g.item.tid}
                        site="1"
                      />
```

- 折叠组加 `similar`：

```tsx
                      <CollapsibleBookGroup
                        key={`group:${g.key}`}
                        title={g.title}
                        summary={g.author ?? undefined}
                        count={g.items.length}
                        bookKey={g.key}
                        isExpanded={isExpanded(g.key)}
                        onToggle={() => toggle(g.key)}
                        trailing={
                          g.genre ? <GenrePill genre={g.genre} /> : undefined
                        }
                        similar={{
                          title: g.title,
                          groupKey: g.key,
                          seedItems: g.items.map((l) => ({
                            tid: l.tid,
                            title: l.title,
                          })),
                        }}
                      >
```

chip 路径不动。import 补 `SimilarPostCard`（`PostCard` 组内子卡仍保留）。

- [ ] **Step 6: me-list-page.tsx**

单条分支换成：

```tsx
            g.type === "single" ? (
              <SimilarMeItemCard
                key={`${g.item.kind}:${g.item.id}`}
                item={g.item}
                trailing={renderTrailing?.(g.item, reload)}
              />
            ) : (
```

折叠组加 `similar`（成员来自 `g.items`，MeListItem）：

```tsx
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((it) => ({
                    tid: it.id,
                    title: it.title,
                  })),
                }}
```

import 加：`import { SimilarMeItemCard } from "@/components/similar-me-item-card"`。组内子卡仍用 `MeItemCard`（带 titleOverride），不改。

> History / Tags 经 `me-list-page.tsx` 自动生效，无需独立改文件。

- [ ] **Step 7: typecheck + 手动验证**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

手动：
- 首页折叠组与单条出现「搜索相似」；点击折叠组内「搜索相似」折叠态自动展开；
- Browse / Search / Featured / Trending / Comments / Picks 各组与单条同上；
- 历史 / 收藏 / 标签页：只有 `kind=post & site=1` 的单条有入口，书库项（site=2 / kind=book）无入口；
- 单条「加入本组」首次创建分组并含该单条自身。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/BrowsePage.tsx apps/web/src/pages/SearchPage.tsx apps/web/src/pages/FeaturedPage.tsx apps/web/src/pages/TrendingPage.tsx apps/web/src/pages/CommentsPage.tsx apps/web/src/components/picks-sections.tsx apps/web/src/components/me-list-page.tsx
git commit -m "feat(web): wire similar-search into all folding lists"
```

---

## Task 11: 全量验证

**Files:** 无（仅验证）。

- [ ] **Step 1: 全仓测试**

Run: `bun run test`
Expected: 全部 PASS（core 新增 groups 测试 + 既有 store/cache + web lib 测试）。

- [ ] **Step 2: 全仓 typecheck**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: 全仓构建**

Run: `bun run build`
Expected: 成功。

- [ ] **Step 4: 手动回归清单**

- 折叠分组仍正常折叠/展开/记忆（localStorage scope 不变）；
- 首页无限滚动 + 折叠组「搜索相似」首次加入 → `/groups` 出现该组（含原折叠成员 + 新加入）；
- 单条（首页 / 搜索 / 历史等）「搜索相似」→ 加入 → 新建分组；
- 分组页：星标收藏 ↔ 收藏页「已收藏的分组」区块联动；取消收藏即时消失；
- 分组页移除成员（最后一个成员 → 整组消失）/ 删除分组（confirm）；
- 重复加入同一 tid 显示「已加入」且不重复；
- 搜索结果「已加入」以服务端为准（换页 / 刷新后重新展开仍正确）；
- xbookcn（site=2）无「搜索相似」入口；
- 刷新后持久化分组与收藏状态保留。

- [ ] **Step 5: 更新 AGENTS.md 的 API 表**

在 `AGENTS.md` 的 API 约定表追加：

```markdown
| `GET /api/me/groups`        | `q`、`site?`（忽略，v1 仅论坛帖）                      | `{ groups }` 全部分组（含成员）                                                                    |
| `PUT /api/me/groups`        | body `{ key, title, items:[{tid,title}], author?, genre? }` | 按 key upsert 并入成员 `{ ok, group }`；`items` 非空                                          |
| `DELETE /api/me/groups/:id` | 无                                                        | 删分组（级联成员）`{ ok }`                                                                          |
| `DELETE /api/me/groups/:id/items` | body `{ items:[{tid}] }`                            | 移除成员；组空自动删组 `{ ok, removed, deleted }`                                               |
| `PUT/DELETE /api/me/groups/:id/favorite` | 无                                              | 收藏 / 取消收藏整个分组 `{ ok }`；不存在 404                                                        |
```

并新增「搜索相似 / 分组」相关路径说明（可选）。

- [ ] **Step 6: 提交**

```bash
git add AGENTS.md
git commit -m "docs: document /api/me/groups endpoints"
```
