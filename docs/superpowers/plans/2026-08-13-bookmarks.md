# 正文选区书签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中正文可钉多条带摘录与可选备注的书签；篇内与「我的 → 书签」都能跳回；摘录找不到时按保存的滚动比例定位并标 stale。

**Architecture:** 独立 `bookmarks` 表挂 `items`，不改 `read_progress`。定位用摘录 `indexOf`，失败回退 `scrollProgress`。选区浮条改名为 `ReadingSelectionToolbar`（书签 | 人物）。「我的」Tab 不带 `?site=`。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19、Tailwind 4。

**Spec:** `docs/superpowers/specs/2026-08-13-bookmarks-design.md`

## Global Constraints

- Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 验证：`bun run test` / `bun run typecheck` / `bun run build`。
- `/api/me/*` 用 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`。
- 不改 `extractPreHtml` / 内容缓存 HTML；不在正文插入常驻 mark。
- `bookmarks` **不建 FOREIGN KEY**；级联由 `purgeItem` / `clearHistory` 显式 DELETE。
- `quote` 最长 200 码点、`note` 最长 80 码点；每篇/每章上限 50。
- 全局书签列表每页 20（`PAGE_SIZE`），不暴露 `limit`。
- `exportBackup().version` 升为 `3`。
- web 纯函数可放 `packages/core` 用 `bun test`；组件不做单测。
- **`chapter` 与 cool18：** spec 写「书库必须带 chapter」。实现上：仅 **URL 带 chapter 的 xbookcn 章**（`kind=book` 且 `chapter` 为有限数字）按章存/滤；论坛帖与 **cool18 整本一页**（`kind=book` 且无 chapter）`chapter` 为 SQL `NULL`。GET 当前篇：`kind`+`id` 同时有；有 `chapter` 则滤该章，无则 `chapter IS NULL`。不要对 cool18 书 400。
- `useReadingProgress` 不引入书签概念；有效 `bm` 时页面把 `restore` 传 `null`；定位后调 `syncFromViewport()`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/bookmarks.ts` | `normalizeBookmarkQuote` / `normalizeBookmarkNote` / `findQuoteIndex` / 常量 |
| `packages/core/src/bookmarks.test.ts` | 上述纯函数 |
| `packages/core/package.json` | 增加 `"./bookmarks"` export |
| `packages/core/src/storage/types.ts` | `Bookmark`、`AddBookmarkResult`、`StatsInventory.bookmarks` |
| `packages/core/src/storage/db.ts` | `bookmarks` 表 + 索引 |
| `packages/core/src/storage/store.ts` | CRUD、级联、export v3、inventory |
| `packages/core/src/storage/bookmarks.test.ts` | store 行为 |
| `packages/core/src/storage/store.test.ts` | 表名列表、export version、inventory |
| `apps/api/src/index.ts` | `/api/me/bookmarks` 与 `/:id` |
| `apps/web/src/lib/routes.ts` | 路由、API、ME_TABS、NAV_ITEMS、`readPath`/`bookPath` 的 `bm` |
| `apps/web/src/lib/hub-tabs.ts` | Me Tab 不带 site |
| `apps/web/src/App.tsx` | `/bookmarks` |
| `apps/web/src/hooks/use-reading-progress.ts` | `syncFromViewport()` |
| `apps/web/src/lib/bookmark-locate.ts` | DOM Range 滚动到摘录 |
| `apps/web/src/hooks/use-bookmarks.ts` | 当前篇书签 CRUD |
| `apps/web/src/components/reading-selection-toolbar.tsx` | 由 character toolbar 改名；书签 \| 人物 |
| `apps/web/src/components/bookmark-list.tsx` | 篇内列表 |
| `apps/web/src/pages/ReadPage.tsx` / `BookPage.tsx` | 接线、`bm` 定位 |
| `apps/web/src/pages/BookmarksPage.tsx` | 「我的」书签页 |
| `apps/web/src/pages/StatsPage.tsx` | inventory 卡片 |
| `apps/web/src/pages/HistoryPage.tsx` | 清空文案带上书签 |
| `AGENTS.md` | API 表 |

---

### Task 1: 摘录规范化与 indexOf

**Files:**
- Create: `packages/core/src/bookmarks.ts`
- Create: `packages/core/src/bookmarks.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Consumes: 无
- Produces:
  - `BOOKMARK_QUOTE_MAX = 200`
  - `BOOKMARK_NOTE_MAX = 80`
  - `BOOKMARKS_PER_SCOPE_CAP = 50`
  - `normalizeBookmarkQuote(raw: string): string | null`
  - `normalizeBookmarkNote(raw: string): string`
  - `findQuoteIndex(haystack: string, quote: string): number`

- [ ] **Step 1: 写失败测试**

`packages/core/src/bookmarks.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import {
  findQuoteIndex,
  normalizeBookmarkNote,
  normalizeBookmarkQuote,
} from "./bookmarks"

describe("normalizeBookmarkQuote", () => {
  test("trims, collapses whitespace including newlines", () => {
    expect(normalizeBookmarkQuote("  甲\n乙\t丙  ")).toBe("甲 乙 丙")
  })
  test("empty after normalize is null", () => {
    expect(normalizeBookmarkQuote("  \n\t  ")).toBeNull()
    expect(normalizeBookmarkQuote("")).toBeNull()
  })
  test("truncates to 200 code points", () => {
    const q = normalizeBookmarkQuote("你".repeat(201))
    expect(q).toBe("你".repeat(200))
  })
})

describe("normalizeBookmarkNote", () => {
  test("empty stays empty", () => {
    expect(normalizeBookmarkNote("  ")).toBe("")
  })
  test("trims and truncates to 80", () => {
    expect(normalizeBookmarkNote("  hi  ")).toBe("hi")
    expect(normalizeBookmarkNote("x".repeat(81)).length).toBe(80)
  })
})

describe("findQuoteIndex", () => {
  test("first occurrence", () => {
    expect(findQuoteIndex("aaa bbb aaa", "aaa")).toBe(0)
  })
  test("miss is -1", () => {
    expect(findQuoteIndex("hello", "zzz")).toBe(-1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/bookmarks.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/bookmarks.ts`：

```ts
export const BOOKMARK_QUOTE_MAX = 200
export const BOOKMARK_NOTE_MAX = 80
export const BOOKMARKS_PER_SCOPE_CAP = 50

function collapseWs(raw: string): string {
  return raw.trim().replace(/[\s\u00a0]+/g, " ")
}

export function normalizeBookmarkQuote(raw: string): string | null {
  const cleaned = collapseWs(raw)
  if (cleaned.length === 0) return null
  return Array.from(cleaned).slice(0, BOOKMARK_QUOTE_MAX).join("")
}

export function normalizeBookmarkNote(raw: string): string {
  const cleaned = collapseWs(raw)
  return Array.from(cleaned).slice(0, BOOKMARK_NOTE_MAX).join("")
}

export function findQuoteIndex(haystack: string, quote: string): number {
  if (!quote) return -1
  return haystack.indexOf(quote)
}
```

`packages/core/package.json` 的 `exports` 增加：

```json
"./bookmarks": "./src/bookmarks.ts"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/core && bun test src/bookmarks.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bookmarks.ts packages/core/src/bookmarks.test.ts packages/core/package.json
git commit -m "feat(core): normalize bookmark quote and find first index"
```

---

### Task 2: 表、类型、Store CRUD 与级联

**Files:**
- Modify: `packages/core/src/storage/db.ts`（DDL 字符串内 `CREATE TABLE IF NOT EXISTS bookmarks`）
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/store.ts`
- Create: `packages/core/src/storage/bookmarks.test.ts`
- Modify: `packages/core/src/storage/store.test.ts`（表名列表插入 `"bookmarks"`，字母序在 `archive_posts` 与 `character_clusters` 之间）

**Interfaces:**
- Consumes: Task 1 规范化函数与 `BOOKMARKS_PER_SCOPE_CAP`
- Produces:
  - `Bookmark`（字段 camelCase：`itemId`, `scrollProgress`, `createdAt`）
  - `AddBookmarkResult`
  - `Store.addBookmark` / `listItemBookmarks` / `listBookmarks` / `updateBookmarkNote` / `deleteBookmark`
  - `purgeItem` / `clearHistory` 同时删 bookmarks
  - `exportBackup().version === 3` 且含 `bookmarks`
  - `StatsInventory.bookmarks`

- [ ] **Step 1: 写失败测试**

`packages/core/src/storage/bookmarks.test.ts`（核心用例；`tempDir` 模式抄 `store.test.ts`）：

```ts
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "purifier-bm-"))
}

test("addBookmark round-trip; missing item is not_found", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1000)
  expect(
    store.addBookmark({
      site: "1",
      kind: "post",
      id: "t1",
      quote: "hello",
      scrollProgress: 0.4,
    })
  ).toEqual({ ok: false, reason: "not_found" })
  store.recordVisit("1", "post", "t1", "Title", "/read/t1")
  const added = store.addBookmark({
    site: "1",
    kind: "post",
    id: "t1",
    quote: "  hello\nworld  ",
    note: "  n  ",
    scrollProgress: 1.5,
  })
  expect(added.ok).toBe(true)
  if (!added.ok) return
  expect(added.bookmark.quote).toBe("hello world")
  expect(added.bookmark.note).toBe("n")
  expect(added.bookmark.scrollProgress).toBe(1)
  expect(added.bookmark.chapter).toBeNull()
  expect(store.listItemBookmarks("1", "post", "t1")).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})

test("cap 50 per post/chapter; book chapters are separate", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("2", "book", "X", "X", "/book/X")
  for (let i = 0; i < 50; i++) {
    const r = store.addBookmark({
      site: "2",
      kind: "book",
      id: "X",
      quote: `q${i}`,
      scrollProgress: 0,
      chapter: 1,
    })
    expect(r.ok).toBe(true)
  }
  expect(
    store.addBookmark({
      site: "2",
      kind: "book",
      id: "X",
      quote: "overflow",
      scrollProgress: 0,
      chapter: 1,
    })
  ).toEqual({ ok: false, reason: "full" })
  const ch2 = store.addBookmark({
    site: "2",
    kind: "book",
    id: "X",
    quote: "other chapter",
    scrollProgress: 0,
    chapter: 2,
  })
  expect(ch2.ok).toBe(true)
  expect(store.listItemBookmarks("2", "book", "X", 1)).toHaveLength(50)
  expect(store.listItemBookmarks("2", "book", "X", 2)).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})

test("deleteItem and clearHistory cascade bookmarks", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("1", "post", "a", "A", "/read/a")
  store.recordVisit("1", "post", "b", "B", "/read/b")
  store.addBookmark({
    site: "1",
    kind: "post",
    id: "a",
    quote: "qa",
    scrollProgress: 0,
  })
  store.addBookmark({
    site: "1",
    kind: "post",
    id: "b",
    quote: "qb",
    scrollProgress: 0,
  })
  store.deleteItem("1", "post", "a")
  expect(store.listItemBookmarks("1", "post", "a")).toHaveLength(0)
  expect(store.listItemBookmarks("1", "post", "b")).toHaveLength(1)
  store.clearHistory()
  expect(store.listBookmarks({ page: 1 }).total).toBe(0)
  rmSync(dir, { recursive: true, force: true })
})

test("listBookmarks searches quote note title; update and delete note", () => {
  const dir = tempDir()
  const store = new Store(openDatabase(dir), () => 1)
  store.recordVisit("1", "post", "t1", "Alpha", "/read/t1")
  const added = store.addBookmark({
    site: "1",
    kind: "post",
    id: "t1",
    quote: "needle quote",
    note: "memo",
    scrollProgress: 0.2,
  })
  expect(added.ok).toBe(true)
  if (!added.ok) return
  expect(store.listBookmarks({ q: "needle" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "memo" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "Alpha" }).items).toHaveLength(1)
  expect(store.listBookmarks({ q: "zzz" }).items).toHaveLength(0)
  expect(store.updateBookmarkNote(added.bookmark.id, "")).toBe(true)
  expect(store.listItemBookmarks("1", "post", "t1")[0]?.note).toBe("")
  expect(store.deleteBookmark(added.bookmark.id)).toBe(true)
  expect(store.deleteBookmark(added.bookmark.id)).toBe(false)
  rmSync(dir, { recursive: true, force: true })
})
```

在 `store.test.ts` 的 `creates items/favorites/tags/groups tables` 期望数组中、`archive_posts` 之后插入 `"bookmarks"`。

把 `exportBackup includes reading_sessions` 改为同时断言 `version === 3` 且 `Array.isArray(backup.bookmarks)`。其它 `toBe(2)` 的 export version 断言改为 `3`。

在 inventory 断言处增加 `expect(all.inventory.bookmarks).toBe(...)`：测前先 `addBookmark` 一条，或期望 0 再加一条后为 1；带 `site` 时只数该站。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/storage/bookmarks.test.ts src/storage/store.test.ts`

Expected: FAIL（无方法 / 表名数组不匹配 / version 仍为 2）

- [ ] **Step 3: DDL + 类型**

`db.ts` 的 `DDL` 增加（无 FK）：

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  item_id TEXT NOT NULL,
  chapter INTEGER,
  quote TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  scroll_progress REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_item
  ON bookmarks (site, kind, item_id, chapter, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created
  ON bookmarks (created_at DESC);
```

`types.ts`：

```ts
export interface Bookmark {
  id: number
  site: SiteId
  kind: ItemKind
  itemId: string
  title: string
  chapter: number | null
  quote: string
  note: string
  scrollProgress: number
  createdAt: number
}

export type AddBookmarkResult =
  | { ok: true; bookmark: Bookmark }
  | { ok: false; reason: "not_found" | "full" | "invalid_quote" }
```

`StatsInventory` 增加 `bookmarks: number`。

- [ ] **Step 4: Store 实现**

`store.ts` import `Bookmark`, `AddBookmarkResult`, 以及 `../bookmarks` 的三个函数和 `BOOKMARKS_PER_SCOPE_CAP`。

行映射（join `items.title`）：

```ts
private mapBookmark(row: {
  id: number
  site: string
  kind: string
  item_id: string
  title: string
  chapter: number | null
  quote: string
  note: string
  scroll_progress: number
  created_at: number
}): Bookmark {
  return {
    id: row.id,
    site: row.site,
    kind: row.kind as ItemKind,
    itemId: row.item_id,
    title: row.title,
    chapter: row.chapter,
    quote: row.quote,
    note: row.note,
    scrollProgress: row.scroll_progress,
    createdAt: row.created_at,
  }
}
```

`addBookmark`：item 不存在 → `not_found`；`normalizeBookmarkQuote` 为 null → `invalid_quote`；count（`site+kind+item_id` 且 `chapter IS ?`，`chapter` 用 `input.chapter ?? null`）≥ 50 → `full`；`scrollProgress` clamp `[0,1]`；insert 后 SELECT join 返回。

`listItemBookmarks(site, kind, id, chapter?: number | null)`：`WHERE site=? AND kind=? AND item_id=? AND chapter IS ?`，`ORDER BY created_at DESC`。`chapter` 默认 `null`。

`listBookmarks(query: { q?: string; kind?: string; page?: number })`：跨站。`q` 匹配 `quote` / `note` / `items.title`（NOCASE LIKE）。`kind` 可选。分页 `PAGE_SIZE`，`SELECT COUNT` 得 `total`，多取 1 行算 `nextPage`（抄 `runList` 的 hasMore 模式）。

`updateBookmarkNote(id, note)`：`normalizeBookmarkNote` 后 UPDATE；`changes===0` → false。

`deleteBookmark(id)`：同。

`purgeItem`：在删 favorites/tags **之前或同时**增加：

```ts
this.db
  .query(
    "DELETE FROM bookmarks WHERE site = ?1 AND kind = ?2 AND item_id = ?3"
  )
  .run(site, kind, id)
```

`clearHistory`：在删 tags 前：

```ts
this.db
  .query("DELETE FROM bookmarks WHERE ?1 IS NULL OR site = ?1")
  .run(site ?? null)
```

`getStats` inventory：`bookmarks: countSite("bookmarks")`。

`exportBackup`：返回类型 `version: 3`，增加

```ts
bookmarks: Bookmark[]
```

实现：`SELECT b.*, i.title FROM bookmarks b JOIN items i ON ... ORDER BY b.id`，再 `mapBookmark`。字面量 `version: 3`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/core && bun test src/storage/bookmarks.test.ts src/storage/store.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/types.ts packages/core/src/storage/store.ts packages/core/src/storage/bookmarks.test.ts packages/core/src/storage/store.test.ts
git commit -m "feat(storage): bookmarks table CRUD cascade export and inventory"
```

---

### Task 3: API `/api/me/bookmarks`

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: Task 2 store 方法
- Produces: GET 分流；POST/PATCH/DELETE；`/api/me/bookmarks/:id`

- [ ] **Step 1: 在 `route()` 里、`/api/me/groups` 前缀分支之后、`switch` 之前增加 bookmarks 子资源**

```ts
const bookmarkOne = pathname.match(/^\/api\/me\/bookmarks\/(\d+)$/)
if (bookmarkOne) {
  const id = Number(bookmarkOne[1])
  if (req.method === "PATCH") return await handleBookmarkPatch(req, id)
  if (req.method === "DELETE") return handleBookmarkDelete(id)
  throw new ExtractorError("method not allowed", 405)
}
```

`switch` 增加：

```ts
case "/api/me/bookmarks": {
  if (req.method === "GET") return handleBookmarksGet(url)
  if (req.method === "POST") return await handleBookmarkPost(req)
  throw new ExtractorError("method not allowed", 405)
}
```

- [ ] **Step 2: GET 分流**

```ts
function handleBookmarksGet(url: URL): Response {
  const kind = url.searchParams.get("kind")
  const id = url.searchParams.get("id")
  const hasKind = kind !== null && kind !== ""
  const hasId = id !== null && id !== ""
  if (hasKind !== hasId) {
    return jsonError("kind and id must be provided together", 400)
  }
  if (hasKind && hasId) {
    if (kind !== "post" && kind !== "book") {
      return jsonError("invalid kind", 400)
    }
    const site = url.searchParams.get("site") ?? "1"
    const chapterRaw = url.searchParams.get("chapter")
    let chapter: number | null = null
    if (chapterRaw !== null && chapterRaw !== "") {
      const n = Number(chapterRaw)
      if (!Number.isFinite(n)) return jsonError("invalid chapter", 400)
      chapter = n
    }
    const items = store.listItemBookmarks(site, kind, id, chapter)
    return jsonOk({ items }, NO_STORE_HEADERS)
  }
  const q = url.searchParams.get("q") ?? ""
  const listKind = url.searchParams.get("kind") ?? ""
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1)
  if (listKind && listKind !== "post" && listKind !== "book") {
    return jsonError("invalid kind", 400)
  }
  return jsonOk(
    store.listBookmarks({
      q,
      kind: listKind || undefined,
      page,
    }),
    NO_STORE_HEADERS
  )
}
```

注意：当前篇 GET 的 `site` 默认 `"1"`（阅读页总会带当前站；省略则论坛）。全局列表**不**读 `site`。

- [ ] **Step 3: POST / PATCH / DELETE**

POST body：`kind`, `id`, `quote`（string）, `site?`, `chapter?`, `note?`, `scrollProgress`。

- `kind` 非 post/book → 400
- `id` 非 `/^[A-Za-z0-9]+$/` → 400（与 progress 相同）
- `quote` 非 string → 400
- `scrollProgress` 非有限数字 → 400
- `chapter` 若出现须为有限数字
- `note` 若出现须为 string
- `addBookmark`：`not_found` → 404 `item not found`；`full` → 409 `bookmark limit reached`；`invalid_quote` → 400 `invalid quote`
- 成功 `{ ok: true, bookmark }`

PATCH body `{ note }`（必须是 string，含 `""`）：`updateBookmarkNote` false → 404。

DELETE：`deleteBookmark` false → 404；成功 `{ ok: true, removed: 1 }`。

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): me bookmarks list create patch delete"
```

---

### Task 4: 路由、Me Tab、path helpers

**Files:**
- Modify: `apps/web/src/lib/routes.ts`
- Modify: `apps/web/src/lib/hub-tabs.ts`
- Modify: `apps/web/src/App.tsx`（先挂一个空页也可，但本任务只加 lazy 路由的话需要页面文件——把空壳 `BookmarksPage` 放本任务）
- Create: `apps/web/src/pages/BookmarksPage.tsx`（先占位标题「书签」，Task 8 填列表）

**Interfaces:**
- Consumes: 无
- Produces: `routes.bookmarks = "/bookmarks"`；`api.meBookmarks`；`readPath(tid, site?, bm?)`；`bookPath(..., { bm? })`；`useMeTabs` 的 `to` 为裸 `t.href`

- [ ] **Step 1: `routes.ts`**

`routes` 增加 `bookmarks: "/bookmarks"`。

`ME_TABS` 增加 `{ href: routes.bookmarks, label: "书签", sites: ["1", "2"] }`。

`api` 增加 `meBookmarks: "/api/me/bookmarks"`。

`NAV_ITEMS`「我的」match 增加 `p === routes.bookmarks`。

```ts
export function readPath(tid: string, site?: SiteId, bm?: string): string {
  const p = new URLSearchParams()
  withSite(p, site)
  if (bm) p.set("bm", bm)
  const qs = p.toString()
  return `/read/${encodeURIComponent(tid)}${qs ? `?${qs}` : ""}`
}

export function bookPath(
  cid: string,
  opts?: { site?: SiteId; chapter?: string; bm?: string }
): string {
  const p = new URLSearchParams()
  withSite(p, opts?.site)
  if (opts?.chapter) p.set("chapter", opts.chapter)
  if (opts?.bm) p.set("bm", opts.bm)
  const qs = p.toString()
  return `/book/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`
}
```

- [ ] **Step 2: `useMeTabs` 去掉 `siteUrl`**

```ts
export function useMeTabs(activePath: string): SectionTab[] {
  return useMemo(() => {
    return ME_TABS.map((t) => ({
      to: t.href,
      label: t.label,
      active:
        activePath === t.href ||
        (t.href === "/tags" && activePath.startsWith("/tags")),
    }))
  }, [activePath])
}
```

不再 `useSite`、不再 `filter`（四个 Tab 都是双站）。

- [ ] **Step 3: App 路由 + 占位页**

`BookmarksPage.tsx` 暂：

```tsx
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { useMeTabs } from "@/lib/hub-tabs"
import { useLocation } from "react-router-dom"

export default function BookmarksPage() {
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  return (
    <PageShell>
      <PageHeader title="书签" description="正文里钉下的摘录" />
      <SectionTabs items={sectionTabs} />
      <p className="text-sm text-muted-foreground">暂无书签</p>
    </PageShell>
  )
}
```

`App.tsx` lazy import，在 `/tags` 路由旁加 `/bookmarks`。

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/routes.ts apps/web/src/lib/hub-tabs.ts apps/web/src/App.tsx apps/web/src/pages/BookmarksPage.tsx
git commit -m "feat(web): bookmarks route and site-free me tabs"
```

---

### Task 5: `syncFromViewport`

**Files:**
- Modify: `apps/web/src/hooks/use-reading-progress.ts`

**Interfaces:**
- Consumes: 现有 `computeProgress`
- Produces: `return { progress, syncFromViewport }`

- [ ] **Step 1: 把 `computeProgress` 保持文件顶层；hook 内增加**

```ts
const syncFromViewport = () => {
  const p = computeProgress()
  setProgress(p ?? 0)
}

return { progress, syncFromViewport }
```

不要在 `syncFromViewport` 里调 `flush` / 写 `api.meProgress`。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`

Expected: PASS（ReadPage/BookPage 仍只解构 `progress`，多返回字段无妨）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-reading-progress.ts
git commit -m "feat(web): sync reading progress bar from viewport without write"
```

---

### Task 6: 选区浮条改名并加书签动作

**Files:**
- Create: `apps/web/src/components/reading-selection-toolbar.tsx`（`git mv` 旧文件后改）
- Delete: `apps/web/src/components/character-selection-toolbar.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`、`BookPage.tsx`（本任务只改 import/组件名与新 props；真正 `onBookmark` 可先 `() => {}`，Task 7 接上）

**Interfaces:**
- Consumes: 现有人物 `clusters` / `onAdd` / `onRemove`
- Produces: `ReadingSelectionToolbar` props：`onBookmark: (quote: string) => void` 另加人物回调

- [ ] **Step 1: `git mv` 后改组件**

选区逻辑：

- 不再用 `normalizeCharacterName` 决定是否显示浮条。
- 选区非折叠、落在 `.reading-body` 即 `setAnchor({ quote: selection.toString(), rect })`。
- 第一行两个按钮：「书签」「人物」（或「取消标记」若 `normalizeCharacterName(quote)` 已在某 cluster）。
- 点「书签」：`const q = normalizeBookmarkQuote(anchor.quote)`；若 null 则不关闭或可忽略；否则 `onBookmark(q)` 并关浮条。本任务 `onBookmark` 可先空实现。
- 点「人物」：`const name = normalizeCharacterName(anchor.quote)`；若 null，浮条内显示一行 `text-xs text-destructive`「不能作为人名」，**不** `setAnchor(null)`。
- 挂靠列表仅在人物名合法且尚未标记时显示（保持现有）。
- `onMouseDown preventDefault` 避免点按钮清选区。
- Esc / 滚动 / 点空白关闭不变。

`from "@workspace/core/bookmarks"` 与 `from "@workspace/core/character-highlight"`。

- [ ] **Step 2: ReadPage / BookPage 把 `CharacterSelectionToolbar` 换成 `ReadingSelectionToolbar`，`onBookmark={() => {}}`。**

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/reading-selection-toolbar.tsx apps/web/src/components/character-selection-toolbar.tsx apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): reading selection toolbar with bookmark and character"
```

---

### Task 7: 篇内书签、DOM 定位、阅读页接线

**Files:**
- Create: `apps/web/src/lib/bookmark-locate.ts`
- Create: `apps/web/src/hooks/use-bookmarks.ts`
- Create: `apps/web/src/components/bookmark-list.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`
- Modify: `apps/web/src/pages/BookPage.tsx`

**Interfaces:**
- Consumes: `findQuoteIndex`、`api.meBookmarks`、`Bookmark` 形状、`syncFromViewport`、Task 6 `onBookmark`
- Produces: 篇内 CRUD + `?bm=` 定位

- [ ] **Step 1: `bookmark-locate.ts`**

```ts
import { findQuoteIndex } from "@workspace/core/bookmarks"

function rangeFromOffset(
  root: Element,
  start: number,
  length: number
): Range | null {
  const end = start + length
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.data.length
    const next = pos + len
    if (!startNode && next > start) {
      startNode = node
      startOff = start - pos
    }
    if (!endNode && next >= end) {
      endNode = node
      endOff = end - pos
      break
    }
    pos = next
    node = walker.nextNode() as Text | null
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOff)
  range.setEnd(endNode, endOff)
  return range
}

export function scrollToQuote(root: Element, quote: string): boolean {
  const haystack = root.textContent ?? ""
  const idx = findQuoteIndex(haystack, quote)
  if (idx < 0) return false
  const range = rangeFromOffset(root, idx, quote.length)
  if (!range) return false
  const el =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  el?.scrollIntoView({ block: "center" })
  return true
}

export function scrollToProgress(progress: number): void {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return
  window.scrollTo(0, Math.round(Math.max(0, Math.min(1, progress)) * max))
}
```

- [ ] **Step 2: `use-bookmarks.ts`**

参数 `{ site, kind, id, chapter?: number, enabled: boolean }`。

- `enabled` 为 false 时不请求（书库目录页）。
- GET `${api.meBookmarks}?kind=&id=&site=`，有 `chapter` 再加。
- `add({ quote, note, scrollProgress })` POST；409/400 把 error 抛出。
- `updateNote(id, note)` PATCH `${api.meBookmarks}/${id}`
- `remove(id)` DELETE
- 返回 `{ items, loading, error, reload, add, updateNote, remove }`

`chapter` 仅在 xbookcn 章传入；cool18 / 帖不传。

- [ ] **Step 3: `bookmark-list.tsx`**

列表：摘录、备注、`formatDateTime(createdAt)`；stale 显示「原文可能已变」。

每条：点击 → `onJump(item)`；改备注（小输入 + 保存）；删除。

空列表不渲染整块，或一行「还没有书签」。

- [ ] **Step 4: 阅读页**

`useSearchParams` 读 `bm`。

`useBookmarks`：`enabled` = 内容已挂载（ReadPage：`loadedTid===tid`；BookPage：`isChapterBody || isCool18Book` 且 loadedKey 匹配）。

`useReadingProgress`：

```ts
const bmParam = searchParams.get("bm")
const target = bmParam
  ? items.find((b) => String(b.id) === bmParam)
  : undefined
const bookmarksReady = !bmParam || !bookmarksLoading
const skipRestore = Boolean(bmParam && target)
```

`ready` 在原条件上：若有 `bmParam` 则还要 `bookmarksReady`。

`restore`: `skipRestore ? null : (原 restore)`。

`onBookmark(quote)`：弹出备注（可用 `window.prompt("备注（可空）")` **不要**；用浮条展开的备注 input，或列表上方一个小 form）。推荐：点书签后浮条切到「摘录只读 + note input + 保存」，保存时：

```ts
const p = document.documentElement.scrollHeight - window.innerHeight
const scrollProgress = p <= 0 ? 0 : window.scrollY / p
await add({ quote, note, scrollProgress })
```

409 把错误写到 `mutationError`：「该书签已满（50），请先删除旧的」。

**定位 effect**（独立于进度 hook）：`content ready && bookmarksReady && target` 时决策一次（ref 按 `bm+id+chapter`）。双 rAF 后：

```ts
const root = document.querySelector(".reading-body")
const hit = root instanceof Element && scrollToQuote(root, target.quote)
if (!hit) {
  scrollToProgress(target.scrollProgress)
  setStaleId(target.id)
}
syncFromViewport()
```

无效 `bm`（ready 且找不到）：不 locate，不 skip restore。

BookPage：`isToc` 不挂书签 hook / 浮条 `onBookmark` 无效。`chapter: isChapterBody ? Number(chapter) : undefined`。

篇内 `BookmarkList` 放在 `ArticleView` 附近（标题下或侧栏）；`staleId` 传入。

cool18 `onBookmark` 不要传 `chapter`；xbookcn 章传 `Number(chapter)`。

- [ ] **Step 5: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/bookmark-locate.ts apps/web/src/hooks/use-bookmarks.ts apps/web/src/components/bookmark-list.tsx apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx apps/web/src/components/reading-selection-toolbar.tsx
git commit -m "feat(web): in-article bookmarks and quote locate"
```

---

### Task 8: 「我的」书签页

**Files:**
- Modify: `apps/web/src/pages/BookmarksPage.tsx`
- Modify: `apps/web/src/pages/HistoryPage.tsx`（清空说明带书签）

**Interfaces:**
- Consumes: `api.meBookmarks`、`readPath`/`bookPath` 的 `bm`、`SITES`、`ME_PAGE_SIZE`

- [ ] **Step 1: 独立列表页（不要 `MeListPage`）**

模式对齐 `MeListPage` 的 fetch / pager / SearchForm / SectionTabs，但卡片自定义：

- 主文案：`item.quote`（`line-clamp-3`）
- 次行：`note`（若有）、`title`、`SITES[item.site]?.label ?? item.site`、有 `chapter` 则 `第 n 章`、`formatDateTime(createdAt)`
- `Link`：`kind==="post" ? readPath(itemId, site, String(id)) : bookPath(itemId, { site, chapter: chapter != null ? String(chapter) : undefined, bm: String(id) })`
- 删除按钮：`DELETE /api/me/bookmarks/:id`
- `buildUrl`: `${api.meBookmarks}?${meListQuery({ q, kind, page })}`（不要 site）
- 空文案：「还没有书签，阅读时选中正文即可添加」
- 搜索 placeholder：「搜索摘录、备注或标题…」

- [ ] **Step 2: History 清空文案**

`相关收藏与标签也会一并移除。` → `相关收藏、标签与书签也会一并移除。`

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/BookmarksPage.tsx apps/web/src/pages/HistoryPage.tsx
git commit -m "feat(web): me bookmarks page with excerpt cards"
```

---

### Task 9: 统计页、AGENTS.md、全量验证

**Files:**
- Modify: `apps/web/src/pages/StatsPage.tsx`
- Modify: `AGENTS.md`
- Modify: spec 状态行（可选）`待写实施计划` → `计划见 docs/superpowers/plans/2026-08-13-bookmarks.md`

**Interfaces:**
- Consumes: `inventory.bookmarks`

- [ ] **Step 1: StatsPage**

本地 `inventory` 类型加 `bookmarks: number`。库存区加 `<StatCard value={String(data.inventory.bookmarks)} label="书签" />`。`grid-cols-2 ... sm:grid-cols-5` 改为 `sm:grid-cols-3 lg:grid-cols-6`。

- [ ] **Step 2: AGENTS.md**

常用命令表下 API 表增加：

```
| `GET /api/me/bookmarks` | `kind`+`id`（书可加 `chapter`）或 `q`/`kind`/`page` | 当前篇不分页 `{ items }`；否则跨站分页 `{ items, nextPage?, total }` |
| `POST /api/me/bookmarks` | body `{ kind, id, quote, site?, chapter?, note?, scrollProgress }` | `{ ok, bookmark }`；无 item 404、满 50 条 409 |
| `PATCH /api/me/bookmarks/:id` | body `{ note }` | 改备注 |
| `DELETE /api/me/bookmarks/:id` | 无 | `{ ok, removed }` |
```

`GET /api/me/export` 行改为 version 3，列表加上 `bookmarks`。

`GET /api/me/stats` 注明 `inventory` 含 `bookmarks`。

目录关键文件可加书签 store/API 一句。

前端路由表加 `Bookmarks | /bookmarks`。

- [ ] **Step 3: 全量验证**

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/StatsPage.tsx AGENTS.md docs/superpowers/specs/2026-08-13-bookmarks-design.md
git commit -m "docs: bookmarks API in AGENTS and stats inventory card"
```

（若 spec 状态未改则不要 add spec。）

---

## Spec coverage

| Spec | Task |
| --- | --- |
| 独立表、无 FK、级联 | 2 |
| quote/note 规范、上限 50 | 1–2 |
| GET 分流、无 limit、跨站列表 | 3 |
| POST/PATCH/DELETE 状态码 | 3 |
| export v3 + inventory | 2、9 |
| Me 功能优先、NAV 高亮 | 4 |
| readPath/bookPath `bm` | 4、8 |
| 浮条书签\|人物 | 6 |
| 篇内列表 + 定位 + skip restore + syncFromViewport | 5、7 |
| 我的书签页自定义卡片 | 8 |
| 统计卡片、AGENTS | 9 |
| cool18 无 chapter | Global + 3、7 |

## Type names (locked)

- `Bookmark`, `AddBookmarkResult`, `reason: "not_found" \| "full" \| "invalid_quote"`
- Store: `addBookmark`, `listItemBookmarks`, `listBookmarks`, `updateBookmarkNote`, `deleteBookmark`
- Hook: `useBookmarks`, `syncFromViewport`
- UI: `ReadingSelectionToolbar`, `BookmarkList`
- Locate: `scrollToQuote`, `scrollToProgress`
