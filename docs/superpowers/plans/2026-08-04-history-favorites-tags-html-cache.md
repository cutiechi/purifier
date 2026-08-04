# 历史 / 收藏 / 标签 / 内容缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — before implementing ANY task in this plan, load the `test-driven-development` skill. Also load `using-git-worktrees` if you are working in a git repo, and `verification-before-completion` before claiming any task is complete.

日期：2026-08-04
规格来源：`docs/superpowers/specs/2026-08-04-history-favorites-tags-html-cache-design.md`
执行顺序：严格按任务编号 1→13 执行，每个任务独立提交；任务内步骤已按 TDD 排序（先写失败测试，再实现）。

## Goal

为 Purifier（Cool18 净化阅读，Bun workspace 单仓）增加四块个人单用户能力，全部状态落在 API 端磁盘：

1. **浏览历史**：正文/书库成功打开即记录，全量保留，按最近访问倒序，可搜索（标题子串 + 标签精确）。
2. **收藏**：单一收藏列表，可搜索，正文/书库页一键切换。
3. **标签**：自由文本多标签，整体替换语义；全局可点，跳转 `/tags?tag=xxx` 筛选对象。
4. **内容缓存**：正文/书库 HTML 与回复 JSON 落盘；`refresh=1` 手动刷新；标签页「数据管理」一键清空。

完成标准：`bun run typecheck`、`bun run test`、`bun run build` 全绿；每个任务的验证步骤手工通过。

## Architecture

- 持久化层放 `packages/core` 新增 `storage/` 模块（SQLite 状态 + 缓存文件），API 不直接接触 SQL。
- 抓取与清洗逻辑保持 `Cool18Extractor` 不变；缓存命中时读 HTML 文件后仍走 `extractContent` / `extractBookContent`。
- 状态端点统一挂 `/api/me/*`；正文/书库端点增加 `refresh=1`。
- 路由分发从「非 GET 一律 405」改为按 `(method, pathname)` 分发；SPA 静态托管早返回（`GET && !/api`）保持不变。
- 前端新增三个导航入口（历史/收藏/标签）与三类页面；正文/书库页标题下新增操作行（收藏切换、标签编辑、刷新）。

数据流（正文页为例）：

1. `GET /api/posts?tid=X` → 查 `post-X.html` 缓存 → 命中读文件、未命中抓上游并落盘 → `extractContent` → 成功后 `store.recordVisit("post", tid, ...)` → 返回。
2. 收藏/标签 → `PUT/DELETE /api/me/*` 写 SQLite；列表页 `GET /api/me/*` 聚合返回（`tags`/`favorited` 单次 SQL join，无 N+1）。

## Tech Stack

- `bun:sqlite`（Bun 内置，同步 API）— `$DATA_DIR/purifier.db`
- `node:fs/promises` — `$DATA_DIR/cache/*.html|.json`
- Bun 原生 `Bun.serve`（不引入 HTTP 框架）
- React Router 7 + Tailwind 4 + 自绘 `icons.tsx`（仓库既有模式）
- `bun test`（`packages/core` 新增测试脚本；turbo 新增 `test` 任务）

## Global Constraints

1. 代码风格由 Prettier 定义：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`；全部完成后跑 `bun run format`。
2. TypeScript `strict`；前端页面用 `@/` 别名，跨包用 `@workspace/core`。
3. 每个任务测试先行（先写会失败的测试，再写实现），任务内提交一次；前端无测试设施，任务 9–12 以 typecheck + build + 手工验证为主。
4. ID（`tid`/`cid`）必须通过 `/^[A-Za-z0-9]+$/` 校验，否则 400 —— 防路径穿越。
5. 列表分页：`pageSize = 20`，`page` 从 1 起，返回 `{ items, nextPage? }`；`tags`/`favorited` 由列表 SQL 一次聚合，禁止前端逐项调 `/api/me/state`（无 N+1）。
6. 搜索规则：`q` 对标题子串匹配（大小写不敏感）**或**对标签精确匹配；`?tag=` 精确匹配。
7. `/api/me/*` 响应一律 `Cache-Control: no-store`；磁盘缓存命中与 `refresh=1`（成功或 stale）响应同样 `no-store`；普通首次抓取成功保留 `CONTENT_CACHE_HEADERS`。
8. 回复缓存只在 `fetchReplies`（成功解析）时写入；成功但无回复时写空数组；`post-<tid>` 与 `replies-<tid>` 独立判定命中。
9. `refresh=1` 正文/书库刷新失败但旧缓存可用 → 200 + `stale: true` + `refreshError`；回复刷新失败 → 回退旧回复缓存（无则空数组），不影响 stale 标记；两者皆无缓存时整体走现有 502/504 映射。
10. 错误映射：非法 `kind`/`id` → 400；SQLite 异常 → 500 `{ error }`；清空缓存 → 200 `{ cleared: n }`。
11. 写接口（`PUT/DELETE /api/me/favorites`、`PUT /api/me/tags`、`DELETE /api/me/cache`）需路由放行非 GET；`DELETE /api/me/cache` 防跨站表单伪造。
12. 标签写入前统一 normalize：trim → 折叠连续空白 → 截断 24 字符（按码点）→ 空则忽略 → 去重；整体替换语义（提交集合即最终集合）。
13. 历史 upsert 语义：成功访问覆盖 `title`/`url`/`last_visited_at`，`visit_count + 1`，`first_seen_at` 保持不变。
14. `Store` 构造注入时钟 `now: () => number = Date.now`，测试用递增时钟保证排序/时间断言确定性。
15. 每任务验证：`bun run typecheck` + 对应 `bun test`（任务 1 起根目录 `bun run test` 可用）；任务 9 起加 `bun run build:web`。

## File Structure

新增（`+`）与修改（`~`）：

```
packages/core/
  src/storage/
    types.ts          + 数据模型（ItemKind/ListItem/ListResult/ItemState/ListQuery/TagCount/PAGE_SIZE）
    db.ts             + openDatabase(dataDir)：建目录 + 建库 + DDL
    store.ts          + Store：记录访问/状态/收藏/标签/列表查询
    cache.ts          + 内容缓存读写/清空 + assertSafeId
    index.ts          + 导出
    store.test.ts     + Store 单测
    cache.test.ts     + 缓存单测
  src/extractor/
    types.ts          ~ Extractor 接口加 fetchRepliesRaw / parseReplies
    extractor.ts      ~ fetchReplies 拆分为 raw + parse（行为不变）
    replies.test.ts   + parseReplies 单测
  src/upstream.ts     ~ 增加 NO_STORE_HEADERS
  src/index.ts        ~ export * from "./storage"
  package.json        ~ 增加 "test"、"typecheck" 脚本
apps/api/src/index.ts ~ 路由分发 + /api/me/* + posts/books 缓存与 refresh
apps/web/src/
  lib/routes.ts       ~ 路由/API 常量/导航项/查询助手（meListQuery/tagsPath）
  lib/format.ts       ~ formatDateTime
  App.tsx             ~ 3 条新路由
  components/site-header.tsx  ~ 移动端导航横向滚动
  components/article-view.tsx ~ actions 插槽（标题与元信息之间）
  components/icons.tsx        ~ IconFileText / IconBookOpen / IconStar / IconRefreshCw
  components/tag-chips.tsx    + 全局可点标签 chips
  components/me-item-card.tsx + 历史/收藏/标签列表项
  components/me-list-page.tsx + 搜索 + 类型筛选 + 分页的通用列表页
  components/item-actions.tsx + 收藏切换/标签编辑/刷新操作行 + useItemState
  pages/HistoryPage.tsx       +
  pages/FavoritesPage.tsx     +
  pages/TagsPage.tsx          + 标签列表 + ?tag= 筛选 + 数据管理
  pages/ReadPage.tsx          ~ 集成 ItemActions + 刷新 + stale 提示
  pages/BookPage.tsx          ~ 同上（无回复）
根：
  package.json        ~ "test": "turbo test"
  turbo.json          ~ test 任务
  Dockerfile          ~ ENV DATA_DIR=/data + mkdir/chown
  .gitignore          ~ data/
  README.md           ~ DATA_DIR 说明 + 挂载方式 + /api/me/* 表
  AGENTS.md           ~ 同步环境变量/API 约定
```

## Tasks

### Task 1：测试设施接入 + 存储骨架（~20 min）

**Files:**
- `packages/core/package.json`（~）
- `package.json`（根，~）
- `turbo.json`（~）
- `packages/core/src/storage/types.ts`（+）
- `packages/core/src/storage/db.ts`（+）
- `packages/core/src/storage/index.ts`（+）
- `packages/core/src/storage/store.test.ts`（+，冒烟测试）
- `packages/core/src/index.ts`（~）

**Interfaces:**

`packages/core/src/storage/types.ts`（完整文件）：

```ts
export type ItemKind = "post" | "book"

/** 列表项：历史/收藏/按标签筛选共用结构 */
export interface ListItem {
  kind: ItemKind
  id: string
  title: string
  url: string
  last_visited_at?: number // 历史/按标签筛选返回
  favorited_at?: number // 收藏列表返回
  visit_count: number
  favorited: boolean
  tags: string[]
}

export interface ListResult {
  items: ListItem[]
  nextPage?: number
}

/** 单对象状态（/api/me/state 返回） */
export interface ItemState {
  kind: ItemKind
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

export interface ListQuery {
  q?: string
  kind?: ItemKind | ""
  page?: number
}

export interface TagCount {
  tag: string
  count: number
}

export const PAGE_SIZE = 20
```

`packages/core/src/storage/db.ts`（完整文件）：

```ts
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const DDL = `
CREATE TABLE IF NOT EXISTS items (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS favorites (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  favorited_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS tags (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);
CREATE INDEX IF NOT EXISTS idx_items_visited ON items (last_visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_time ON favorites (favorited_at DESC);
`

/** 打开（必要时创建）SQLite 库并确保表结构存在 */
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(DDL)
  return db
}
```

`packages/core/src/storage/index.ts`：

```ts
export * from "./types"
export * from "./db"
```

**Consumes-Produces:**
- Consumes：现有 bun workspace / turbo 配置；`packages/core/src/index.ts` 的 `export * from "./extractor" / "./upstream"`。
- Produces：根目录可运行 `bun run test`；`openDatabase` 可建库建表（任务 2 起被 `Store` 使用）。

**Steps:**

1. 给 `packages/core/package.json` 加脚本（当前无 scripts 字段，整个字段新增）：

```json
"scripts": {
  "test": "bun test",
  "typecheck": "tsc --noEmit"
}
```

2. 根 `package.json` scripts 增加 `"test": "turbo test"`；`turbo.json` tasks 增加：

```json
"test": {
  "dependsOn": ["^test"]
}
```

3. 写 `types.ts`、`db.ts`、`storage/index.ts`（见 Interfaces）。
4. **先写失败测试** `store.test.ts`（冒烟：建表 + DDL 幂等）：

```ts
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
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
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
```

5. 在 `packages/core/src/index.ts` 增加一行导出：

```ts
export * from "./storage"
```

6. 跑测试：`cd packages/core && bun test`（Task 1 阶段可直接在 core 内跑；根目录 `bun run test` 亦可）→ 全绿。再跑 `bun run typecheck`（现在 core 有 typecheck 脚本，turbo 全仓可跑）。
7. 提交：`git add -A && git commit -m "test: add bun test and storage scaffolding (types/db)"`

---

### Task 2：Store 写路径（recordVisit / getState / 收藏 / 标签）（~35 min）

**Files:**
- `packages/core/src/storage/store.ts`（+）
- `packages/core/src/storage/store.test.ts`（~，追加测试）
- `packages/core/src/storage/index.ts`（~，追加导出）

**Interfaces:**

`packages/core/src/storage/store.ts`（完整文件）：

```ts
import { Database } from "bun:sqlite"
import { ItemKind, ItemState } from "./types"

/** trim → 折叠连续空白 → 按码点截断 24 字符 → 空返回 null */
export function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/\s+/g, " ")
  const truncated = Array.from(cleaned).slice(0, 24).join("")
  return truncated.length === 0 ? null : truncated
}

/** 逐条 normalize + 去重，保持输入顺序 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

export class Store {
  constructor(
    private db: Database,
    /** 注入时钟便于测试排序；默认真实时间 */
    private now: () => number = Date.now
  ) {}

  /** 成功访问（含 cache hit）：upsert items，title/url/last_visited_at 覆盖，visit_count+1，first_seen_at 保留 */
  recordVisit(kind: ItemKind, id: string, title: string, url: string): void {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO items (kind, id, title, url, first_seen_at, last_visited_at, visit_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)
         ON CONFLICT(kind, id) DO UPDATE SET
           title = excluded.title,
           url = excluded.url,
           last_visited_at = excluded.last_visited_at,
           visit_count = visit_count + 1`
      )
      .run(kind, id, title, url, now)
  }

  /** 单对象状态；items 中不存在返回 null */
  getState(kind: ItemKind, id: string): ItemState | null {
    const row = this.db
      .query(
        `SELECT title, url, first_seen_at, last_visited_at, visit_count
         FROM items WHERE kind = ?1 AND id = ?2`
      )
      .get(kind, id) as
      | {
          title: string
          url: string
          first_seen_at: number
          last_visited_at: number
          visit_count: number
        }
      | null
    if (!row) return null
    const fav = this.db
      .query("SELECT 1 FROM favorites WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    const tagRows = this.db
      .query(
        "SELECT tag FROM tags WHERE kind = ?1 AND id = ?2 ORDER BY created_at, rowid"
      )
      .all(kind, id) as { tag: string }[]
    return {
      kind,
      id,
      title: row.title,
      url: row.url,
      first_seen_at: row.first_seen_at,
      last_visited_at: row.last_visited_at,
      visit_count: row.visit_count,
      favorited: !!fav,
      tags: tagRows.map((r) => r.tag),
    }
  }

  /** 收藏；对象必须已存在于 items，否则返回 false（API 层映射 404） */
  addFavorite(kind: ItemKind, id: string): boolean {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    if (!exists) return false
    this.db
      .query(
        "INSERT OR IGNORE INTO favorites (kind, id, favorited_at) VALUES (?1, ?2, ?3)"
      )
      .run(kind, id, this.now())
    return true
  }

  removeFavorite(kind: ItemKind, id: string): void {
    this.db
      .query("DELETE FROM favorites WHERE kind = ?1 AND id = ?2")
      .run(kind, id)
  }

  /** 整体替换标签；对象不存在返回 null（API 层映射 404）；返回实际落库的标签 */
  setTags(kind: ItemKind, id: string, tags: string[]): string[] | null {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    if (!exists) return null
    const normalized = normalizeTags(tags)
    const created = this.now()
    const run = this.db.transaction(() => {
      this.db
        .query("DELETE FROM tags WHERE kind = ?1 AND id = ?2")
        .run(kind, id)
      const insert = this.db.query(
        "INSERT INTO tags (kind, id, tag, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
      for (const tag of normalized) insert.run(kind, id, tag, created)
    })
    run()
    return normalized
  }

  close(): void {
    this.db.close()
  }
}
```

**Consumes-Produces:**
- Consumes：Task 1 的 `openDatabase` / `types.ts`。
- Produces：`recordVisit`/`getState`/`addFavorite`/`removeFavorite`/`setTags`/`normalizeTag`/`normalizeTags`；任务 3 的读路径复用 `getState` 之外的方法。

**Steps:**

1. 写 `store.ts`（见 Interfaces）；`storage/index.ts` 追加 `export * from "./store"`。
2. **先写失败测试**（`store.test.ts` 追加；测试用递增时钟保证确定性）：

```ts
import { Store } from "./store"
import { openDatabase } from "./db"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-store-"))
  let t = 1_000
  const store = new Store(openDatabase(dir), () => t++)
  return { store, dir }
}

describe("recordVisit / getState", () => {
  test("new visit counts 1 and upsert increments + overwrites title", () => {
    const { store } = makeStore()
    store.recordVisit("post", "10", "标题A", "urlA")
    expect(store.getState("post", "10")?.visit_count).toBe(1)
    store.recordVisit("post", "10", "标题A2", "urlA")
    const state = store.getState("post", "10")
    expect(state?.visit_count).toBe(2)
    expect(state?.title).toBe("标题A2")
    expect(state?.first_seen_at).toBe(1000)
    expect(state?.last_visited_at).toBe(1001)
  })

  test("missing item returns null", () => {
    const { store } = makeStore()
    expect(store.getState("post", "nope")).toBeNull()
  })
})

describe("favorites", () => {
  test("addFavorite fails for missing item", () => {
    const { store } = makeStore()
    expect(store.addFavorite("post", "1")).toBe(false)
  })

  test("add/remove favorite toggles state", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    expect(store.addFavorite("post", "1")).toBe(true)
    expect(store.getState("post", "1")?.favorited).toBe(true)
    store.removeFavorite("post", "1")
    expect(store.getState("post", "1")?.favorited).toBe(false)
  })
})

describe("setTags / normalize", () => {
  test("setTags replaces the whole set", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    expect(store.setTags("post", "1", ["科幻", "长篇"])).toEqual([
      "科幻",
      "长篇",
    ])
    store.setTags("post", "1", ["连载中"])
    expect(store.getState("post", "1")?.tags).toEqual(["连载中"])
  })

  test("setTags normalizes and dedupes", () => {
    const { store } = makeStore()
    store.recordVisit("post", "1", "T", "u")
    store.setTags("post", "1", ["  科幻  ", "科 幻", "科幻", "", "  "])
    expect(store.getState("post", "1")?.tags).toEqual(["科幻", "科 幻"])
  })

  test("truncates tags to 24 code points", () => {
    expect(normalizeTag("超长标签".repeat(10))?.length).toBe(24)
    expect(normalizeTag("   ")).toBeNull()
  })

  test("setTags returns null for missing item", () => {
    const { store } = makeStore()
    expect(store.setTags("book", "9", ["x"])).toBeNull()
  })
})
```

3. 跑 `cd packages/core && bun test`：先看到新测试失败（`store.ts` 不存在 → 编译失败即红），再实现后全绿。
4. `bun run typecheck`。
5. 提交：`git add -A && git commit -m "feat(core): Store write paths (visits/favorites/tags)"`

---

### Task 3：Store 读路径（listHistory / listFavorites / listTags / listByTag）（~40 min）

**Files:**
- `packages/core/src/storage/store.ts`（~，追加读方法）
- `packages/core/src/storage/store.test.ts`（~，追加测试）

**Interfaces**（追加到 `Store` 类；`runList`/`tagsFor` 为私有辅助）：

```ts
// —— 追加在 store.ts 顶部 import 处 ——
import { ItemKind, ItemState, ListItem, ListQuery, ListResult, TagCount, PAGE_SIZE } from "./types"

interface RawItemRow {
  kind: string
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: number
}

// —— 追加到 Store 类内 ——

/** 历史：全量，最近访问倒序；q 匹配标题子串（NOCASE）或标签精确；kind 可筛选 */
listHistory(query: ListQuery): ListResult {
  const q = query.q ?? ""
  const kind = query.kind || null
  const page = Math.max(1, query.page ?? 1)
  return this.runList(
    `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
            (EXISTS(SELECT 1 FROM favorites f
                    WHERE f.kind = i.kind AND f.id = i.id)) AS favorited
     FROM items i
     WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
            OR EXISTS(SELECT 1 FROM tags t
                      WHERE t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
       AND (?2 IS NULL OR i.kind = ?2)
     ORDER BY i.last_visited_at DESC, i.rowid DESC
     LIMIT ?3 OFFSET ?4`,
    [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    page
  )
}

/** 收藏列表：按收藏时间倒序，支持同样搜索 */
// 排序：favorited_at DESC + f.rowid DESC 兜底 —— 生产同毫秒收藏时按插入顺序倒序，符合「后收藏在前」预期
listFavorites(query: ListQuery): ListResult {
  const q = query.q ?? ""
  const kind = query.kind || null
  const page = Math.max(1, query.page ?? 1)
  return this.runList(
    `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
            f.favorited_at, 1 AS favorited
     FROM favorites f
     JOIN items i ON i.kind = f.kind AND i.id = f.id
     WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
            OR EXISTS(SELECT 1 FROM tags t
                      WHERE t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
       AND (?2 IS NULL OR i.kind = ?2)
     ORDER BY f.favorited_at DESC, f.rowid DESC
     LIMIT ?3 OFFSET ?4`,
    [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    page
  )
}

/** 全部标签及计数：数量倒序，同数按字母序，无分页 */
listTags(): TagCount[] {
  const rows = this.db
    .query(
      "SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC"
    )
    .all() as { tag: string; count: number }[]
  return rows.map((r) => ({ tag: r.tag, count: r.count }))
}

/** 按标签精确筛选对象；q/kind 在结果内继续过滤 */
// 注意：GROUP BY i.kind, i.id 下 i.title/i.url/i.last_visited_at/i.visit_count 是 bare column；
// 组内由 items 主键 (kind,id) 唯一确定，取任意行结果恒等，安全。不要「修复」成 GROUP BY 全列。
listByTag(tag: string, query: ListQuery): ListResult {
  const q = query.q ?? ""
  const kind = query.kind || null
  const page = Math.max(1, query.page ?? 1)
  return this.runList(
    `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
            (EXISTS(SELECT 1 FROM favorites f
                    WHERE f.kind = i.kind AND f.id = i.id)) AS favorited
     FROM tags t
     JOIN items i ON i.kind = t.kind AND i.id = t.id
     WHERE t.tag = ?1
       AND (?2 = '' OR i.title LIKE '%' || ?2 || '%' COLLATE NOCASE)
       AND (?3 IS NULL OR i.kind = ?3)
     GROUP BY i.kind, i.id
     ORDER BY i.last_visited_at DESC, i.rowid DESC
     LIMIT ?4 OFFSET ?5`,
    [tag, q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    page
  )
}

private runList(sql: string, params: unknown[], page: number): ListResult {
  const rows = this.db.query(sql).all(...params) as RawItemRow[]
  const items: ListItem[] = rows.map((r) => {
    const item: ListItem = {
      kind: r.kind as ItemKind,
      id: r.id,
      title: r.title,
      url: r.url,
      visit_count: r.visit_count,
      favorited: r.favorited === 1,
      tags: [],
    }
    if (r.last_visited_at != null) item.last_visited_at = r.last_visited_at
    if (r.favorited_at != null) item.favorited_at = r.favorited_at
    return item
  })
  const tagMap = this.tagsFor(items.map((i) => [i.kind, i.id]))
  for (const item of items) {
    item.tags = tagMap.get(`${item.kind}:${item.id}`) ?? []
  }
  const hasMore = items.length > PAGE_SIZE
  return {
    items: hasMore ? items.slice(0, PAGE_SIZE) : items,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

/** 一次 SQL 聚合整页 tags，避免 N+1 */
// 已知：SQL 文本随页内容变化，bun:sqlite 的 prepared statement 缓存命中率为 0；
// 单用户量级无害，接受即可，不必优化（历史增长后如需要可改 (kind,id) IN (VALUES ...)）。
private tagsFor(kindIds: Array<[ItemKind, string]>): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (kindIds.length === 0) return map
  const clauses = kindIds
    .map((_, i) => `(kind = ?${i * 2 + 1} AND id = ?${i * 2 + 2})`)
    .join(" OR ")
  const params = kindIds.flat()
  const rows = this.db
    .query(
      `SELECT kind, id, tag FROM tags WHERE ${clauses} ORDER BY created_at, rowid`
    )
    .all(...params) as { kind: ItemKind; id: string; tag: string }[]
  for (const r of rows) {
    const key = `${r.kind}:${r.id}`
    const arr = map.get(key)
    if (arr) arr.push(r.tag)
    else map.set(key, [r.tag])
  }
  return map
}
```

**Consumes-Produces:**
- Consumes：Task 2 的 `Store`（`recordVisit`/`setTags`/`addFavorite` 用于造数据）。
- Produces：四个读方法，供 Task 6 的 `/api/me/history|favorites|tags|items` 使用；`nextPage` 语义（`PAGE_SIZE+1` 探针）就绪。

**Steps:**

1. 追加读方法到 `store.ts`（见 Interfaces）。
2. **先写失败测试**（`store.test.ts` 追加）：

```ts
function seed(store: Store) {
  store.recordVisit("post", "1", "Alpha 星", "u1")
  store.recordVisit("book", "2", "Beta 书", "u2")
  store.recordVisit("post", "3", "gamma 贴", "u3")
  store.setTags("post", "1", ["科幻"])
  store.setTags("post", "3", ["随笔"])
  store.addFavorite("book", "2")
}

describe("listHistory", () => {
  test("orders by last_visited_at desc", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({})
    expect(res.items.map((i) => i.id)).toEqual(["3", "2", "1"])
    expect(res.nextPage).toBeUndefined()
  })

  test("matches title substring case-insensitively and tag exactly", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listHistory({ q: "ALPHA" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
    expect(store.listHistory({ q: "科幻" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
  })

  test("filters by kind and aggregates tags/favorited", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({ kind: "book" })
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.tags).toEqual([])
    expect(res.items[0]?.favorited).toBe(true)
    const posts = store.listHistory({ kind: "post" })
    expect(posts.items.map((i) => i.id)).toEqual(["3", "1"])
    expect(posts.items.find((i) => i.id === "1")?.tags).toEqual(["科幻"])
  })

  test("paginates 20 per page", () => {
    const { store } = makeStore()
    for (let i = 0; i < 25; i++) {
      store.recordVisit("post", String(i), `T${i}`, "u")
    }
    const p1 = store.listHistory({ page: 1 })
    expect(p1.items).toHaveLength(20)
    expect(p1.nextPage).toBe(2)
    const p2 = store.listHistory({ page: 2 })
    expect(p2.items).toHaveLength(5)
    expect(p2.nextPage).toBeUndefined()
  })
})

describe("listFavorites", () => {
  test("orders by favorited_at desc and returns favorited_at", () => {
    const { store } = makeStore()
    seed(store)
    store.recordVisit("post", "10", "Ten", "u")
    store.addFavorite("post", "10")
    const res = store.listFavorites({})
    expect(res.items.map((i) => i.id)).toEqual(["10", "2"])
    expect(res.items[0]?.favorited_at).toBeDefined()
    expect(res.items.every((i) => i.favorited)).toBe(true)
  })

  test("searches within favorites", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listFavorites({ q: "beta" }).items.map((i) => i.id)).toEqual([
      "2",
    ])
  })
})

describe("listTags", () => {
  test("counts desc, tie by tag asc", () => {
    const { store } = makeStore()
    seed(store)
    store.setTags("book", "2", ["科幻", "历史"])
    const res = store.listTags()
    expect(res).toEqual([
      { tag: "科幻", count: 2 },
      { tag: "历史", count: 1 },
      { tag: "随笔", count: 1 },
    ])
  })
})

describe("listByTag", () => {
  test("filters exactly by tag, then q and kind", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listByTag("科幻", {}).items.map((i) => i.id)).toEqual(["1"])
    expect(store.listByTag("科", {}).items).toHaveLength(0) // 精确匹配
    expect(store.listByTag("科幻", { kind: "book" }).items).toHaveLength(0)
  })
})
```

3. 跑 `cd packages/core && bun test`（红 → 绿）。
4. `bun run typecheck`。
5. 提交：`git add -A && git commit -m "feat(core): Store read paths (history/favorites/tags/tag filter)"`

---

### Task 4：内容缓存模块（~30 min）

**Files:**
- `packages/core/src/storage/cache.ts`（+）
- `packages/core/src/storage/cache.test.ts`（+）
- `packages/core/src/storage/index.ts`（~，追加导出）

**Interfaces:**

`packages/core/src/storage/cache.ts`（完整文件）：

```ts
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ExtractorError } from "../extractor/types"
import { ItemKind } from "./types"

/** 只允许数字与字母，防路径穿越 */
const SAFE_ID = /^[A-Za-z0-9]+$/

export function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new ExtractorError("invalid id", 400)
  }
}

export interface CacheEntry<T> {
  data: T
  mtimeMs: number
  sizeBytes: number
}

export function contentCachePath(dataDir: string, kind: ItemKind, id: string): string {
  assertSafeId(id)
  return join(dataDir, "cache", `${kind}-${id}.html`)
}

export function repliesCachePath(dataDir: string, id: string): string {
  assertSafeId(id)
  return join(dataDir, "cache", `replies-${id}.json`)
}

/** 读正文/书库 HTML 缓存；无缓存返回 null */
export async function readContentCache(
  dataDir: string,
  kind: ItemKind,
  id: string
): Promise<CacheEntry<string> | null> {
  const path = contentCachePath(dataDir, kind, id)
  try {
    const [data, info] = await Promise.all([readFile(path, "utf8"), stat(path)])
    return { data, mtimeMs: info.mtimeMs, sizeBytes: info.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function writeContentCache(
  dataDir: string,
  kind: ItemKind,
  id: string,
  html: string
): Promise<void> {
  await mkdir(join(dataDir, "cache"), { recursive: true })
  await writeFile(contentCachePath(dataDir, kind, id), html, "utf8")
}

/** 读回复 JSON 缓存；无缓存返回 null（data 类型由调用方校验，损坏 JSON 抛错） */
export async function readRepliesCache(
  dataDir: string,
  id: string
): Promise<CacheEntry<unknown> | null> {
  const path = repliesCachePath(dataDir, id)
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)])
    return { data: JSON.parse(raw), mtimeMs: info.mtimeMs, sizeBytes: info.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function writeRepliesCache(
  dataDir: string,
  id: string,
  replies: unknown
): Promise<void> {
  await mkdir(join(dataDir, "cache"), { recursive: true })
  await writeFile(repliesCachePath(dataDir, id), JSON.stringify(replies), "utf8")
}

/** 清空 cache/ 目录下全部文件；返回删除数量；目录不存在返回 0 */
export async function clearCache(dataDir: string): Promise<number> {
  const dir = join(dataDir, "cache")
  let cleared = 0
  try {
    for (const name of await readdir(dir)) {
      await unlink(join(dir, name))
      cleared++
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  return cleared
}
```

**Consumes-Produces:**
- Consumes：`ExtractorError`（`../extractor/types`）、`ItemKind`。
- Produces：`assertSafeId`/`contentCachePath`/`repliesCachePath`/读写/`clearCache`，供 Task 8 的 posts/books 缓存路径使用。

**Steps:**

1. 写 `cache.ts`；`storage/index.ts` 追加 `export * from "./cache"`。
2. **先写失败测试** `cache.test.ts`：

```ts
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
```

3. 跑 `cd packages/core && bun test`（红 → 绿）。
4. `bun run typecheck`。
5. 提交：`git add -A && git commit -m "feat(core): content cache module (HTML/replies JSON read-write and clear)"`

---

### Task 5：Extractor 回复拆分（fetchRepliesRaw / parseReplies）（~30 min）

**Files:**
- `packages/core/src/extractor/types.ts`（~，接口加两个方法）
- `packages/core/src/extractor/extractor.ts`（~，拆分 fetchReplies）
- `packages/core/src/extractor/replies.test.ts`（+）

**Interfaces:**

`types.ts` 的 `Extractor` 接口追加：

```ts
  fetchReplies(tid: string): Promise<ReplyNode[]>
  /** 拉取 achildlist 原始文本（Referer: buildUrl(tid)）；网络失败抛 ExtractorError(502) */
  fetchRepliesRaw(tid: string): Promise<string>
  /** 纯函数：JSON 文本 → 回复树；非法 JSON 抛 ExtractorError(502)，非数组返回 [] */
  parseReplies(raw: string, tid: string): ReplyNode[]
```

`extractor.ts`：把现有 `fetchReplies` 的 body 拆成两个方法，原 `fetchReplies` 变为组合（行为完全一致：网络失败 502、JSON 解析失败 502、非数组 []、逐项 stripHtml、buildReplyTree）：

```ts
  async fetchRepliesRaw(tid: string): Promise<string> {
    const url = `${this.homeUrl}?app=forum&act=achildlist&tid=${encodeURIComponent(tid)}`
    const resp = await fetchUpstream(url, {
      headers: { Referer: this.buildUrl(tid) },
    })
    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }
    return resp.text()
  }

  parseReplies(raw: string, tid: string): ReplyNode[] {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new ExtractorError("invalid replies response", 502)
    }
    if (!Array.isArray(data)) return []

    const items: ReplyItem[] = []
    for (const r0 of data) {
      if (!r0 || typeof r0 !== "object") continue
      const r = r0 as Record<string, unknown>
      const replyTid = String(r.tid ?? "")
      if (!replyTid) continue
      items.push({
        tid: replyTid,
        uptid: String(r.uptid ?? tid),
        rootid: String(r.rootid ?? tid),
        uid: String(r.uid ?? ""),
        username: this.stripHtml(String(r.username ?? "")),
        subject: this.stripHtml(String(r.subject ?? "")),
        dateline: String(r.dateline ?? ""),
        size: parseInt(String(r.size ?? "0"), 10) || 0,
      })
    }

    return this.buildReplyTree(items, tid)
  }

  async fetchReplies(tid: string): Promise<ReplyNode[]> {
    return this.parseReplies(await this.fetchRepliesRaw(tid), tid)
  }
```

**Consumes-Produces:**
- Consumes：现有 `fetchUpstream`、`ExtractorError`、`ReplyItem/ReplyNode`。
- Produces：可单测的 `parseReplies`（纯函数）+ 可独立调用的 `fetchRepliesRaw`；Task 8 的回复缓存路径依赖这两个方法。

**Steps:**

1. `types.ts` 接口加两行；`extractor.ts` 按 Interfaces 拆分（删掉旧 `fetchReplies` 的方法体）。
2. **先写失败测试** `replies.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { Cool18Extractor } from "./extractor"
import { ExtractorError } from "./types"

const ex = new Cool18Extractor()

describe("parseReplies", () => {
  test("builds reply tree by uptid", () => {
    const raw = JSON.stringify([
      { tid: "1", uptid: "0", username: "作者" },
      { tid: "2", uptid: "1", username: "甲" },
      { tid: "3", uptid: "1", username: "乙" },
      { tid: "4", uptid: "2", username: "丙" },
    ])
    const tree = ex.parseReplies(raw, "1")
    expect(tree).toHaveLength(1)
    expect(tree[0]?.tid).toBe("1")
    expect(tree[0]?.children.map((c) => c.tid)).toEqual(["2", "3"])
    expect(tree[0]?.children[0]?.children.map((c) => c.tid)).toEqual(["4"])
  })

  test("empty array → []", () => {
    expect(ex.parseReplies("[]", "1")).toEqual([])
  })

  test("non-array json → []", () => {
    expect(ex.parseReplies('{"a":1}', "1")).toEqual([])
  })

  test("invalid json throws 502 ExtractorError", () => {
    expect(() => ex.parseReplies("not json", "1")).toThrow(ExtractorError)
  })

  test("strips html from username/subject and fills defaults", () => {
    const tree = ex.parseReplies(
      JSON.stringify([
        {
          tid: "2",
          uptid: "1",
          username: "<b>甲</b>",
          subject: "支持<br>楼主",
        },
      ]),
      "1"
    )
    expect(tree[0]?.username).toBe("甲")
    expect(tree[0]?.subject).toBe("支持楼主")
    expect(tree[0]?.rootid).toBe("1")
    expect(tree[0]?.size).toBe(0)
  })
})
```

3. 跑 `cd packages/core && bun test`（红 → 绿）。
4. `bun run typecheck`；顺手 `bun run build`（确认拆分未破坏上游构建）。
5. 提交：`git add -A && git commit -m "refactor(core): split fetchReplies into raw + parse"`

---

### Task 6：API 路由分发 + `/api/me/*` 读端点（~40 min）

**Files:**
- `packages/core/src/upstream.ts`（~，加 `NO_STORE_HEADERS`）
- `apps/api/src/index.ts`（~，路由分发 + me 读端点）

**Interfaces:**

`upstream.ts` 追加：

```ts
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const
```

`apps/api/src/index.ts` 改动：

```ts
// import 追加
import {
  ...,
  NO_STORE_HEADERS,
  assertSafeId,
  clearCache,
  openDatabase,
  Store,
  type ItemKind,
  type ListItem,
  type ListQuery,
  type ItemState,
} from "@workspace/core"

// 模块级（import 之后）
const DATA_DIR = process.env.DATA_DIR || "./data"
const store = new Store(openDatabase(DATA_DIR))

// 参数辅助（放 toErrorResponse 附近）
function requireGet(req: Request): void {
  if (req.method !== "GET") {
    throw new ExtractorError("method not allowed", 405)
  }
}

function meKindParam(url: URL): ItemKind {
  const kind = url.searchParams.get("kind")
  if (kind !== "post" && kind !== "book") {
    throw new ExtractorError("invalid kind", 400)
  }
  return kind
}

function meIdParam(url: URL): string {
  const id = url.searchParams.get("id") ?? ""
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new ExtractorError("invalid id", 400)
  }
  return id
}

function meListQuery(url: URL): ListQuery {
  const kindRaw = url.searchParams.get("kind")
  let kind: ListQuery["kind"] = ""
  if (kindRaw !== null) {
    if (kindRaw !== "post" && kindRaw !== "book") {
      throw new ExtractorError("invalid kind", 400)
    }
    kind = kindRaw
  }
  return {
    q: url.searchParams.get("q")?.trim() || "",
    kind,
    page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
  }
}

// 读端点处理器（放在 handleHomeExtract 之后）
function handleMeHistory(url: URL): Response {
  return jsonOk(store.listHistory(meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeFavorites(url: URL): Response {
  return jsonOk(store.listFavorites(meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeTags(): Response {
  return jsonOk({ tags: store.listTags() }, NO_STORE_HEADERS)
}

function handleMeItems(url: URL): Response {
  const tag = url.searchParams.get("tag")?.trim()
  if (!tag) return jsonError("missing tag parameter", 400)
  return jsonOk(store.listByTag(tag, meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeState(url: URL): Response {
  const kind = meKindParam(url)
  const id = meIdParam(url)
  const state = store.getState(kind, id)
  // 对象不存在返回 200 空状态（visit_count 0）：前端 useItemState 对 !res.ok 静默，
  // 空状态与「未收藏/无标签」UI 等价；正文页打开会先 recordVisit 再查询，正常路径不会出现。
  const empty: ItemState = {
    kind,
    id,
    title: "",
    url: "",
    first_seen_at: 0,
    last_visited_at: 0,
    visit_count: 0,
    favorited: false,
    tags: [],
  }
  return jsonOk(state ?? empty, NO_STORE_HEADERS)
}

// 既有端点抽取（等价于原 switch 内联分支，内容不变，只包一层）
async function handleComments(): Promise<Response> {
  const extractor = getExtractor("cool18")
  const resp = await fetchUpstream(`${extractor.homeUrl}?act=cmtrank&y=1`)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  return jsonOk(
    { posts: extractor.extractCmtRankPosts(html) },
    LIST_CACHE_HEADERS
  )
}

async function handleTrending(): Promise<Response> {
  const extractor = getExtractor("cool18")
  const resp = await fetchUpstream(`${extractor.homeUrl}?app=forum&act=hot`)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  return jsonOk(
    { posts: extractor.extractHotPosts(html) },
    LIST_CACHE_HEADERS
  )
}

// route() 整体重写（SPA 早返回保持不变；默认 405 分支删除，改为逐 case 放行）
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  // Static / SPA first for non-API（保持不变）
  if (req.method === "GET" && !pathname.startsWith("/api")) {
    const spa = await serveSpa(pathname)
    if (spa) return spa
  }

  try {
    switch (pathname) {
      case "/api/health":
        requireGet(req)
        return Response.json({ status: "ok", runtime: "bun" })
      case "/api/posts":
        requireGet(req)
        return await handlePosts(url)
      case "/api/books":
        requireGet(req)
        return await handleBooks(url)
      case "/api/browse":
        requireGet(req)
        return await handleBrowse(url)
      case "/api/categories":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          links: ex.extractCategoryLinks(html),
        }))
      case "/api/featured":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          links: ex.extractGoldLinks(html),
        }))
      case "/api/picks":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          sections: ex.extractRecommendSections(html),
        }))
      case "/api/comments":
        requireGet(req)
        return await handleComments()
      case "/api/trending":
        requireGet(req)
        return await handleTrending()
      case "/api/me/history":
        requireGet(req)
        return handleMeHistory(url)
      case "/api/me/favorites":
        if (req.method === "GET") return handleMeFavorites(url)
        if (req.method === "PUT") return await handleFavoriteWrite(req, true)
        if (req.method === "DELETE") return await handleFavoriteWrite(req, false)
        return jsonError("method not allowed", 405)
      case "/api/me/tags":
        if (req.method === "GET") return handleMeTags()
        if (req.method === "PUT") return await handleTagsWrite(req)
        return jsonError("method not allowed", 405)
      case "/api/me/items":
        requireGet(req)
        return handleMeItems(url)
      case "/api/me/state":
        requireGet(req)
        return handleMeState(url)
      case "/api/me/cache":
        if (req.method === "DELETE") return await handleCacheClear()
        return jsonError("method not allowed", 405)
      default:
        return jsonError("not found", 404)
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

说明：`handleComments`/`handleTrending` 的完整实现已在上方给出（由原 switch 内联分支原样抽出，含 `resp.ok` 分支与 `LIST_CACHE_HEADERS`，实现时直接照抄即可）。`handleFavoriteWrite`/`handleTagsWrite`/`handleCacheClear` 在 Task 7 实现——**本任务先给它们留占位实现**（`return jsonError("not implemented", 500)`），Task 7 替换为真实现；也可以在 Task 7 再补 case。推荐：本任务 route() 中这三个 case 直接暂不注册，Task 7 一并加入，保持每次提交可编译可运行。

**Consumes-Produces:**
- Consumes：Task 1–5 的 `Store`/`openDatabase`/`ListQuery`/`ItemState`/`NO_STORE_HEADERS`。
- Produces：`GET /api/me/history|favorites|tags|items|state`；405/400 语义；`/api/me/*` 全部 `no-store`。

**Steps:**

1. `upstream.ts` 加 `NO_STORE_HEADERS`；`apps/api/src/index.ts` 按 Interfaces 改造（本任务注册的 me case：history/favorites-GET/tags-GET/items/state；favorites-PUT/DELETE、tags-PUT、cache-DELETE 留到 Task 7）。
2. `bun run typecheck`；`bun run dev:api` 起服务。
3. 手工验证（先造数据，再 curl；`bun -e` 与 dev server 走同一 `./data`，WAL 支持多进程）：

```bash
bun -e 'import { openDatabase, Store } from "@workspace/core"; const s = new Store(openDatabase("./data")); s.recordVisit("post","1","测试贴","u1"); s.recordVisit("book","2","测试书","u2"); s.setTags("post","1",["科幻"]); s.addFavorite("post","1")'

curl -s 'http://127.0.0.1:3001/api/me/history' | bun -e 'console.log(JSON.stringify(await Bun.stdin.json(), null, 1))'
# 期望：items 含 post 1（visit_count 1，tags ["科幻"]，favorited true）与 book 2，顺序 [1, 2]（后访问在前）
curl -s 'http://127.0.0.1:3001/api/me/tags'          # {"tags":[{"tag":"科幻","count":1}]}
curl -s 'http://127.0.0.1:3001/api/me/items?tag=科幻' # 只含 post 1
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id=1' # 完整状态
curl -i -s 'http://127.0.0.1:3001/api/me/history' | grep -i '^cache-control' # no-store
curl -i -s 'http://127.0.0.1:3001/api/me/state?kind=foo&id=1' | head -1      # 400
curl -i -s 'http://127.0.0.1:3001/api/me/history' -X POST | head -1           # 405
curl -s 'http://127.0.0.1:3001/api/me/history?q=测试' # 标题搜索命中
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id=999' # 200 空状态（visit_count 0）
```

4. 验证既有端点未回归：`curl -s 'http://127.0.0.1:3001/api/health'`、`curl -i -s 'http://127.0.0.1:3001/api/posts?mtid=0' | grep -i '^cache-control'`（列表仍 s-maxage=60）。上游不可达时先 `export HTTPS_PROXY=...`。
5. 清理验证数据：`rm -rf data`（dev 停掉后），避免污染后续任务。
6. 提交：`git add -A && git commit -m "feat(api): dispatch routes by (method, pathname) + /api/me read endpoints"`

---

### Task 7：API 写端点（favorites PUT/DELETE、tags PUT、cache DELETE）（~30 min）

**Files:**
- `apps/api/src/index.ts`（~，补全 Task 6 预留的写 case 与处理器）

**Interfaces**（追加到 `apps/api/src/index.ts`）：

```ts
async function handleFavoriteWrite(
  req: Request,
  favorite: boolean
): Promise<Response> {
  const url = new URL(req.url)
  const kind = meKindParam(url)
  const id = meIdParam(url)
  if (favorite) {
    const ok = store.addFavorite(kind, id)
    if (!ok) return jsonError("item not found", 404)
  } else {
    store.removeFavorite(kind, id)
  }
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

async function handleTagsWrite(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("invalid json body", 400)
  }
  const b = (body ?? {}) as { kind?: unknown; id?: unknown; tags?: unknown }
  if (b.kind !== "post" && b.kind !== "book") {
    return jsonError("invalid kind", 400)
  }
  if (typeof b.id !== "string" || !/^[A-Za-z0-9]+$/.test(b.id)) {
    return jsonError("invalid id", 400)
  }
  if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string")) {
    return jsonError("tags must be string[]", 400)
  }
  const tags = store.setTags(b.kind, b.id, b.tags as string[])
  if (tags === null) return jsonError("item not found", 404)
  return jsonOk({ ok: true, tags }, NO_STORE_HEADERS)
}

async function handleCacheClear(): Promise<Response> {
  const cleared = await clearCache(DATA_DIR)
  return jsonOk({ cleared }, NO_STORE_HEADERS)
}
```

`route()` 中把 Task 6 预留的 case 补全（把 `if (req.method === ...)` 分支接到真处理器）。

**Consumes-Produces:**
- Consumes：Task 6 的 `meKindParam`/`meIdParam`；Task 2–4 的 `Store.addFavorite/removeFavorite/setTags`、`clearCache`。
- Produces：`PUT|DELETE /api/me/favorites?kind=&id=`、`PUT /api/me/tags`（body `{kind,id,tags}`）、`DELETE /api/me/cache`；404/400 语义。

**Steps:**

1. 写三个处理器并在 `route()` 接线（见 Interfaces）。
2. `bun run typecheck`；`bun run dev:api`。
3. 手工验证（先造一个已存在对象）：

```bash
bun -e 'import { openDatabase, Store } from "@workspace/core"; const s = new Store(openDatabase("./data")); s.recordVisit("post","1","测试贴","u1")'

# 收藏：成功 → 404（对象不存在）→ 取消
curl -i -s -X PUT 'http://127.0.0.1:3001/api/me/favorites?kind=post&id=1' | head -1      # 200
curl -i -s -X PUT 'http://127.0.0.1:3001/api/me/favorites?kind=post&id=999' | head -1    # 404
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id=1'                              # favorited true
curl -i -s -X DELETE 'http://127.0.0.1:3001/api/me/favorites?kind=post&id=1' | head -1   # 200
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id=1'                              # favorited false

# 标签整体替换 + normalize
curl -i -s -X PUT -H 'Content-Type: application/json' \
  -d '{"kind":"post","id":"1","tags":["科幻","  ","长篇","科幻"]}' \
  'http://127.0.0.1:3001/api/me/tags' | head -1                                          # 200
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id=1'                              # tags ["科幻","长篇"]
curl -i -s -X PUT -H 'Content-Type: application/json' \
  -d '{"kind":"post","id":"999","tags":["x"]}' 'http://127.0.0.1:3001/api/me/tags' | head -1 # 404
curl -i -s -X PUT -H 'Content-Type: application/json' \
  -d '{"kind":"post","id":"1","tags":"科幻"}' 'http://127.0.0.1:3001/api/me/tags' | head -1   # 400 tags must be string[]
curl -i -s -X PUT -H 'Content-Type: application/json' \
  -d 'not-json' 'http://127.0.0.1:3001/api/me/tags' | head -1                                # 400 invalid json body

# 清空缓存（此时 cache/ 为空 → cleared 0；Task 8 后再来一次非 0）
curl -s -X DELETE 'http://127.0.0.1:3001/api/me/cache'      # {"cleared":0}
curl -i -s -X POST 'http://127.0.0.1:3001/api/me/cache' | head -1  # 405
```

4. 清理验证数据：`rm -rf data`。
5. 提交：`git add -A && git commit -m "feat(api): /api/me write endpoints (favorites/tags/clear cache)"`

---

### Task 8：posts/books 内容缓存与 `refresh=1`（~50 min）

**Files:**
- `apps/api/src/index.ts`（~，重写 `handlePosts`/`handleBooks` + 缓存辅助函数）

**Interfaces**（追加到 `apps/api/src/index.ts`）：

```ts
interface LoadedContent {
  html: string
  fromCache: boolean
  refreshed: boolean
  refreshError?: string
}

/**
 * 正文/书库 HTML 加载：
 * - 无 refresh：先读缓存，命中直接返回；未命中抓上游并落盘
 * - 有 refresh：跳过缓存抓上游，成功覆盖缓存；失败回退旧缓存（stale），无旧缓存则抛错
 */
async function loadCachedContent(
  kind: ItemKind,
  id: string,
  refresh: boolean,
  fetchFn: () => Promise<string>
): Promise<LoadedContent> {
  if (!refresh) {
    const cached = await readContentCache(DATA_DIR, kind, id)
    if (cached) return { html: cached.data, fromCache: true, refreshed: false }
  }
  try {
    const html = await fetchFn()
    await writeContentCache(DATA_DIR, kind, id, html)
    return { html, fromCache: false, refreshed: refresh }
  } catch (err) {
    if (!refresh) throw err
    const cached = await readContentCache(DATA_DIR, kind, id)
    if (cached) {
      return {
        html: cached.data,
        fromCache: true,
        refreshed: false,
        refreshError: err instanceof Error ? err.message : "refresh failed",
      }
    }
    throw err
  }
}

/**
 * 回复加载：成功才写缓存；失败回退旧回复缓存（无则 []），永不导致整个请求失败、不置 stale。
 * 注意：catch 同时覆盖「上游非 2xx（fetchRepliesRaw 抛 502）」与「body 非 JSON（parseReplies 抛 502）」
 * 两类上游失败，均按规格回退旧缓存 / 空数组，符合部分刷新矩阵第 2、4 行；不要改成只 catch 网络错误。
 */
async function loadCachedReplies(
  tid: string,
  refresh: boolean
): Promise<{ replies: ReplyNode[]; fromCache: boolean }> {
  const extractor = getExtractor("cool18")
  if (!refresh) {
    const cached = await readRepliesCache(DATA_DIR, tid)
    if (cached && Array.isArray(cached.data)) {
      return { replies: cached.data as ReplyNode[], fromCache: true }
    }
  }
  try {
    const raw = await extractor.fetchRepliesRaw(tid)
    const replies = extractor.parseReplies(raw, tid)
    await writeRepliesCache(DATA_DIR, tid, replies)
    return { replies, fromCache: false }
  } catch {
    const cached = await readRepliesCache(DATA_DIR, tid)
    if (cached && Array.isArray(cached.data)) {
      return { replies: cached.data as ReplyNode[], fromCache: true }
    }
    return { replies: [], fromCache: false }
  }
}
```

`handlePosts` 重写（列表分支 `mtid` 不变）：

```ts
async function handlePosts(url: URL): Promise<Response> {
  const tid = url.searchParams.get("tid")
  const extractor = getExtractor("cool18")

  if (!tid) {
    const mtid = url.searchParams.get("mtid") || "0"
    const { links, nextMtid } = await extractor.fetchHomeLinks(mtid)
    return jsonOk({ links, nextMtid }, LIST_CACHE_HEADERS)
  }

  assertSafeId(tid) // 非法 id → 400

  const refresh = url.searchParams.get("refresh") === "1"
  const pageUrl = extractor.buildUrl(tid)

  const [content, repliesResult] = await Promise.all([
    loadCachedContent("post", tid, refresh, async () => {
      const resp = await fetchUpstream(pageUrl)
      if (!resp.ok) {
        throw new ExtractorError(`upstream error: ${resp.status}`, 502)
      }
      return resp.text()
    }),
    loadCachedReplies(tid, refresh),
  ])

  const { title, content: bodyHtml, meta } = extractor.extractContent(
    content.html
  )
  const links = extractor.extractLinks(content.html)

  // cache hit / 刷新时以回复缓存重算评论数（extractContent 不回填 comments）
  if (repliesResult.replies.length > 0) {
    meta.comments = countReplies(repliesResult.replies)
  }

  // 成功解析后记录访问（含 cache hit 与 stale 兜底）
  store.recordVisit("post", tid, title, pageUrl)

  const payload: Record<string, unknown> = {
    title,
    content: bodyHtml,
    links,
    meta,
    replies: repliesResult.replies,
    url: pageUrl,
  }
  if (refresh && !content.refreshed) {
    payload.stale = true
    payload.refreshError = content.refreshError
  }

  const useNoStore = content.fromCache || refresh
  return jsonOk(payload, useNoStore ? NO_STORE_HEADERS : CONTENT_CACHE_HEADERS)
}
```

`handleBooks` 重写：

```ts
async function handleBooks(url: URL): Promise<Response> {
  const cid = url.searchParams.get("cid")
  if (!cid) return jsonError("missing cid parameter", 400)
  assertSafeId(cid)

  const refresh = url.searchParams.get("refresh") === "1"
  const extractor = getExtractor("cool18")
  const pageUrl = extractor.buildBookUrl(cid)

  const content = await loadCachedContent("book", cid, refresh, async () => {
    const resp = await fetchUpstream(pageUrl, {
      headers: { Referer: extractor.homeUrl },
    })
    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }
    return resp.text()
  })

  const { title, content: bodyHtml, meta } = extractor.extractBookContent(
    content.html
  )

  store.recordVisit("book", cid, title, pageUrl)

  const payload: Record<string, unknown> = {
    title,
    content: bodyHtml,
    meta,
    url: pageUrl,
    cid,
  }
  if (refresh && !content.refreshed) {
    payload.stale = true
    payload.refreshError = content.refreshError
  }

  const useNoStore = content.fromCache || refresh
  return jsonOk(payload, useNoStore ? NO_STORE_HEADERS : CONTENT_CACHE_HEADERS)
}
```

`apps/api/src/index.ts` 的 import 追加：`assertSafeId`、`readContentCache`、`writeContentCache`、`readRepliesCache`、`writeRepliesCache`。

**Consumes-Produces:**
- Consumes：Task 4 的缓存模块、Task 5 的 `fetchRepliesRaw`/`parseReplies`、Task 2 的 `recordVisit`。
- Produces：`GET /api/posts?tid=` 与 `GET /api/books?cid=` 的缓存 + `refresh=1` 全语义（矩阵见规格第 156–164 行）；cache hit/refresh 响应 `no-store`。

**Steps:**

1. 按 Interfaces 重写 `handlePosts`/`handleBooks`，加两个辅助函数与 import。
2. `bun run typecheck`；`bun run dev:api`（配置 `HTTPS_PROXY` 若上游不可达）。
3. 手工验证（`TID` 换一个真实贴子 id）：

```bash
export TID=XXXX   # 真实 tid
# 首次抓取：落盘 + CONTENT_CACHE_HEADERS
curl -i -s "http://127.0.0.1:3001/api/posts?tid=$TID" | grep -i '^cache-control'   # s-maxage=300
ls data/cache/                                                                      # post-$TID.html + replies-$TID.json
# 二次访问：走缓存 + no-store；visit_count 累计为 2（首抓 1 次 + cache hit 1 次，非单次 +2）
curl -i -s "http://127.0.0.1:3001/api/posts?tid=$TID" | grep -i '^cache-control'   # no-store
curl -s 'http://127.0.0.1:3001/api/me/state?kind=post&id='"$TID"                   # visit_count 2
# refresh 成功：no-store + 覆盖缓存
curl -i -s "http://127.0.0.1:3001/api/posts?tid=$TID&refresh=1" | grep -i '^cache-control'  # no-store
# 书库同样验证
curl -i -s "http://127.0.0.1:3001/api/books?cid=XXXX" | grep -i '^cache-control'
ls data/cache/                                                                      # book-XXXX.html
# 非法 id → 400
curl -i -s 'http://127.0.0.1:3001/api/posts?tid=../etc' | head -1                   # 400
# 清空缓存
curl -s -X DELETE 'http://127.0.0.1:3001/api/me/cache'                              # {"cleared":N}
```

4. 手工验证 stale 路径（有代理环境）：

```bash
# 1) 有代理先抓一次落盘；2) 取消代理后 refresh → 旧正文 + stale:true
unset HTTPS_PROXY HTTP_PROXY
curl -s "http://127.0.0.1:3001/api/posts?tid=$TID&refresh=1" | bun -e 'const j = await Bun.stdin.json(); console.log(j.stale, j.refreshError)'
# 期望：true + 超时/网络错误信息，且 content 仍为旧正文
# 3) 无缓存 + 上游失败 → 502/504
curl -i -s 'http://127.0.0.1:3001/api/posts?tid=999999&refresh=1' | head -1
```

5. 回归：`curl -s 'http://127.0.0.1:3001/api/posts?mtid=0'` 仍返回列表。
6. 清理：`rm -rf data`；提交：`git add -A && git commit -m "feat(api): posts/books disk cache and refresh=1 (stale fallback)"`

---

### Task 9：前端基础（路由/导航/图标/ArticleView 插槽）（~35 min）

> 前端无自动化测试设施，本任务及后续前端任务验证 = `bun run typecheck` + `bun run build:web` + 手工点击。

**Files:**
- `apps/web/src/lib/routes.ts`（~）
- `apps/web/src/lib/format.ts`（~）
- `apps/web/src/App.tsx`（~）
- `apps/web/src/components/site-header.tsx`（~）
- `apps/web/src/components/article-view.tsx`（~）
- `apps/web/src/components/icons.tsx`（~）

**Interfaces:**

`routes.ts`：`routes` 增加 `history: "/history"`、`favorites: "/favorites"`、`tags: "/tags"`；`api` 增加 `meHistory: "/api/me/history"`、`meFavorites: "/api/me/favorites"`、`meTags: "/api/me/tags"`、`meItems: "/api/me/items"`、`meState: "/api/me/state"`、`meCache: "/api/me/cache"`；追加两个查询助手：

```ts
/** /api/me/* 列表查询串（q/kind/page），page>1 才带 */
export function meListQuery(opts: {
  q?: string
  kind?: string
  page?: number
}): string {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.kind) params.set("kind", opts.kind)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return params.toString()
}

/** 标签页筛选路径：/tags?tag=xxx[&q=&kind=&page=] */
export function tagsPath(opts: {
  tag: string
  q?: string
  kind?: string
  page?: number
}): string {
  const params = new URLSearchParams()
  params.set("tag", opts.tag)
  if (opts.q) params.set("q", opts.q)
  if (opts.kind) params.set("kind", opts.kind)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return `${routes.tags}?${params.toString()}`
}
```

`NAV_ITEMS` 末尾追加三项（match 精确匹配）：

```ts
  {
    href: routes.history,
    label: "历史",
    match: (p: string) => p === routes.history,
  },
  {
    href: routes.favorites,
    label: "收藏",
    match: (p: string) => p === routes.favorites,
  },
  {
    href: routes.tags,
    label: "标签",
    match: (p: string) => p === routes.tags,
  },
```

`format.ts` 追加：

```ts
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

`App.tsx`：import 三个新页面组件（Task 10/11 创建；本任务先建最小占位页面保证可编译，或把路由行注释到 Task 10/11 再加——**推荐后者**：本任务只加 HistoryPage/FavoritesPage/TagsPage 的占位文件，路由注册随各自任务落地）。为保持本任务自洽：创建三个最小占位页（`return null`），并在 `App.tsx` 注册：

```tsx
<Route path="/history" element={<HistoryPage />} />
<Route path="/favorites" element={<FavoritesPage />} />
<Route path="/tags" element={<TagsPage />} />
```

`site-header.tsx` 移动端抽屉：`grid grid-cols-3 gap-1.5 sm:grid-cols-4` → `flex gap-1.5 overflow-x-auto`，链接加 `shrink-0`。**桌面 nav（`lg:flex`，第 49 行）已有 `overflow-x-auto`，加 3 项后自然横向滚动，本任务无需改动桌面端**：

```tsx
<nav className="border-border/60 mx-auto max-w-3xl border-t px-3 py-3 lg:hidden">
  <div className="flex gap-1.5 overflow-x-auto pb-1">
    {NAV_ITEMS.map((item) => {
      const active = item.match(pathname)
      return (
        <Link
          key={item.href}
          to={item.href}
          className={cn(
            "inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-medium transition-colors",
            active
              ? "bg-accent text-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {item.label}
        </Link>
      )
    })}
  </div>
</nav>
```

`icons.tsx` 追加四个图标（沿用 `base` 样式）：

```tsx
export function IconFileText({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

export function IconBookOpen({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

export function IconStar({ className, size, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
    </svg>
  )
}

export function IconRefreshCw({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M3 21v-5h5" />
    </svg>
  )
}
```

`article-view.tsx`：`ArticleView` 增加 `actions?: ReactNode`，渲染在 `<h1>` 与 `PostMetaBar` 之间：

```tsx
export function ArticleView({
  title,
  meta,
  contentHtml,
  sourceUrl,
  currentTid,
  actions,
  footer,
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
}) {
  return (
    <article ...>
      {/* SourceLink 行不变 */}
      <h1 ...>{title}</h1>

      {actions && <div className="mb-4">{actions}</div>}

      {meta && <PostMetaBar meta={meta} currentTid={currentTid} />}
      <ContentBody html={contentHtml} />
      {footer}
    </article>
  )
}
```

**Consumes-Produces:**
- Consumes：现有 `routes.ts`/`NAV_ITEMS`/`SiteHeader`/`ArticleView`/`icons.tsx`。
- Produces：可编译的导航与路由底座；`meListQuery`/`tagsPath`/`formatDateTime`/四个图标/`actions` 插槽；三个占位页面。

**Steps:**

1. 按 Interfaces 修改 6 个文件；新建三个占位页（`apps/web/src/pages/{HistoryPage,FavoritesPage,TagsPage}.tsx`，内容 `export default function X() { return null }`）。
2. `bun run typecheck`；`bun run build:web`。
3. 手工：`bun run dev` → 桌面与移动宽度下导航出现 历史/收藏/标签；移动端抽屉可横向滚动；其余页面无回归。
4. 提交：`git add -A && git commit -m "feat(web): routes/nav/icons/ArticleView actions slot"`

---

### Task 10：MeListPage + 历史页 + 收藏页（~45 min）

**Files:**
- `apps/web/src/components/tag-chips.tsx`（+）
- `apps/web/src/components/me-item-card.tsx`（+）
- `apps/web/src/components/me-list-page.tsx`（+）
- `apps/web/src/pages/HistoryPage.tsx`（~，替换占位）
- `apps/web/src/pages/FavoritesPage.tsx`（~，替换占位）

**Interfaces:**

`tag-chips.tsx`（完整文件；全局可点，跳 `/tags?tag=`）：

```tsx
import { Link } from "react-router-dom"
import { tagsPath } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export function TagChips({
  tags,
  className,
}: {
  tags: string[]
  className?: string
}) {
  if (!tags.length) return null
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <Link
          key={tag}
          to={tagsPath({ tag })}
          className="bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-1.5 py-0.5 text-[11px] leading-4 transition-colors"
        >
          #{tag}
        </Link>
      ))}
    </span>
  )
}
```

`me-item-card.tsx`（完整文件；标题/图标/时间/访问次数进 Link，标签 chips 与 trailing 按钮在外层，避免 a 嵌套 a）：

```tsx
import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  IconBookOpen,
  IconChevronRight,
  IconFileText,
} from "@/components/icons"
import { TagChips } from "@/components/tag-chips"
import { formatDateTime } from "@/lib/format"
import { bookPath, readPath } from "@/lib/routes"

export interface MeListItem {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

export function MeItemCard({
  item,
  trailing,
}: {
  item: MeListItem
  trailing?: ReactNode
}) {
  const href = item.kind === "post" ? readPath(item.id) : bookPath(item.id)
  const time = item.last_visited_at ?? item.favorited_at
  return (
    <div className="border-border/80 bg-card/80 hover:border-border group flex flex-col rounded-2xl border px-3.5 py-3.5 shadow-sm transition-all duration-200 sm:px-4 sm:py-4">
      <div className="flex items-center gap-3 sm:gap-3.5">
        <Link to={href} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5">
          <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            {item.kind === "post" ? (
              <IconFileText size={15} />
            ) : (
              <IconBookOpen size={15} />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-2 text-[15px] leading-snug font-medium">
              {item.title}
            </span>
            <span className="text-muted-foreground text-xs">
              {time != null && <>{formatDateTime(time)} · </>}
              {item.visit_count} 次访问
            </span>
          </span>
          <IconChevronRight
            size={16}
            className="text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors"
          />
        </Link>
        {trailing}
      </div>
      <div className="mt-1.5 pl-11 sm:pl-[3.25rem]">
        <TagChips tags={item.tags} />
      </div>
    </div>
  )
}
```

`me-list-page.tsx`（完整文件；搜索框 + 类型 tabs + Pager + trailing 插槽；URL 驱动 q/kind/page）：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { parsePage, parseQuery } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export type MeListPick = (json: Record<string, unknown>) => {
  items: MeListItem[]
  nextPage?: number
}

export function MeListPage({
  title,
  description,
  buildUrl,
  pick,
  renderTrailing,
  emptyText,
}: {
  title: string
  description?: string
  /** (q, kind, page) → 完整请求 URL */
  buildUrl: (q: string, kind: string, page: number) => string
  pick: MeListPick
  renderTrailing?: (item: MeListItem, reload: () => void) => ReactNode
  emptyText?: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)

  const url = useMemo(() => buildUrl(q, kind, page), [buildUrl, q, kind, page])
  const pickRef = useRef(pick)
  pickRef.current = pick

  const [items, setItems] = useState<MeListItem[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const res = await fetch(url)
      const json = (await res.json()) as Record<string, unknown>
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(String(json.error || "请求失败"))
        return
      }
      const data = pickRef.current(json)
      setItems(data.items)
      setNextPage(data.nextPage)
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void reload()
  }, [reload])

  function update(next: { q?: string; kind?: string; page?: number }) {
    const params = new URLSearchParams(searchParams)
    const changeQ = next.q !== undefined
    const changeKind = next.kind !== undefined
    if (changeQ) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (changeKind) {
      if (next.kind) params.set("kind", next.kind)
      else params.delete("kind")
    }
    if (next.page !== undefined && next.page > 1) {
      params.set("page", String(next.page))
    } else if (changeQ || changeKind || next.page === 1) {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  const KIND_TABS = [
    { value: "", label: "全部" },
    { value: "post", label: "贴子" },
    { value: "book", label: "书库" },
  ]

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description ?? "最近访问的贴子与书库"}
      />

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const input = new FormData(e.currentTarget).get("q")
          update({ q: typeof input === "string" ? input.trim() : "" })
        }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索标题或标签…"
          className="border-border bg-card text-foreground placeholder:text-muted-foreground/60 h-11 min-w-0 flex-1 rounded-xl border px-3.5 text-sm outline-none focus:border-sky-500/60"
        />
        <button
          type="submit"
          className="bg-accent text-foreground h-11 shrink-0 rounded-xl px-4 text-sm font-medium"
        >
          搜索
        </button>
      </form>

      <div className="mb-4 flex gap-1.5">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => update({ kind: tab.value })}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              kind === tab.value
                ? "bg-accent text-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent/70"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={emptyText ?? "暂无内容"}
      >
        <PostList>
          {items.map((item) => (
            <MeItemCard
              key={`${item.kind}:${item.id}`}
              item={item}
              trailing={renderTrailing?.(item, reload)}
            />
          ))}
        </PostList>
        <Pager
          page={page}
          hasNext={nextPage !== undefined}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => nextPage !== undefined && update({ page: nextPage })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
```

`HistoryPage.tsx`（替换占位）：

```tsx
import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { api, meListQuery } from "@/lib/routes"

export default function HistoryPage() {
  return (
    <MeListPage
      title="浏览历史"
      description="最近访问的贴子与书库"
      buildUrl={(q, kind, page) =>
        `${api.meHistory}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
    />
  )
}
```

`FavoritesPage.tsx`（替换占位；带取消收藏按钮）：

```tsx
import { useCallback, useState } from "react"
import {
  MeListPage,
} from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { api, meListQuery } from "@/lib/routes"

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
      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
    >
      取消收藏
    </button>
  )
}

export default function FavoritesPage() {
  const renderTrailing = useCallback(
    (item: MeListItem, reload: () => void) => (
      <UnfavoriteButton item={item} reload={reload} />
    ),
    []
  )
  return (
    <MeListPage
      title="收藏"
      description="收藏的贴子与书库"
      buildUrl={(q, kind, page) =>
        `${api.meFavorites}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
    />
  )
}
```

**Consumes-Produces:**
- Consumes：Task 9 的 `routes`/`api`/`meListQuery`/`formatDateTime`/图标/`PageShell`/`AsyncBody`/`Pager`/`PageHeader`/`PostList`。
- Produces：可用的历史页与收藏页（搜索、类型筛选、分页、标签 chips、取消收藏）。

**Steps:**

1. 按 Interfaces 新建 `tag-chips.tsx`、`me-item-card.tsx`、`me-list-page.tsx`；替换 `HistoryPage.tsx`、`FavoritesPage.tsx`。
2. `bun run typecheck`；`bun run build:web`。
3. 手工验证（`bun run dev:api` + `bun run dev:web`，先造数据）：

```bash
bun -e 'import { openDatabase, Store } from "@workspace/core"; const s = new Store(openDatabase("./data")); s.recordVisit("post","1","测试贴","u1"); s.recordVisit("book","2","测试书","u2"); s.setTags("post","1",["科幻"]); s.addFavorite("post","1")'
```

   - `/history`：两条记录，顺序正确，标签 chip 显示，点 chip 跳 `/tags?tag=科幻`（Task 11 前显示占位页）。
   - 搜索「测试」/「科幻」过滤生效；类型 tabs 生效；翻页正常。
   - `/favorites`：只有 post 1；「取消收藏」后列表刷新为空态。
4. 提交：`git add -A && git commit -m "feat(web): history/favorites pages (MeListPage shared list)"`

---

### Task 11：标签页 + 数据管理（~45 min）

**Files:**
- `apps/web/src/pages/TagsPage.tsx`（~，替换占位为完整实现）

**Interfaces:**

`TagsPage.tsx`（完整文件；无 `?tag=` 时展示标签计数列表 + 客户端搜索 + 底部数据管理；有 `?tag=` 时复用 `MeListPage` 展示该标签下对象并可继续搜索/筛选）：

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  MeListPage,
} from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { api, meListQuery, tagsPath } from "@/lib/routes"

interface TagCount {
  tag: string
  count: number
}

function TagListView() {
  const [tags, setTags] = useState<TagCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch(api.meTags)
      .then(async (res) => {
        const json = (await res.json()) as { tags?: TagCount[] }
        if (!cancelled && res.ok) setTags(json.tags ?? [])
        else if (!cancelled)
          setError(String((json as { error?: string }).error || "请求失败"))
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "未知错误")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tags
    return tags.filter((t) => t.tag.toLowerCase().includes(needle))
  }, [tags, q])

  return (
    <PageShell>
      <PageHeader title="标签" description="点击标签筛选贴子与书库" />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="筛选标签…"
        className="border-border bg-card text-foreground placeholder:text-muted-foreground/60 mb-4 h-11 w-full rounded-xl border px-3.5 text-sm outline-none focus:border-sky-500/60"
      />

      {loading && (
        <p className="text-muted-foreground py-10 text-center text-sm">加载中…</p>
      )}
      {error && (
        <p className="text-destructive py-10 text-center text-sm">{error}</p>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-muted-foreground py-10 text-center text-sm">暂无标签</p>
      )}

      <div className="flex flex-col gap-1.5">
        {filtered.map((t) => (
          <Link
            key={t.tag}
            to={tagsPath({ tag: t.tag })}
            className="border-border/80 bg-card/80 hover:border-border hover:bg-accent/50 flex items-center justify-between rounded-2xl border px-4 py-3 transition-colors"
          >
            <span className="text-foreground text-[15px] font-medium">
              #{t.tag}
            </span>
            <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs tabular-nums">
              {t.count} 项
            </span>
          </Link>
        ))}
      </div>

      {/* 有意为之：清空入口只出现在标签列表页底部（规格「标签页底部」语义）；?tag= 筛选页（TagItemsView）不渲染 */}
      <DataManagement />
    </PageShell>
  )
}

function TagItemsView() {
  const [searchParams] = useSearchParams()
  const tag = searchParams.get("tag") ?? ""
  return (
    <MeListPage
      title={`#${tag}`}
      description="该标签下的贴子与书库"
      buildUrl={(q, kind, page) => {
        const params = meListQuery({ q, kind, page })
        const query = params ? `&${params}` : ""
        return `${api.meItems}?tag=${encodeURIComponent(tag)}${query}`
      }}
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
    />
  )
}

function DataManagement() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState("")

  const clearCache = async () => {
    setBusy(true)
    try {
      const res = await fetch(api.meCache, { method: "DELETE" })
      const json = (await res.json()) as { cleared?: number; error?: string }
      if (!res.ok) throw new Error(json.error || "清空失败")
      setResult(`已清除 ${json.cleared ?? 0} 个缓存文件`)
      setConfirming(false)
    } catch (e) {
      setResult(e instanceof Error ? e.message : "清空失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-border mt-12 rounded-2xl border p-4 sm:p-5">
      <h2 className="text-foreground mb-1 text-sm font-semibold">数据管理</h2>
      <p className="text-muted-foreground mb-3 text-xs">
        清空正文/书库 HTML 与回复 JSON 缓存，不影响历史、收藏与标签。
      </p>
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void clearCache()}
            disabled={busy}
            className="bg-destructive text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            确认清空
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="bg-muted text-muted-foreground rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="bg-muted/70 text-muted-foreground hover:bg-muted rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          清空缓存
        </button>
      )}
      {result && <p className="text-muted-foreground mt-2 text-xs">{result}</p>}
    </section>
  )
}

export default function TagsPage() {
  const [searchParams] = useSearchParams()
  const tag = searchParams.get("tag")?.trim()
  if (tag) return <TagItemsView />
  return <TagListView />
}
```

> 注：`useCallback` 在完整文件中未使用可移除；`TagItemsView` 每次渲染新建 `buildUrl` 闭包，`MeListPage` 以 `useMemo` 依赖 `buildUrl`，tag 变化时 URL 同步变化，符合预期。

**Consumes-Produces:**
- Consumes：Task 10 的 `MeListPage`/`MeListItem`、Task 9 的 `api.meTags/meItems/meCache`/`tagsPath`/`meListQuery`。
- Produces：标签计数列表（数量倒序，客户端搜索）、`?tag=` 对象筛选页（可继续搜索/类型筛选/分页）、「数据管理」清空缓存（DELETE + 二次确认 + 结果提示）。

**Steps:**

1. 替换 `TagsPage.tsx` 为完整实现（见 Interfaces）。
2. `bun run typecheck`；`bun run build:web`。
3. 手工验证：

```bash
bun -e 'import { openDatabase, Store } from "@workspace/core"; const s = new Store(openDatabase("./data")); s.recordVisit("post","1","测试贴","u1"); s.recordVisit("post","3","另一篇","u3"); s.setTags("post","1",["科幻","长篇"]); s.setTags("post","3",["科幻"])'
```

   - `/tags`：`#科幻 2 项`、`#长篇 1 项`（数量倒序）；输入「科」过滤。
   - 点 `#科幻` → `/tags?tag=科幻`：两条对象，标题/时间/访问次数正常；搜索「测试」剩 1 条；类型 tabs 生效。
   - 全局：任何页面标签 chip 点击均跳转 `/tags?tag=xxx`。
   - 先抓一篇正文产生缓存文件，再在标签页底部「数据管理」清空 → 显示「已清除 N 个缓存文件」；`ls data/cache` 为空。
4. 提交：`git add -A && git commit -m "feat(web): tags page (list/filter/data management)"`

---

### Task 12：正文/书库页操作行（收藏/标签编辑/刷新）（~50 min）

**Files:**
- `apps/web/src/components/item-actions.tsx`（+）
- `apps/web/src/pages/ReadPage.tsx`（~）
- `apps/web/src/pages/BookPage.tsx`（~）

**Interfaces:**

`item-actions.tsx`（完整文件）：

```tsx
import { useCallback, useEffect, useState } from "react"
import { IconRefreshCw, IconStar } from "@/components/icons"
import { TagChips } from "@/components/tag-chips"
import { api } from "@/lib/routes"

export interface ItemState {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

/** 打开页面时回填 /api/me/state */
export function useItemState(kind: "post" | "book", id: string) {
  const [state, setState] = useState<ItemState | null>(null)
  const reload = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(
        `${api.meState}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      if (!res.ok) return
      const json = (await res.json()) as ItemState
      setState(json)
    } catch {
      // 状态读取失败静默，不影响正文展示
    }
  }, [kind, id])
  useEffect(() => {
    void reload()
  }, [reload])
  return { state, reload }
}

export function ItemActions({
  kind,
  id,
  onRefresh,
  refreshing,
}: {
  kind: "post" | "book"
  id: string
  onRefresh: () => void
  refreshing: boolean
}) {
  const { state, reload } = useItemState(kind, id)
  const [busy, setBusy] = useState(false)

  const toggleFavorite = async () => {
    setBusy(true)
    try {
      const method = state?.favorited ? "DELETE" : "PUT"
      const res = await fetch(
        `${api.meFavorites}?kind=${kind}&id=${encodeURIComponent(id)}`,
        { method }
      )
      if (res.ok) await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveTags = async (tags: string[]) => {
    const res = await fetch(api.meTags, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, tags }),
    })
    if (res.ok) await reload()
    return res.ok
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggleFavorite()}
        disabled={busy}
        className={[
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
          state?.favorited
            ? "bg-amber-400/15 text-amber-600 hover:bg-amber-400/25 dark:text-amber-400"
            : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground",
        ].join(" ")}
      >
        <IconStar size={13} filled={state?.favorited} />
        {state?.favorited ? "已收藏" : "收藏"}
      </button>

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <IconRefreshCw
          size={13}
          className={refreshing ? "animate-spin" : undefined}
        />
        刷新
      </button>

      <TagEditor tags={state?.tags ?? []} onSave={saveTags} />
    </div>
  )
}

function TagEditor({
  tags,
  onSave,
}: {
  tags: string[]
  onSave: (tags: string[]) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const next = value
      .split(/[，,]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const ok = await onSave(next)
    setBusy(false)
    if (ok) {
      setValue("")
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape") setEditing(false)
          }}
          placeholder="多个标签用逗号分隔"
          className="border-border bg-card text-foreground placeholder:text-muted-foreground/60 h-8 w-52 rounded-lg border px-2.5 text-xs outline-none focus:border-sky-500/60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="bg-accent text-foreground rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="bg-muted/70 text-muted-foreground rounded-lg px-2.5 py-1.5 text-xs font-medium"
        >
          取消
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TagChips tags={tags} />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      >
        编辑标签
      </button>
    </span>
  )
}
```

`ReadPage.tsx` 改动（`fetchContent` 支持 `{ refresh?: boolean }`；stale 提示条；`actions` 插槽）：

```tsx
const [refreshing, setRefreshing] = useState(false)
const [refreshNotice, setRefreshNotice] = useState("")

const fetchContent = useCallback(
  async (opts?: { refresh?: boolean }) => {
    if (!tid) return
    const refresh = opts?.refresh
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `${api.posts}?tid=${encodeURIComponent(tid)}${refresh ? "&refresh=1" : ""}`
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setContent(json)
      setRefreshNotice(
        json.stale ? "刷新失败，当前展示的是缓存内容" : ""
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      if (refresh) setRefreshing(false)
      else setLoading(false)
    }
  },
  [tid]
)

// useEffect 里改用 fetchContent()（默认不刷新）；render：
{refreshNotice && (
  <div className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 mb-4 rounded-2xl border px-4 py-2.5 text-sm">
    {refreshNotice}
  </div>
)}
// ArticleView 增加：
actions={
  <ItemActions
    kind="post"
    id={tid}
    onRefresh={() => void fetchContent({ refresh: true })}
    refreshing={refreshing}
  />
}
```

`BookPage.tsx`：同样改造（`kind="book"`、无 replies、`api.books`），`ArticleView` 传 `actions`。

**Consumes-Produces:**
- Consumes：Task 9 的 `ArticleView.actions` 插槽、图标；Task 10 的 `TagChips`；`api.meState/meFavorites/meTags`。
- Produces：正文/书库页标题下操作行（收藏切换、标签编辑整体替换、刷新 + 旋转图标 + stale 提示条）；打开页面自动回填状态。

**Steps:**

1. 新建 `item-actions.tsx`；改造 `ReadPage.tsx`/`BookPage.tsx`（见 Interfaces）。
2. `bun run typecheck`；`bun run build:web`。
3. 手工验证（先抓取一篇正文/书库，确保 `items` 存在）：

```bash
bun -e 'import { openDatabase, Store } from "@workspace/core"; const s = new Store(openDatabase("./data")); s.recordVisit("post","1","测试贴","u1")'
```

   - `/read/1`：操作行出现；点「收藏」变「已收藏」（星星填充），刷新页面仍保持；点「已收藏」取消。
   - 「编辑标签」输入 `科幻, 长篇` 回车 → chips 更新为 `#科幻 #长篇`；点 chip 跳 `/tags?tag=科幻`。
   - 「刷新」：正常时图标旋转后内容更新、无提示；断网/无代理时出现「刷新失败，当前展示的是缓存内容」且内容为旧缓存；`stale` 响应体带 `stale:true`。
   - 打开正文后 `/api/me/history` 出现该贴且 visit_count 递增。
   - `/book/1` 同样验证（无回复）。
4. 提交：`git add -A && git commit -m "feat(web): read/book page action row (favorite/tags/refresh)"`

---

### Task 13：部署与文档（~20 min）

**Files:**
- `Dockerfile`（~）
- `.gitignore`（~）
- `README.md`（~）
- `AGENTS.md`（~）

**Interfaces:**

`Dockerfile`（两处，均针对 runner 阶段）：
- `ENV DATA_DIR=/data` 并入现有 ENV 块（第 52–55 行，`NODE_ENV`/`PORT`/`HOSTNAME`/`WEB_DIST` 之后）；
- `RUN mkdir -p /data && chown -R bun:bun /data` 放在 `USER bun` 前一行（第 64–65 行 `EXPOSE 3000` → `USER bun` 之间）：

```dockerfile
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R bun:bun /data
```

`.gitignore`：`# misc` 区块追加：

```gitignore
# local data (sqlite + content cache)
data/
```

`README.md`：
- 环境变量表新增 `DATA_DIR | ./data | SQLite 库与内容缓存目录`。
- API 表新增 `/api/me/*` 各端点行与 `refresh=1` 说明。
- 部署小节记录挂载：`docker run -p 3000:3000 -v purifier-data:/data purifier:latest`。

`AGENTS.md`：同步环境变量表（`DATA_DIR`）、API 约定表（`/api/me/*`、`refresh=1`）、验证命令（`bun run test`）。

**Consumes-Produces:**
- Consumes：既有 Dockerfile（runner 阶段）/README/AGENTS.md。
- Produces：容器内数据持久化到 `/data` 卷；开发时 `data/` 不入库；文档与仓库约定同步。

**Steps:**

1. 按 Interfaces 修改 4 个文件。
2. `bun run typecheck`；`bun run test`；`bun run build`；`bun run format`（全仓格式化）。
3. Docker 验证（可选但推荐）：

```bash
docker build -t purifier:latest .
docker run -d --name purifier-test -p 3000:3000 -v purifier-data:/data purifier:latest
curl -s http://127.0.0.1:3000/api/health
# 打开一篇正文 → 容器内 /data/cache 出现缓存文件；删除容器与卷后重跑，历史仍在
docker rm -f purifier-test && docker volume rm purifier-data
```

4. 提交：`git add -A && git commit -m "chore: deployment and docs (DATA_DIR/volume/api-me conventions)"`

---

## 验收清单（Self-Review 对照）

| # | 规格要求 | 落点 |
| --- | --- | --- |
| 1 | 三张表 + 三个索引，DDL 与规格一致 | Task 1 `db.ts` |
| 2 | 历史全量保留、最近访问倒序、可搜索 | Task 2/3/6 |
| 3 | 收藏单一列表、可搜索、对象不存在 404 | Task 2/3/7 |
| 4 | 标签整体替换、normalize（trim/折叠/24 码点/去重）、精确筛选 | Task 2/3/7/11 |
| 5 | 列表 `{ items, nextPage? }`，pageSize=20，page 从 1 | Task 3 |
| 6 | `tags`/`favorited` 单次 SQL 聚合，无 N+1 | Task 3 `runList`+`tagsFor` |
| 7 | 缓存文件名 `post-<tid>.html`/`book-<cid>.html`/`replies-<tid>.json` | Task 4 |
| 8 | ID 安全校验 `/^[A-Za-z0-9]+$/` → 400 | Task 4 `assertSafeId` |
| 9 | 回复缓存成功才写；空回复写 `[]`；正文/回复独立命中 | Task 4/5/8 |
| 10 | `refresh=1` 部分失败矩阵与 `stale`/`refreshError` | Task 8 |
| 11 | 缓存命中/刷新/`/api/me/*` 响应 `no-store`；首抓保留 CONTENT 头 | Task 6/7/8 |
| 12 | cache hit 时 `meta.comments` 由回复缓存重算 | Task 8 |
| 13 | 成功访问 upsert（title 覆盖、visit_count+1、first_seen 保留） | Task 2/8 |
| 14 | 路由 `(method, pathname)` 分发；SPA 早返回不变 | Task 6 |
| 15 | 清空缓存 `DELETE /api/me/cache` → `{ cleared: n }` | Task 4/7/11 |
| 16 | 前端三导航入口（移动端横向滚动）+ 三页面 + 标签 chips 全局可点 | Task 9/10/11 |
| 17 | 正文/书库页操作行（收藏切换/标签编辑/刷新） | Task 12 |
| 18 | Docker `DATA_DIR=/data` + mkdir/chown；README 挂载；`.gitignore data/` | Task 13 |
| 19 | `bun run test` / `typecheck` / `build` 全绿 | 各任务验证步骤 |

## 评审修订记录

2026-08-04 按 `docs/superpowers/plans/review.md` 修订：

- **P0-1**（Task 10）：HistoryPage `pick` 改为直接 `json as { items: MeListItem[]; nextPage?: number }`，删除 `never[]` 写法与误导注释，补齐 `MeListItem` import。
- **P0-2**（Task 8）：`Promise.all` 解构变量 `replies` 改名 `repliesResult`，消除 `replies.replies` 命名混乱。
- **P0-3**（Task 6）：补全 `handleComments`/`handleTrending` 完整实现（含 `resp.ok` 分支与 `LIST_CACHE_HEADERS`），消除复制歧义。
- **P1-4**（Task 8）：`loadCachedReplies` 文档注释点明 catch 同时覆盖上游非 2xx 与 body 非 JSON 两类 502，均按规格回退，不要改窄。
- **P1-5**（Task 8）：验证步骤措辞改为「visit_count 累计为 2（首抓 1 + cache hit 1）」。
- **P1-6**（Task 3）：`listByTag` SQL 上方注释说明 bare column 因 items 主键组内唯一而安全。
- **P1-7**（Task 3）：`listFavorites` 注释说明 `favorited_at + rowid` 排序在同毫秒下的行为符合预期。
- **P2-8**（Task 3）：`tagsFor` 注释说明动态 SQL 绕过 prepared statement 缓存为已知、可接受。
- **P2-10**（Task 6）：`handleMeState` 注释说明空状态 200 的选择与前端 null 处理的等价性。
- **P2-11**（Task 9）：注明桌面 nav 已有 `overflow-x-auto`，仅移动端抽屉改 grid→flex。
- **P2-12**（Task 13）：明确 `ENV DATA_DIR=/data` 并入现有 ENV 块，`RUN mkdir/chown` 放 `USER bun` 前一行。
- **P2-13**（Task 11）：`DataManagement` 仅渲染于标签列表页底部为有意为之，加注释确认。
- P2-9（`assertSafeId` 错误消息）维持现状，评审判定可接受。

