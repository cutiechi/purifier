# xbookcn.org 上游站点支持 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Purifier 增加第二个上游 xbookcn.org（书籍/章节模型），并通过 `site` 数字 id 参数贯穿前后端，使"加站点"成为纯增量操作。

**Architecture:** 一套路由结构，`site` 参数（`1`=cool18 默认、`2`=xbookcn）贯穿 API 与前端，`resolveSite(id)` 在底层分流到 extractor。数据层 `items`/`favorites`/`tags` 三表加 `site` 列 + `last_chapter`，PK 改为 `(site, kind, id)`。xbookcn 实现 Extractor 子集，不支持的能力抛 404，前端按 site 动态隐藏入口。

**Tech Stack:** Bun（API + 测试）、TypeScript strict、React 19 + React Router 7、Tailwind CSS 4、Cheerio（HTML 解析）、SQLite（bun:sqlite）。

**参考 spec:** `docs/superpowers/specs/2026-08-06-xbookcn-support-design.md`（所有设计决策的权威来源）。

## Global Constraints

- 代码风格：Prettier —— 无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 跨包导入用 `@workspace/core`；前端用 `@/` 别名。
- API 只用 `Bun.serve`，不引入 HTTP 框架。
- 上游解析统一走 `Extractor` 接口，不在 API 或前端直接解析 HTML。
- 正文清洗只保留站内链接，外链剥离只留文字。
- 每个任务结束验证：`bun run test`（改动相关测试）、`bun run typecheck`。
- 缓存 key 的各段（site/cid/chapter）必须分别过 `assertSafeId`（仅 `[A-Za-z0-9]+`，cid base64 无 padding 实测符合）。

---

## File Structure

**新建：**
- `packages/core/src/extractor/utils.ts` — 共享清洗工具（`stripTags`/`escapeHtml`/`decodeHtmlEntities`），从 `extractor.ts` 私有方法抽出。
- `packages/core/src/extractor/xbookcn.ts` — `XbookcnExtractor`。
- `packages/core/src/extractor/sites.ts` — 站点注册表 + `resolveSite`。
- `packages/core/src/extractor/fixtures/xbookcn/*.html` — 测试 fixtures（裁剪最小 HTML）。
- `apps/web/src/hooks/use-site.ts` — `useSite()`。
- `apps/web/src/components/site-switcher.tsx` — 顶部站点切换。

**修改：**
- `packages/core/src/extractor/types.ts` — `BookContentResponse` 扩展、`Extractor.fetchHotHtml`、`extractBookContent` opts。
- `packages/core/src/extractor/extractor.ts` — Cool18 适配新签名 + 复用 utils + `fetchHotHtml`。
- `packages/core/src/extractor/index.ts` — 重导出 + `getExtractor` 转发。
- `packages/core/src/storage/db.ts` — site 列 + last_chapter + 重建 PK 迁移。
- `packages/core/src/storage/store.ts` — 全方法加 site；`setProgress` 加 chapter；`getState` 返回 lastChapter。
- `packages/core/src/storage/types.ts` — `ListItem.site`/`lastChapter`、`ItemState.lastChapter`、`ListQuery.site`。
- `packages/core/src/storage/cache.ts` — 分层 key（site + chapter）。
- `apps/api/src/index.ts` — site 贯穿、books chapter、trending fetchHotHtml、posts 短路、me 透传。
- `apps/web/src/lib/routes.ts` — site 类型/路径函数/NAV_ITEMS.sites。
- `apps/web/src/App.tsx` — 路由（路径结构不变，确认）。
- `apps/web/src/pages/BookPage.tsx` — 目录/章节二态。
- `apps/web/src/pages/HomePage.tsx` 等 — site 透传。
- `apps/web/src/components/site-header.tsx` — NAV 按 site 过滤。
- `apps/web/src/components/item-actions.tsx` — me 调用带 site、`ItemState.lastChapter`。
- `apps/web/src/hooks/use-reading-progress.ts` — 接收 chapter、章号匹配才 restore。

---

## Task 1: 抽出共享清洗工具 utils.ts

把 `Cool18Extractor` 的 `stripTags`/`escapeHtml`/`decodeHtmlEntities` 三个私有方法抽成 `extractor/utils.ts` 的导出函数，Cool18 改为复用。这是后续 xbookcn 清洗的前置依赖。

**Files:**
- Create: `packages/core/src/extractor/utils.ts`
- Modify: `packages/core/src/extractor/extractor.ts:819-876`（删私有方法，改用 import）
- Test: `packages/core/src/extractor/utils.test.ts`

**Interfaces:**
- Produces: `stripTags(s: string): string`、`escapeHtml(s: string): string`、`decodeHtmlEntities(s: string): string`（行为与原 Cool18 私有方法完全一致）。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/extractor/utils.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { decodeHtmlEntities, escapeHtml, stripTags } from "./utils"

describe("stripTags", () => {
  test("removes tags, keeps text", () => {
    expect(stripTags("<a href=x>hello</a>")).toBe("hello")
    expect(stripTags("a<b>c</b>d")).toBe("acd")
    expect(stripTags("no tags")).toBe("no tags")
  })
})

describe("escapeHtml", () => {
  test("escapes & < > \"", () => {
    expect(escapeHtml(`a & <b> "q"`)).toBe(`a &amp; &lt;b&gt; &quot;q&quot;`)
  })
})

describe("decodeHtmlEntities", () => {
  test("named entities", () => {
    expect(decodeHtmlEntities("&lt;&gt;&amp;&quot;")).toBe(`<>&"`)
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b")
  })
  test("numeric entities", () => {
    expect(decodeHtmlEntities("&#65;")).toBe("A")
    expect(decodeHtmlEntities("&#x41;")).toBe("A")
  })
  test("leaves unknown entities", () => {
    expect(decodeHtmlEntities("&copy;")).toBe("&copy;")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test packages/core/src/extractor/utils.test.ts`
Expected: FAIL —— 找不到 `./utils` 模块。

- [ ] **Step 3: 创建 utils.ts**

创建 `packages/core/src/extractor/utils.ts`，函数体从 `extractor.ts:819-876` 的私有方法原样搬迁（`this.stripTags` → `stripTags`，去掉 `private`）：

```ts
export function stripTags(s: string): string {
  let result = ""
  let inTag = false
  for (const ch of s) {
    if (ch === "<") {
      inTag = true
    } else if (ch === ">") {
      inTag = false
    } else if (!inTag) {
      result += ch
    }
  }
  return result
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function decodeHtmlEntities(s: string): string {
  const namedEntities: Record<string, string> = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#x3000;": "\u3000",
    "&#12288;": "\u3000",
  }
  for (const [entity, ch] of Object.entries(namedEntities)) {
    s = s.split(entity).join(ch)
  }
  s = s.replace(/&#(\d+);/g, (_match, num) => {
    const code = parseInt(num, 10)
    if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code)
    }
    return _match
  })
  s = s.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
    const code = parseInt(hex, 16)
    if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code)
    }
    return _match
  })
  return s
}
```

- [ ] **Step 4: 让 Cool18 复用 utils**

在 `extractor.ts` 顶部 import：
```ts
import { escapeHtml, stripTags, decodeHtmlEntities } from "./utils"
```

删除 `extractor.ts:819-876` 的三个私有方法（`private stripTags`/`private escapeHtml`/`private decodeHtmlEntities`）。把文件内所有 `this.stripTags(` → `stripTags(`、`this.escapeHtml(` → `escapeHtml(`、`this.decodeHtmlEntities(` → `decodeHtmlEntities(`（全局替换，约 7 处，集中在 `extractPreHtml` 及其链接处理段）。

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `bun test packages/core/src/extractor/` && `bun run typecheck`
Expected: utils 测试 PASS；现有 extractor 测试仍 PASS（行为不变）；类型无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/extractor/utils.ts packages/core/src/extractor/utils.test.ts packages/core/src/extractor/extractor.ts
git commit -m "refactor(core): extract sanitization utils from Cool18Extractor"
```

---

## Task 2: 扩展 Extractor 类型（BookContentResponse + fetchHotHtml + extractBookContent opts）

为 xbookcn 的目录/章节二态、书名策略、热榜来源加类型。Cool18 适配新签名（opts 忽略），现有行为不变。

**Files:**
- Modify: `packages/core/src/extractor/types.ts:51-64`（`BookContentResponse`）、`110-134`（`Extractor` 接口）
- Modify: `packages/core/src/extractor/extractor.ts:113-166`（Cool18 `extractBookContent` + 加 `fetchHotHtml`）

**Interfaces:**
- Produces: `BookContentResponse`（含 `intro?`/`chapters?`/`singleShot?`/`related?`/`bookTitle?`/`chapterIndex?`/`prevChapter?`/`nextChapter?`）、`Extractor.fetchHotHtml(): Promise<string>`、`Extractor.extractBookContent(html, opts?: {chapter?})`。

- [ ] **Step 1: 扩展 BookContentResponse**

在 `types.ts` 把当前内联返回类型（行 60-64）改为具名 interface + 可选字段：

```ts
export interface BookContentResponse {
  title: string
  content: string
  meta: BookMeta
  // —— xbookcn 扩展（可选，cool18 不填，行为不变）——
  intro?: string
  chapters?: ChapterLink[]
  singleShot?: boolean
  related?: ChapterLink[]
  /** 章节正文页的书名（recordVisit 书名策略用）；目录页不需填 */
  bookTitle?: string
  chapterIndex?: number
  prevChapter?: number
  nextChapter?: number
}
```

- [ ] **Step 2: 扩展 Extractor 接口**

在 `types.ts` 的 `Extractor` 接口里：
- `extractBookContent` 签名改为：
  ```ts
  extractBookContent(
    html: string,
    opts?: { chapter?: string }
  ): BookContentResponse
  ```
- 新增成员：
  ```ts
  /** 热榜 HTML 来源（handleTrending 统一调用） */
  fetchHotHtml(): Promise<string>
  /** 章节 URL（xbookcn 用；cool18 不实现即 undefined，API 层可选链调用） */
  buildChapterUrl?(cid: string, chapter: string | number): string
  ```
  cool18 不实现 `buildChapterUrl`（接口可选，无该方法）；xbookcn 在 Task 6 实现。API 层 Task 7 用 `extractor.buildChapterUrl?.(cid, chapter)`——cool18 走 `buildBookUrl`（无 chapter），xbookcn 走 `buildChapterUrl`。

- [ ] **Step 3: Cool18 适配新签名 + 实现 fetchHotHtml**

在 `extractor.ts`：
- `extractBookContent` 方法签名加第二参 `opts?: { chapter?: string }`（函数体忽略 opts），返回值不变。
- 新增方法（放在类内 `extractHotPosts` 附近）：
  ```ts
  async fetchHotHtml(): Promise<string> {
    const resp = await fetchUpstream(`${this.homeUrl}?app=forum&act=hot`)
    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }
    return resp.text()
  }
  ```
  （`fetchUpstream` 与 `ExtractorError` 已在 extractor.ts 顶部 import。）

- [ ] **Step 4: 运行类型检查 + 现有测试**

Run: `bun run typecheck` && `bun test packages/core/src/extractor/extractor.test.ts`
Expected: 类型无错；extractor 现有测试仍 PASS（opts 被忽略，行为不变）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/extractor/types.ts packages/core/src/extractor/extractor.ts
git commit -m "feat(core): extend Extractor types for multi-site books + hot html"
```

---

## Task 3: 站点注册表 sites.ts + getExtractor 改用 id

把"按 name 取"改成"按 site id 取"，建立可扩展的站点注册表。

**Files:**
- Create: `packages/core/src/extractor/sites.ts`
- Modify: `packages/core/src/extractor/index.ts`

**Interfaces:**
- Produces: `SiteId = string`、`SITES`、`DEFAULT_SITE = "1"`、`resolveSite(id?: string): Extractor`、`isValidSite(id?: string): boolean`。
- 注意：此时 `XbookcnExtractor` 尚未实现（Task 4-6）。本任务先注册 cool18，xbookcn 的注册在 Task 6 补。为让类型能通过，Task 6 前的 `SITES` 只含 `"1"`。

- [ ] **Step 1: 写 sites 测试**

创建 `packages/core/src/extractor/sites.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { DEFAULT_SITE, isValidSite, resolveSite } from "./sites"

describe("resolveSite", () => {
  test("default site is cool18", () => {
    const e = resolveSite()
    expect(e.name).toBe("cool18")
    expect(resolveSite(DEFAULT_SITE).name).toBe("cool18")
  })
  test("unknown id throws 400", () => {
    expect(() => resolveSite("99")).toThrow(/unknown site/)
  })
})

describe("isValidSite", () => {
  test("undefined / known id is valid", () => {
    expect(isValidSite(undefined)).toBe(true)
    expect(isValidSite("1")).toBe(true)
  })
  test("unknown id is invalid", () => {
    expect(isValidSite("99")).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test packages/core/src/extractor/sites.test.ts`
Expected: FAIL —— 找不到 `./sites`。

- [ ] **Step 3: 创建 sites.ts（仅 cool18）**

创建 `packages/core/src/extractor/sites.ts`：

```ts
import { Cool18Extractor } from "./extractor"
import { Extractor, ExtractorError } from "./types"

export type SiteId = string

interface SiteEntry {
  name: string
  getExtractor: () => Extractor
}

// 新增站点 = 在此加一行 + 实现 Extractor。
export const SITES: Record<SiteId, SiteEntry> = {
  "1": { name: "cool18", getExtractor: () => new Cool18Extractor() },
}

export const DEFAULT_SITE: SiteId = "1"

export function resolveSite(id?: string): Extractor {
  const entry = SITES[id ?? DEFAULT_SITE]
  if (!entry) throw new ExtractorError(`unknown site: ${id ?? "(empty)"}`, 400)
  return entry.getExtractor()
}

export function isValidSite(id?: string): boolean {
  return !id || id in SITES
}
```

- [ ] **Step 4: 改 index.ts，getExtractor 转发 resolveSite**

把 `packages/core/src/extractor/index.ts` 改为：

```ts
import { Cool18Extractor } from "./extractor"
import { Extractor } from "./types"

export * from "./types"
export { Cool18Extractor } from "./extractor"
export {
  SITES,
  DEFAULT_SITE,
  resolveSite,
  isValidSite,
  type SiteId,
} from "./sites"

/** @deprecated 用 resolveSite(id)。保留以兼容；内部转发。 */
export function getExtractor(id?: string): Extractor {
  return resolveSite(id)
}
```

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `bun test packages/core/src/extractor/sites.test.ts` && `bun run typecheck`
Expected: sites 测试 PASS；类型无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/extractor/sites.ts packages/core/src/extractor/sites.test.ts packages/core/src/extractor/index.ts
git commit -m "feat(core): add site registry, getExtractor takes site id"
```

---

## Task 4: 数据层加 site 列 + last_chapter + 重建 PK

三表加 `site` 列、`items` 加 `last_chapter`、迁移重建 PK 为 `(site, kind, id)`。store 全方法加 site 参数。这是最大的单一任务，因为 store.ts 几乎每个方法都要改签名。

**Files:**
- Modify: `packages/core/src/storage/db.ts`
- Modify: `packages/core/src/storage/store.ts`（全方法）
- Modify: `packages/core/src/storage/types.ts`
- Test: `packages/core/src/storage/store.test.ts`（扩展）

**Interfaces:**
- Consumes: `SiteId` from Task 3.
- Produces:
  - `store.recordVisit(site, kind, id, title, url)`、`store.setProgress(site, kind, id, progress, chapter?)`（chapter 给定写 `last_chapter`）、`store.getState(site, kind, id)`（返回含 `lastChapter`）、其余方法首参加 `site`。
  - `ListItem.site`、`ListItem.lastChapter?`、`ItemState.lastChapter`、`ListQuery.site?`。

- [ ] **Step 1: 先改 db.ts DDL + 迁移**

在 `db.ts` 把 DDL 三表都加 `site TEXT NOT NULL DEFAULT '1'` 列，PK 改为 `(site, kind, id)`。在 `openDatabase` 末尾加重建迁移（检测 site 列是否存在；不存在则建新表+迁数据+换名）。`items_new` 含 `last_chapter INTEGER`：

```ts
// 迁移：旧库无 site 列 → 重建三表（ADD COLUMN 改不了 PK）
const cols = db.query("PRAGMA table_info(items)").all() as { name: string }[]
if (!cols.some((c) => c.name === "site")) {
  for (const { table, sql } of [
    {
      table: "items",
      sql: `CREATE TABLE items_new (
        kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
        site TEXT NOT NULL DEFAULT '1',
        id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_visited_at INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1,
        read_progress REAL,
        last_chapter INTEGER,
        PRIMARY KEY (site, kind, id)
      )`,
    },
    {
      table: "favorites",
      sql: `CREATE TABLE favorites_new (
        kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
        site TEXT NOT NULL DEFAULT '1',
        id TEXT NOT NULL,
        favorited_at INTEGER NOT NULL,
        PRIMARY KEY (site, kind, id)
      )`,
    },
    {
      table: "tags",
      sql: `CREATE TABLE tags_new (
        kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
        site TEXT NOT NULL DEFAULT '1',
        id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (site, kind, id, tag)
      )`,
    },
  ]) {
    db.exec(sql)
    const cols2 = db
      .query(`PRAGMA table_info(${table})`)
      .all() as { name: string }[]
    const colList = cols2.map((c) => c.name).join(", ")
    if (table === "items") {
      db.exec(
        `INSERT INTO items_new (${colList}, last_chapter) SELECT ${colList}, NULL FROM items`
      )
    } else {
      db.exec(`INSERT INTO ${table}_new (${colList}) SELECT ${colList} FROM ${table}`)
    }
    db.exec(`DROP TABLE ${table}`)
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`)
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)")
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_visited ON items (last_visited_at DESC)")
  db.exec("CREATE INDEX IF NOT EXISTS idx_favorites_time ON favorites (favorited_at DESC)")
}
```

保留现有 `read_progress` 幂等迁移块（它检测列再 ADD，对新库无副作用；但新库 site 迁移块会先触发，新库 DDL 已含 read_progress，所以 read_progress 块对全新库是 no-op）。**注意顺序**：`read_progress` 检测要先于 site 重建，或合并——最稳妥是把两个检测都放在 `openDatabase` 里，site 重建块在前（它建的 `items_new` 已含 `read_progress` + `last_chapter`），旧库若缺 `read_progress` 时 INSERT 会因列不匹配报错。为避免：site 重建块的 `colList` 直接从旧表 PRAGMA 取，旧库若缺 `read_progress`，需先跑原 `read_progress` ADD 块补上再重建。**因此保持原顺序：先 `read_progress` ADD（若缺），再 site 重建。**

- [ ] **Step 2: 改 types.ts**

在 `types.ts`：
- `ListItem` 加 `site: string`、`lastChapter?: number | null`。
- `ItemState` 加 `site: string`、`lastChapter: number | null`。
- `ListQuery` 加 `site?: string`。

- [ ] **Step 3: 改 store.ts —— 写路径方法加 site 首参**

为下列方法首参加 `site: string`（参数顺序：site 在前）。SQL 的 `WHERE kind=? AND id=?` 改 `WHERE site=? AND kind=? AND id=?`，`ON CONFLICT(kind,id)` 改 `ON CONFLICT(site,kind,id)`：

- `recordVisit(site, kind, id, title, url)`
- `setProgress(site, kind, id, progress, chapter?)` —— 签名加 `chapter?: number`；SQL 改为同时写 `last_chapter`：
  ```ts
  setProgress(site: string, kind: ItemKind, id: string, progress: number, chapter?: number): boolean {
    // ... 检查存在 ...
    this.db
      .query(
        "UPDATE items SET read_progress = ?3, last_chapter = ?4 WHERE site = ?1 AND kind = ?2 AND id = ?3"
      )
      // 注意占位符编号要重排，见 Step 4 完整签名
    ...
  }
  ```
  见 Step 4 完整实现。
- `addFavorite(site, kind, id)`、`removeFavorite(site, kind, id)`、`deleteItem(site, kind, id)`、`setTags(site, kind, id, tags)`。
- `deleteItems(site, pairs: Array<{kind; id}>)` —— pairs 不含 site，site 作为首参。
- `clearHistory(site?)` —— 可选，不传跨站。
- `deleteTag(site?, tag)` —— 可选（全局删标签，可跨站；保持可选 site 用于按站删）。

- [ ] **Step 4: setProgress 完整实现（带 chapter）**

```ts
setProgress(
  site: string,
  kind: ItemKind,
  id: string,
  progress: number,
  chapter?: number
): boolean {
  const exists = this.db
    .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
    .get(site, kind, id)
  if (!exists) return false
  const clamped = Math.max(0, Math.min(1, progress))
  if (chapter !== undefined) {
    this.db
      .query(
        "UPDATE items SET read_progress = ?4, last_chapter = ?5 WHERE site = ?1 AND kind = ?2 AND id = ?3"
      )
      .run(site, kind, id, clamped, chapter)
  } else {
    this.db
      .query(
        "UPDATE items SET read_progress = ?4 WHERE site = ?1 AND kind = ?2 AND id = ?3"
      )
      .run(site, kind, id, clamped)
  }
  return true
}
```

- [ ] **Step 5: getState 返回 lastChapter + site**

`getState` 的 SELECT 加 `site, last_chapter`，返回对象加 `site`、`lastChapter`（`last_chapter` 为 `INTEGER`，可能为 null）。

- [ ] **Step 6: 改 store.ts —— 列表查询方法**

`listHistory`/`listFavorites`/`listByTag` 的 query 用 `ListQuery.site`（可选，不传跨站）。WHERE 条件加 `AND (?N IS NULL OR i.site = ?N)`（注意 `listByTag` 的 tag JOIN 也要带 site）。`listTags(site?)` 可选过滤。`tagsFor(site, items)` 的 JOIN key 含 site。

返回的 `ListItem` 填充 `site`（`i.site`）和 `lastChapter`（`i.last_chapter`）。

- [ ] **Step 7: 改 store 测试**

`store.test.ts` 现有所有调用都加 site 首参 `"1"`（cool18 默认）。例如：
```ts
// 原: store.recordVisit("post", "t1", "标题", "/url")
// 现: store.recordVisit("1", "post", "t1", "标题", "/url")
```
全局替换：`recordVisit("` → `recordVisit("1", "`，以及其余方法同理（用 sed 或手工，注意 `clearHistory()`/`listTags()` 不变）。

新增测试覆盖：
- 跨站隔离：`recordVisit("1","book","X",...)` 与 `recordVisit("2","book","X",...)` 是两行；`getState("1","book","X")` ≠ `getState("2","book","X")`。
- `setProgress("2","book","X",0.5,3)` 后 `getState("2","book","X").lastChapter === 3`；不传 chapter 时 `last_chapter` 不变。
- 旧库迁移：建一个只含旧 schema（无 site、无 last_chapter、PK=(kind,id)）的临时 db，跑 `openDatabase`，验证数据保留、`site='1'`、`last_chapter IS NULL`、新 PK 生效（`ON CONFLICT(site,kind,id)` 不炸）。

- [ ] **Step 8: 运行测试 + 类型检查**

Run: `bun test packages/core/src/storage/` && `bun run typecheck`
Expected: store 全测试 PASS（含新增跨站/迁移）；类型无错。

- [ ] **Step 9: 提交**

```bash
git add packages/core/src/storage/
git commit -m "feat(core): add site column + last_chapter, rebuild PK, site-aware store"
```

---

## Task 5: 缓存分层（site + chapter）

cache key 加 site 维度，章节页单独 key。分段校验避免路径穿越。

**Files:**
- Modify: `packages/core/src/storage/cache.ts`
- Test: `packages/core/src/storage/cache.test.ts`

**Interfaces:**
- Produces:
  - `contentCachePath(dataDir, site, kind, id, chapter?)` —— 分段 `assertSafeId`；路径 `cache/{site}/{kind}-{id}[-ch{n}].html`。
  - `readContentCache(dataDir, site, kind, id, chapter?)`、`writeContentCache(dataDir, site, kind, id, html, chapter?)` 同步加参。
  - `repliesCachePath`/`readRepliesCache`/`writeRepliesCache` 不变（仅 cool18 用 replies）。

- [ ] **Step 1: 写失败测试**

在 `cache.test.ts` 加（保留现有 round-trip 测试，更新调用签名加 site；新增 chapter 分层 + 跨 site 不撞）：

```ts
import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readContentCache, writeContentCache } from "./cache"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "purifier-cache-"))
})

describe("content cache site + chapter", () => {
  test("same cid different site does not collide", async () => {
    await writeContentCache(dir, "1", "book", "X", "cool18-html")
    await writeContentCache(dir, "2", "book", "X", "xbook-html")
    expect((await readContentCache(dir, "1", "book", "X"))!.data).toBe("cool18-html")
    expect((await readContentCache(dir, "2", "book", "X"))!.data).toBe("xbook-html")
  })
  test("toc vs chapter different files", async () => {
    await writeContentCache(dir, "2", "book", "X", "toc")
    await writeContentCache(dir, "2", "book", "X", "ch1", 1)
    expect((await readContentCache(dir, "2", "book", "X"))!.data).toBe("toc")
    expect((await readContentCache(dir, "2", "book", "X", 1))!.data).toBe("ch1")
  })
  test("invalid site rejected", async () => {
    expect(() => writeContentCache(dir, "../evil", "book", "X", "h")).toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/core/src/storage/cache.test.ts`
Expected: FAIL —— 签名不匹配。

- [ ] **Step 3: 改 cache.ts**

```ts
const SAFE_ID = /^[A-Za-z0-9]+$/

export function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new ExtractorError("invalid id", 400)
  }
}

export function contentCachePath(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string,
  chapter?: number | string
): string {
  assertSafeId(site)
  assertSafeId(id)
  const ch = chapter !== undefined ? `-ch${chapter}` : ""
  return join(dataDir, "cache", site, `${kind}-${id}${ch}.html`)
}

export async function readContentCache(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string,
  chapter?: number | string
): Promise<CacheEntry<string> | null> {
  const path = contentCachePath(dataDir, site, kind, id, chapter)
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
  site: string,
  kind: ItemKind,
  id: string,
  html: string,
  chapter?: number | string
): Promise<void> {
  const path = contentCachePath(dataDir, site, kind, id, chapter)
  await mkdir(join(dataDir, "cache", site), { recursive: true })
  await writeFile(path, html, "utf8")
}
```

`repliesCachePath` 保持原签名（cool18 专用），但内部也可加 site 分层（`cache/{site}/replies-{id}.json`）——为一致，给 `repliesCachePath`/`readRepliesCache`/`writeRepliesCache` 也加 `site` 首参。`clearCache` 不变（清整个 cache 目录）。

更新现有 `cache.test.ts` 的旧测试调用，加 site `"1"`。

- [ ] **Step 4: 运行测试**

Run: `bun test packages/core/src/storage/cache.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查（API 层会暂时报错——下个任务修）**

Run: `bun run typecheck`
Expected: `apps/api/src/index.ts` 报 `readContentCache`/`writeContentCache` 签名不匹配（正常，Task 7 修）。core 包内无错。**不要**在此时跑全仓 typecheck 当成失败；只确认 core 包通过：
Run: `cd packages/core && bun run typecheck`（或 turbo 范围内 core）。
Expected: core 包 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/storage/cache.ts packages/core/src/storage/cache.test.ts
git commit -m "feat(core): site + chapter layered content cache keys"
```

---

## Task 6: XbookcnExtractor 实现 + 注册

实现 xbookcn 的全能力解析（目录/章节/首页/标签/搜索/热榜/相关推荐/单篇），注册到 `SITES`。这是核心任务，依赖 Task 1-5。

**Files:**
- Create: `packages/core/src/extractor/xbookcn.ts`
- Create: `packages/core/src/extractor/fixtures/xbookcn/{toc,multi-toc,chapter,single,home,tag,search,related}.html`（裁剪最小片段）
- Modify: `packages/core/src/extractor/sites.ts:14-17`（加 `"2"`）
- Test: `packages/core/src/extractor/xbookcn.test.ts`

**Interfaces:**
- Consumes: `Extractor` 接口（Task 2）、`utils`（Task 1）、`fetchUpstream`。
- Produces: `XbookcnExtractor`（实现 `Extractor`）、`SITES["2"]` 注册。

- [ ] **Step 1: 准备 fixtures（裁剪最小 HTML）**

从 spec 验证过的真实页面裁剪最小片段（不含完整页面，只留解析目标容器 + 一两个样本项）。每个 fixture 是能被 cheerio 解析的最小 HTML。示例 `toc.html`（多章书目录，含相关推荐）：

```html
<main>
  <h1>欲望夜</h1>
  <p class="meta">作者：幻想 · 7章 · 12.8万字</p>
  <div id="intro"><p>小艾和白石从小玩到大……</p></div>
  <section id="chapter-list">
    <a href="/novel/MjI4NzE/1">第 1 章 序：不是开始的开始</a>
    <a href="/novel/MjI4NzE/2">第 2 章 第一章 芸芸众生</a>
  </section>
  <section id="related-section">
    <a href="/novel/Nzc4Nw" role="listitem"><h3>相关书 A</h3></a>
  </section>
</main>
```

`single.html`（单篇，无"共 N 章"，章节文案"开始阅读正文"）：
```html
<main>
  <h1>超级美女业务员</h1>
  <p class="meta">作者：佚名 · 0.6万字</p>
  <section id="chapter-list">
    <a href="/novel/MjI4NzI/1">开始阅读正文</a>
  </section>
</main>
```

`chapter.html`（章节正文，含书名面包屑 + read-article + 上下章）：
```html
<main>
  <nav><a href="/novel/MjI4NzE">📄书页</a><a href="/novel/MjI4NzE/2">欲望夜</a></nav>
  <h1>序：不是开始的开始</h1>
  <article id="read-article"><p>正文段落。<a href="/novel/MjI4NzE/2">下一章</a> <a href="https://xchina.click/x">广告</a></p></article>
  <nav><a href="/novel/MjI4NzE">返回书页</a><a href="/novel/MjI4NzE/2">下一章 →</a></nav>
</main>
```

`home.html`（首页时间线 + 热读榜侧栏 + 标签）、`tag.html`、`search.html` 类似裁剪。**真实抓取见 spec 验证记录；fixture 需覆盖测试断言的选择器。**

- [ ] **Step 2: 写 xbookcn 测试（先写关键断言）**

创建 `packages/core/src/extractor/xbookcn.test.ts`，用 fixtures 测：

```ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { XbookcnExtractor } from "./xbookcn"

const fx = (f: string) => readFileSync(join(__dirname, "fixtures/xbookcn", f), "utf8")
const e = new XbookcnExtractor()

describe("XbookcnExtractor basics", () => {
  test("urls", () => {
    expect(e.homeUrl).toBe("https://www.xbookcn.org")
    expect(e.buildBookUrl("MjI4NzE")).toBe("https://www.xbookcn.org/novel/MjI4NzE")
    expect(e.buildChapterUrl("MjI4NzE", 2)).toBe("https://www.xbookcn.org/novel/MjI4NzE/2")
  })
  test("unsupported methods throw 404", () => {
    expect(() => e.extractContent("")).toThrow(/does not support posts/)
    expect(() => e.extractGoldLinks()).toThrow(/gold/)
    expect(() => e.fetchReplies()).toThrow(/replies/)
  })
})

describe("extractBookContent toc", () => {
  test("multi-chapter toc has chapters + related", () => {
    const r = e.extractBookContent(fx("toc.html"))
    expect(r.title).toBe("欲望夜")
    expect(r.meta.author).toBe("幻想")
    expect(r.intro).toContain("小艾")
    expect(r.chapters!.length).toBe(2)
    expect(r.chapters![0]).toEqual({ index: 1, title: "序：不是开始的开始", tid: "MjI4NzE" })
    expect(r.singleShot).toBeFalsy()
    expect(r.related!.length).toBe(1)
  })
  test("single-shot has no chapter list, singleShot=true", () => {
    const r = e.extractBookContent(fx("single.html"))
    expect(r.singleShot).toBe(true)
    expect(r.chapters).toEqual([{ index: 1, title: "超级美女业务员", tid: "MjI4NzI" }])
  })
})

describe("extractBookContent chapter", () => {
  test("chapter body + bookTitle + prev/next + sanitized links", () => {
    const r = e.extractBookContent(fx("chapter.html"), { chapter: "1" })
    expect(r.title).toBe("序：不是开始的开始")
    expect(r.bookTitle).toBe("欲望夜")
    expect(r.chapterIndex).toBe(1)
    expect(r.nextChapter).toBe(2)
    expect(r.prevChapter).toBeUndefined()
    // 站内章链改写为 /book/...?site=2&chapter=
    expect(r.content).toContain('/book/MjI4NzE?site=2&chapter=2')
    // 外链剥离（不留 href）
    expect(r.content).not.toContain("xchina.click")
    expect(r.content).toContain("广告") // 但保留文字
  })
})

describe("lists", () => {
  test("extractCategoryLinks url carries site=2", () => {
    const links = e.extractCategoryLinks(fx("home.html"))
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].url).toContain("site=2")
  })
  test("extractHotPosts from sidebar, reads=0", () => {
    const posts = e.extractHotPosts(fx("home.html"))
    expect(posts.length).toBeGreaterThan(0)
    expect(posts[0].reads).toBe(0)
    expect(posts[0].tid).toMatch(/^[A-Za-z0-9]+$/)
  })
})
```

`fetchHomeLinks`/`fetchCategoryPage` 涉及网络，用 stub `fetchUpstream`（通过 `globalThis.fetch` mock 或重构为注入）—— 若难以 mock，测试聚焦在纯解析函数（把 `fetchHomeLinks` 的解析逻辑抽成 `parseNovelCards(html)` 纯函数单独测，`fetchHomeLinks` 只做抓取+拼装）。

- [ ] **Step 3: 运行确认失败**

Run: `bun test packages/core/src/extractor/xbookcn.test.ts`
Expected: FAIL —— 找不到 `./xbookcn`。

- [ ] **Step 4: 实现 xbookcn.ts**

创建 `packages/core/src/extractor/xbookcn.ts`。结构：

```ts
import * as cheerio from "cheerio"
import { fetchUpstream } from "../upstream"
import { decodeHtmlEntities, escapeHtml, stripTags } from "./utils"
import {
  type BookContentResponse,
  type CategoryLink,
  type CategoryPage,
  type CategoryQuery,
  type ChapterLink,
  type ContentResponse,
  type CmtRankPost,
  type Extractor,
  type ExtractorError,
  type HomePage,
  type HotPost,
  type RecommendSection,
  type ReplyNode,
  ExtractorError as ExtractorErrorClass,
} from "./types"
```
（注意 `ExtractorError` 既是类型又是值；import 时 `ExtractorError` 作为值、`type ExtractorError` 不需要——直接 `import { ExtractorError }`。修正：`import { ExtractorError, ...类型 } from "./types"`。）

类骨架（实现要点见 spec §2，下面是关键解析逻辑）：

```ts
export class XbookcnExtractor implements Extractor {
  name = "xbookcn"
  homeUrl = "https://www.xbookcn.org"

  buildUrl(): never { throw notSupported("posts") }
  buildBookUrl(cid: string) { return `${this.homeUrl}/novel/${cid}` }
  buildChapterUrl(cid: string, n: string | number) {
    return `${this.homeUrl}/novel/${cid}/${n}`
  }

  extractContent(): ContentResponse { throw notSupported("posts") }
  extractGoldLinks(): never { throw notSupported("gold/featured links") }
  extractCmtRankPosts(): never { throw notSupported("comment rank") }
  extractRecommendSections(): never { throw notSupported("picks sections") }
  fetchReplies(): never { throw notSupported("replies") }
  fetchRepliesRaw(): never { throw notSupported("replies") }
  parseReplies(): never { throw notSupported("replies") }

  extractBookContent(html, opts?): BookContentResponse {
    return opts?.chapter
      ? this.extractChapter(html, opts.chapter)
      : this.extractToc(html)
  }

  private extractToc(html): BookContentResponse {
    const $ = cheerio.load(html)
    const title = $("main h1").first().text().trim()
    const meta = $("p.meta").first().text() // "作者：幻想 · 7章 · 12.8万字"
    const author = parseAuthor(meta) // 正则抽 "作者：X"，无则 null
    const intro = $("#intro, [class*=intro]").text().trim() || undefined
    const chapterLinks = $("#chapter-list a, ...").map(...).get()
    const singleShot = !/共\s*\d+\s*章/.test(html) && chapterLinks.length <= 1
    const chapters = singleShot
      ? [{ index: 1, title, tid: cidFromUrl(chapterLinks[0]) }]
      : chapterLinks.map((a, i) => ({
          index: i + 1,
          title: $(a).text().trim(),
          tid: cidFromUrl($(a).attr("href")),
        }))
    const related = $("#related-section a[role=listitem]").map(...).get()
    return { title, content: intro ?? "", intro, meta: { author }, chapters, singleShot, related }
  }

  private extractChapter(html, chapter): BookContentResponse {
    const $ = cheerio.load(html)
    const title = $("main h1").first().text().trim()
    // 书名：面包屑里指向 /novel/{cid}（不带章号）的链接文本
    const bookTitle = $(`nav a[href^="/novel/"]`).filter(...不带 /数字后缀...).first().text().trim()
    const rawArticle = $("#read-article").html() ?? ""
    const content = sanitizeChapterHtml(rawArticle, cid) // 见下
    const nextHref = $(`a[href="/novel/${cid}/..."]`) // "下一章"链接抽章号
    const nextChapter = parseChapterN(nextHref)
    const prevChapter = ... // "上一章"，本章为 1 时 undefined
    return { title, content, bookTitle, chapterIndex: Number(chapter), prevChapter, nextChapter, meta: { author: null } }
  }
}
```

`sanitizeChapterHtml(rawHtml, cid)`：用 cheerio 遍历节点；`<a href="/novel/{cid}/{n}">` → 改写为 `<a href="/book/{cid}?site=2&chapter={n}">`（decode href → 抽 n → 拼站内 → escape）；其余 `<a>` 剥离标签留文字（`<a>广告</a>` → `广告`）；最后整体 `stripTags`+`decodeEntities`+`escapeHtml`（策略对齐 cool18 `extractPreHtml`，但这里 article 已是 HTML 片段，需保留我们改写后的 `<a>`）。**实现关键**：先占位法——遍历 a 标签，站内链先替换成 `\u0000L{i}\u0000` 占位 + 记录改写后 href，其余 a 剥离成纯文本，然后 `stripTags(剩余文本)` → `decodeEntities` → `escapeHtml` → 还原占位为 `<a href="...">文字</a>`。与 `extractor.ts:770-814` 的占位策略一致。

辅助：
- `cidFromUrl(href)`：`/novel/MjI4NzE/2` → `MjI4NzI`（取第三段）。
- `parseChapterN(href)`：取 `/novel/{cid}/{n}` 的 n。
- `parseAuthor(meta)`：`/作者[：:]\s*([^·\n]+)/`，无匹配 null。
- `parseNovelCards(html)`：解析首页/标签/搜索的 `<article>` 卡片 → `ChapterLink[]`（tid=cid）。

`fetchHomeLinks`/`fetchCategoryPage`/`fetchHotHtml`/`extractHotPosts`/`extractCategoryLinks` 实现按 spec §2 注释。`fetchHotHtml`：`fetchUpstream(this.homeUrl).text()`。

- [ ] **Step 5: 注册到 sites.ts**

在 `sites.ts` 的 `SITES` 加：
```ts
"2": { name: "xbookcn", getExtractor: () => new XbookcnExtractor() },
```
顶部 import `{ XbookcnExtractor } from "./xbookcn"`。更新 `sites.test.ts` 加 `resolveSite("2").name === "xbookcn"`。

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `bun test packages/core/src/extractor/` && `cd packages/core && bun run typecheck`
Expected: xbookcn 测试 PASS；sites 测试 PASS；core 包类型无错。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/extractor/xbookcn.ts packages/core/src/extractor/xbookcn.test.ts packages/core/src/extractor/fixtures/xbookcn/ packages/core/src/extractor/sites.ts packages/core/src/extractor/sites.test.ts
git commit -m "feat(core): implement XbookcnExtractor with full capability"
```

---

## Task 7: API 层 site 贯穿 + books chapter + trending fetchHotHtml + posts 短路 + me 透传

把所有内容 handler 改用 `resolveSite(site)`，books 支持 chapter，trending 用 `fetchHotHtml`，me/* 透传 site。

**Files:**
- Modify: `apps/api/src/index.ts`（多处）

**Interfaces:**
- Consumes: Task 3-6 的全部 core 产出。
- Produces: 所有 `/api/*` 支持 `?site=`；`/api/books` 支持 `?chapter=`；`/api/me/*` 透传 site。

- [ ] **Step 1: 改 loadCachedContent + handler 顶部读 site**

`loadCachedContent`（行 106-133）签名加 `site`：
```ts
async function loadCachedContent(
  site: string,
  kind: ItemKind,
  id: string,
  refresh: boolean,
  fetchFn: () => Promise<string>,
  chapter?: string
): Promise<LoadedContent> {
  if (!refresh) {
    const cached = await readContentCache(DATA_DIR, site, kind, id, chapter)
    if (cached) return { html: cached.data, fromCache: true, refreshed: false }
  }
  try {
    const html = await fetchFn()
    await writeContentCache(DATA_DIR, site, kind, id, html, chapter)
    return { html, fromCache: false, refreshed: refresh }
  } catch (err) { /* 同原逻辑 */ }
}
```

每个内容 handler 顶部加：
```ts
const site = url.searchParams.get("site") ?? undefined
const extractor = resolveSite(site)
const siteId = site ?? DEFAULT_SITE
```
替换所有 `getExtractor("cool18")`（7 处）为 `resolveSite(site)`。

- [ ] **Step 2: handleBooks 支持 chapter + recordVisit 用 bookTitle**

```ts
async function handleBooks(url: URL): Promise<Response> {
  const cid = url.searchParams.get("cid")
  if (!cid) return jsonError("missing cid parameter", 400)
  assertSafeId(cid)
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const extractor = resolveSite(site)
  const chapter = url.searchParams.get("chapter") ?? undefined
  if (chapter !== undefined) assertSafeId(chapter)
  const refresh = url.searchParams.get("refresh") === "1"

  const pageUrl = chapter
    ? extractor.buildChapterUrl(cid, chapter)
    : extractor.buildBookUrl(cid)

  const content = await loadCachedContent(siteId, "book", cid, refresh, async () => {
    const resp = await fetchUpstream(pageUrl, { headers: { Referer: extractor.homeUrl } })
    if (!resp.ok) throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    return resp.text()
  }, chapter)

  const result = extractor.extractBookContent(content.html, chapter ? { chapter } : undefined)

  // 书名策略：章节页用 bookTitle，否则用 title
  const visitTitle = chapter ? (result.bookTitle ?? result.title) : result.title
  store.recordVisit(siteId, "book", cid, visitTitle, extractor.buildBookUrl(cid))

  const payload: Record<string, unknown> = {
    title: result.title,
    content: result.content,
    meta: result.meta,
    url: pageUrl,
    cid,
  }
  // xbookcn 扩展字段（cool18 这些为 undefined，JSON 里自然省略）
  for (const k of ["intro", "chapters", "singleShot", "related", "chapterIndex", "prevChapter", "nextChapter"]) {
    const v = (result as any)[k]
    if (v !== undefined) payload[k] = v
  }
  if (refresh && !content.refreshed) {
    payload.stale = true
    payload.refreshError = content.refreshError
  }
  const useNoStore = content.fromCache || refresh
  return jsonOk(payload, useNoStore ? NO_STORE_HEADERS : CONTENT_CACHE_HEADERS)
}
```

（`buildChapterUrl` 需在 `Extractor` 接口暴露，或 cast 为 `XbookcnExtractor`。**推荐**：在 Task 2 的接口里加 `buildChapterUrl?(cid, n): string` 为可选成员，cool18 不实现即 undefined，API 层 `extractor.buildChapterUrl?.(cid, chapter)`。补进 Task 2 接口定义——本步骤假设接口已含可选 `buildChapterUrl`。）

- [ ] **Step 3: handleTrending 用 fetchHotHtml**

```ts
async function handleTrending(url: URL): Promise<Response> {
  const site = url.searchParams.get("site") ?? undefined
  const extractor = resolveSite(site)
  try {
    const html = await extractor.fetchHotHtml()
    return jsonOk({ posts: extractor.extractHotPosts(html) }, LIST_CACHE_HEADERS)
  } catch (err) {
    if (err instanceof ExtractorError) throw err
    const status = err instanceof UpstreamTimeoutError ? 504 : 502
    return jsonError(`upstream error`, status)
  }
}
```
（`handleTrending` 原本无参，现需接收 `url` 以取 site；更新 `route` 里 `handleTrending(url)` 调用。）

- [ ] **Step 4: handlePosts site=2 短路 + tid 分支透传 site**

`handlePosts` 顶部加 site 解析。site=2 时若带 tid → 短路 404（xbookcn 无帖子）：
```ts
const site = url.searchParams.get("site") ?? undefined
const siteId = site ?? DEFAULT_SITE
const extractor = resolveSite(site)
const tid = url.searchParams.get("tid")
if (tid && siteId !== "1") {
  // xbookcn 无帖子模型
  return jsonError("xbookcn does not support posts", 404)
}
```
`recordVisit` 调用改为 `store.recordVisit(siteId, "post", tid, title, pageUrl)`。`loadCachedContent` 调用加 `siteId` 首参。`loadCachedReplies` 调用加 `siteId`（replies cache 也按 site 分层；replies 仅 cool18 用，但保持签名一致）。

`handleHomeExtract`（categories/featured/picks）同理加 site，`fetchUpstream(extractor.homeUrl)` 不变。

- [ ] **Step 5: handleComments / trending 调用更新**

`handleComments`：`getExtractor` → `resolveSite(site)`，`fetchUpstream(\`${extractor.homeUrl}?act=cmtrank&y=1\`)` 不变。site=2 时 `extractCmtRankPosts` 抛 404。

- [ ] **Step 6: /api/me/* 透传 site**

`handleMeHistory`/`handleMeFavorites`/`handleMeItems`/`handleMeTags` 的 query 加 `site`（透传给 store list 查询的可选 site）。`handleHistoryDelete` 的 `kind+id` 模式加 `site` query；body items 模式每项可含 `site`。`handleFavoriteWrite`/`handleTagsWrite`/`handleProgressWrite` body 加 `site`（默认 `"1"`）。`handleMeState` 加 `site` query。

`handleProgressWrite` 关键改动：
```ts
const { kind, id, progress, site, chapter } = await readJsonBody(req)
const siteId = site ?? "1"
const ok = store.setProgress(siteId, kind, id, progress, chapter)
```

`handleMeState` 返回的 `empty` 状态对象加 `site: siteId, lastChapter: null`；非空走 `getState(siteId, kind, id)` 已含 lastChapter（Task 4）。

- [ ] **Step 7: 路由分支更新**

`route` 里 `handleTrending` → `handleTrending(url)`（传 url）。其余 handler 已接收 url。

- [ ] **Step 8: 类型检查（前端会暂时报错，下批任务修）**

Run: `cd apps/api && bun run typecheck`
Expected: API 包类型无错。全仓 typecheck 前端会报（routes/types 未更新，正常）。

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): thread site param through all endpoints, books chapter, trending fetchHotHtml"
```

---

## Task 8: 前端 routes.ts —— site 类型 + 路径函数 + NAV_ITEMS.sites

前端基础设施：site 类型、路径函数透传 site、导航项声明支持站点。

**Files:**
- Modify: `apps/web/src/lib/routes.ts`

**Interfaces:**
- Produces: `SiteId`、`DEFAULT_SITE = "1"`、`SITES`（id→显示名）、`useSite`（Task 9）、`bookPath/readPath/browsePath/searchPath` 加 site。

- [ ] **Step 1: 加 site 类型 + SITES 元数据**

在 `routes.ts` 顶部加：
```ts
export type SiteId = string
export const DEFAULT_SITE: SiteId = "1"
export const SITES: Record<SiteId, { label: string }> = {
  "1": { label: "论坛" },
  "2": { label: "书库" },
}
```

- [ ] **Step 2: 路径函数加 site 透传**

改 `readPath`/`bookPath`/`browsePath`/`searchPath`，非默认站才带 `?site=`（URL 干净）：

```ts
function withSite(params: URLSearchParams, site?: string) {
  if (site && site !== DEFAULT_SITE) params.set("site", site)
}

export function readPath(tid: string, site?: SiteId): string {
  const p = new URLSearchParams()
  withSite(p, site)
  const qs = p.toString()
  return `/read/${encodeURIComponent(tid)}${qs ? `?${qs}` : ""}`
}

export function bookPath(cid: string, opts?: { site?: SiteId; chapter?: string }): string {
  const p = new URLSearchParams()
  withSite(p, opts?.site)
  if (opts?.chapter) p.set("chapter", opts.chapter)
  const qs = p.toString()
  return `/book/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`
}
```
`browsePath`/`searchPath` 加 `site?: SiteId` 参数，内部 `withSite`。

- [ ] **Step 3: NAV_ITEMS 加 sites 字段**

每个 `NAV_ITEMS` 项加 `sites: SiteId[]`：
```ts
{ href: routes.home, label: "首页", sites: ["1", "2"], match: ... },
{ href: routes.categories, label: "分类", sites: ["1", "2"], match: ... },
{ href: routes.featured, label: "精华", sites: ["1"], match: ... },
{ href: routes.picks, label: "扫文", sites: ["1"], match: ... },
{ href: routes.comments, label: "评论", sites: ["1"], match: ... },
{ href: routes.trending, label: "人气", sites: ["1", "2"], match: ... },
{ href: routes.search, label: "搜索", sites: ["1", "2"], match: ... },
{ href: routes.history, label: "历史", sites: ["1", "2"], match: ... },
{ href: routes.favorites, label: "收藏", sites: ["1", "2"], match: ... },
{ href: routes.tags, label: "标签", sites: ["1", "2"], match: ... },
```

- [ ] **Step 4: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: 报错来自调用方未传 site（多数可选，不报错）。可能 `NAV_ITEMS` 的 `as const` 与 `sites` 数组类型冲突——若报错，把 `sites` 类型显式标注 `sites: SiteId[]` 并去掉该项的 `as const` 依赖，或整体 `NAV_ITEMS: NavItem[]`。修到无错。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/routes.ts
git commit -m "feat(web): site type, SITES metadata, path helpers carry site, NAV_ITEMS.sites"
```

---

## Task 9: useSite hook + SiteSwitcher 组件

站点切换能力。内容页切站回首页，个人区原地。

**Files:**
- Create: `apps/web/src/hooks/use-site.ts`
- Create: `apps/web/src/components/site-switcher.tsx`
- Modify: `apps/web/src/components/site-header.tsx`（NAV 过滤 + 嵌入 switcher）

**Interfaces:**
- Produces: `useSite(): SiteId`、`<SiteSwitcher />`。

- [ ] **Step 1: useSite hook**

```ts
// apps/web/src/hooks/use-site.ts
import { useSearchParams } from "react-router-dom"
import { DEFAULT_SITE, type SiteId, isValidSite } from "@/lib/routes" // isValidSite 从 core 重导出到 routes？或本地校验
export function useSite(): SiteId {
  const [params] = useSearchParams()
  const s = params.get("site") ?? DEFAULT_SITE
  return s === "2" ? "2" : "1" // 只认 1/2，其余归 1
}
```
（`isValidSite` 在 core；前端可在 routes.ts 重导出，或用简单 `s === "2" ? "2" : "1"`。）

- [ ] **Step 2: SiteSwitcher 组件**

```tsx
// apps/web/src/components/site-switcher.tsx
import { useNavigate, useLocation } from "react-router-dom"
import { DEFAULT_SITE, SITES, type SiteId } from "@/lib/routes"

const PERSONAL = new Set(["/history", "/favorites", "/tags"])

export function SiteSwitcher() {
  const site = useSite()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const switchTo = (next: SiteId) => {
    if (next === site) return
    if (PERSONAL.has(pathname)) {
      // 个人区：原地刷新（保留 path，加 ?site=）
      const params = new URLSearchParams()
      if (next !== DEFAULT_SITE) params.set("site", next)
      navigate({ pathname, search: params.toString() })
    } else {
      // 内容页：回首页（路径语义不同）
      const params = new URLSearchParams()
      if (next !== DEFAULT_SITE) params.set("site", next)
      navigate({ pathname: "/", search: params.toString() })
    }
  }
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5">
      {(Object.keys(SITES) as SiteId[]).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => switchTo(id)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            site === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {SITES[id].label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: site-header 嵌入 + NAV 过滤**

在 `site-header.tsx`：NAV 渲染处按当前 site 过滤：
```tsx
const site = useSite()
const items = NAV_ITEMS.filter((it) => (it.sites as SiteId[]).includes(site))
```
在 header 工具区放 `<SiteSwitcher />`。

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck` && `bun run build:web`
Expected: 无错；构建通过。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/hooks/use-site.ts apps/web/src/components/site-switcher.tsx apps/web/src/components/site-header.tsx
git commit -m "feat(web): SiteSwitcher + useSite, NAV filters by site"
```

---

## Task 10: BookPage 目录/章节二态 + useReadingProgress 章号匹配

BookPage 支持 xbookcn 目录页与章节正文页；进度恢复仅当章号匹配。

**Files:**
- Modify: `apps/web/src/pages/BookPage.tsx`
- Modify: `apps/web/src/hooks/use-reading-progress.ts`
- Modify: `apps/web/src/components/item-actions.tsx`（`useItemState`/`ItemState` 加 site + lastChapter）

**Interfaces:**
- Consumes: `useSite`、`bookPath(cid,{site,chapter})`、API 新字段。
- Produces: BookPage 二态渲染；`useReadingProgress(kind, id, opts & {chapter?; restoreChapter?})`。

- [ ] **Step 1: useReadingProgress 接收 chapter + 章号匹配**

改签名加 `chapter?: string` 与 `restoreChapter?: number | null`；restore 仅当 `chapter` 与 `restoreChapter` 匹配（都为数字且相等）才执行。PUT body 带 chapter：
```ts
body: JSON.stringify({ kind, id, progress: p, site, chapter })
```
（需接收 site 参数或内部用 useSite；让调用方传 site 更纯。签名加 `site?: SiteId`。）

restore 决策段加章号判断：
```ts
const chapterMatches = opts.chapter !== undefined && opts.restoreChapter !== null && opts.restoreChapter !== undefined && Number(opts.chapter) === opts.restoreChapter
if (!chapterMatches) { restoreTarget.current = null; return }
```
cool18（无 chapter）保持原行为：`chapter === undefined` 时不做章号门控，直接按原逻辑（兼容）。

- [ ] **Step 2: item-actions ItemState 加 lastChapter + site**

`ItemState` interface 加 `site: string`、`lastChapter: number | null`。`useItemState` 的 fetch URL 加 `&site=${site}`（接收 site 参数或内部 useSite）。PUT favorite/tags body 加 `site`。

- [ ] **Step 3: BookPage 二态**

```tsx
const { cid = "" } = useParams<{ cid: string }>()
const [params] = useSearchParams()
const chapter = params.get("chapter") ?? undefined
const site = useSite()
```
API 调用：`${api.books}?cid=${cid}&site=${site}${chapter ? `&chapter=${chapter}` : ""}`。

渲染分支：
- 无 chapter（目录页）：渲染标题/作者/简介/章节列表（点 `bookPath(cid,{site,chapter:String(i+1)})`）/相关推荐。singleShot 时主 CTA"开始阅读"跳 chapter=1。cool18（site=1）忽略 chapter，正文直接渲染（现有 `<ArticleView>` 路径）。
- 有 chapter（章节页）：渲染章名 + 正文 + "←上一章 / 返回书页 / 下一章→"导航 + `<ArticleView>`。导航链接用 `result.prevChapter`/`nextChapter`。

`useReadingProgress` 仅在章节页（site=2 且有 chapter）或 cool18（site=1）启用；目录页不调用。

- [ ] **Step 4: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: 无错。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/BookPage.tsx apps/web/src/hooks/use-reading-progress.ts apps/web/src/components/item-actions.tsx
git commit -m "feat(web): BookPage toc/chapter modes, progress restores only on chapter match"
```

---

## Task 11: 列表页 site 透传 + book 链接

HomePage/Categories/Browse/Search/Trending 按 site 透传，site=2 列表项链接用 `bookPath`（tid 实为 cid）。

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`、`CategoriesPage.tsx`、`BrowsePage.tsx`、`SearchPage.tsx`、`TrendingPage.tsx`
- Modify: `apps/web/src/components/me-item-card.tsx`、`list-post-card.tsx`（如需按 site 选链接）

**Interfaces:**
- Consumes: `useSite`、`bookPath`/`readPath`、API 带 site。

- [ ] **Step 1: HomePage site 透传 + book 链接**

API 调用加 `&site=${site}`。列表项 href：
```tsx
const href = site === "2" ? bookPath(link.tid, { site }) : readPath(link.tid, site)
```

- [ ] **Step 2: Categories/Browse/Search/Trending 同理**

各页 API 调用带 site。Categories 的 `CategoryLink.url` 已含 site=2（extractor 生成）或前端拼。Browse/Search 的分页链接、Trending 卡片进 book。Trending site=2 卡片用 `bookPath(tid,{site})`。

- [ ] **Step 3: me-item-card 带 site**

`MeItemCard` 渲染链接：`item.kind === "book"` → `bookPath(id,{site:item.site})`；post → `readPath(id, item.site)`。

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck` && `bun run build`
Expected: 全仓构建通过。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/ apps/web/src/components/me-item-card.tsx apps/web/src/components/list-post-card.tsx
git commit -m "feat(web): list pages thread site, site=2 links to /book"
```

---

## Task 12: 全量验证 + 手动测试

端到端验证全链路。

**Files:** 无（验证任务）

- [ ] **Step 1: 全量自动化验证**

Run:
```bash
bun run test
bun run typecheck
bun run build
```
Expected: 全部 PASS。

- [ ] **Step 2: 手动验证 site=2（启动 dev）**

Run: `bun run dev`（需 HTTPS_PROXY 若上游不可达）

按 spec 验证清单逐项核对：
- [ ] 首页时间线 + 无限滚动，点卡进书目录（非 /read）
- [ ] 分类标签网格；browse 分页
- [ ] 搜索双字关键词有结果，单字空
- [ ] 人气=今日热读榜，点进书
- [ ] 多章目录 + 章节正文 + 上下章 + 相关推荐
- [ ] 单篇目录 CTA → chapter=1
- [ ] 正文无站外链；章链带 site=2
- [ ] 收藏/历史书级带 site；重新打开进目录
- [ ] 同章再进恢复滚动；换章从顶部；目录不写进度
- [ ] 历史书名是书名非章名
- [ ] site=2 导航无精华/扫文/评论
- [ ] 内容页切站回首页；个人区原地
- [ ] 切回 site=1，cool18 全功能正常

- [ ] **Step 3: 提交验证记录（如有 fix）**

若手动测试发现问题，修复后单独提交。无问题则无需提交。

---

## 自检备注

**Spec 覆盖：** spec §1（站点注册表）→ Task 3；§2（XbookcnExtractor）→ Task 6；§3（类型）→ Task 2；§4（数据层/进度/recordVisit）→ Task 4 + Task 10；§5（API）→ Task 7；§6（前端 routes/switcher/BookPage/列表）→ Task 8-11；§7（测试）→ 各 Task 内嵌。能力矩阵每行均由 Task 6（解析）+ Task 7（API）+ Task 11（前端入口）覆盖。

**关键类型一致性：** `setProgress(site, kind, id, progress, chapter?)` 在 Task 4（store）与 Task 7（API 透传）与 Task 10（前端 PUT body）三处签名一致；`lastChapter` 在 store 返回 → API state → `ItemState.lastChapter` → `useReadingProgress.restoreChapter` 全链路同名；`bookTitle` 在 Task 2（类型）→ Task 6（extractChapter 填充）→ Task 7（recordVisit 使用）一致；`fetchHotHtml` 在 Task 2（接口）→ Task 6（xbookcn 实现）/ Task 2（cool18 实现）→ Task 7（调用）一致。

**已知风险点：** Task 6 的 `sanitizeChapterHtml` 占位策略需仔细对齐 cool18 `extractPreHtml`（`extractor.ts:770-814`）；Task 4 旧库迁移顺序（read_progress ADD 先于 site 重建）；Task 7 `buildChapterUrl` 需为接口可选成员（Task 2 补）。
