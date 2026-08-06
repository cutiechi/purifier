# 设计：增加 xbookcn.org 上游站点

- 日期：2026-08-06
- 状态：已确认，待实现

## 背景与目标

当前应用只支持 cool18 一个上游。`Extractor` 接口已为多站点抽象，但 `getExtractor`（`packages/core/src/extractor/index.ts:7`）是硬编码 `case "cool18"` 单分支，API 层 7 处调用全写死 `getExtractor("cool18")`，多站点扩展点未真正接通。

本次新增第二个上游 **xbookcn.org**（中文成人小说站，书籍/章节模型），并把"加一个站点"这件事做成**纯增量操作**：注册一个 extractor + 分配一个 site id，不改路由结构、不碰现有 cool18 逻辑。

## 用户决策（已确认）

1. **路由策略**：一套路由，`site` 参数贯穿前后端，不搞独立路由组。
2. **站点标识**：URL 上用**短数字 id**（`site=1` cool18、`site=2` xbookcn），不暴露站点名。cool18 是默认值，不传等同 `site=1`。
3. **数据粒度**：xbookcn 的历史/收藏/进度记到**书级（cid）**，章节不独立记录。与 cool18 书库语义一致。
4. **数据隔离**：`items`/`favorites`/`tags` 三表加 **`site` 列**，PK 改为 `(site, kind, id)`。概念正交（kind=类型，site=站点），未来加第三站纯增量。
5. **前端入口**：xbookcn 作为**独立页面区**，导航按 site 动态渲染——不支持的能力（精华/扫文/评论/人气/跟帖）在 `site=2` 下根本不出现。
6. **内容范围**：xbookcn 支持四项——书目录、章节正文、首页/最新列表、标签筛选。其余能力（精华热贴/评论榜/人气榜/扫文推荐/帖子跟帖）不支持。
7. **不支持的能力**：对应 extractor 方法抛 `ExtractorError(404, "xbookcn does not support ...")`，前端不暴露入口，用户点不到。

## xbookcn.org 站点结构（实测）

UTF-8，路径式 URL，无查询串，无 `<pre>` 正文容器。

| 页面 | URL | 结构 |
|---|---|---|
| 首页 | `/` | 精选小说卡（标题+作者+字数+简介）+ 15 个标签导航（`/tag/{slug}`）|
| 最新列表 | `/novels` | 每页 24 条小说卡，分页 `/novels/{N}`（N 从 2 起）|
| 标签页 | `/tag/{slug}` | 每页 24 条，分页 `/tag/{slug}/{N}`。slug 如 `wife`/`student`/`anime` |
| 小说目录 | `/novel/{cid}` | cid 为 base64（如 `MjI4NzE`）。含 h1 书名、作者、简介、章节列表（`/novel/{cid}/{n}`，n 从 1 起）|
| 章节正文 | `/novel/{cid}/{n}` | h1 章节名，正文在 `<article id="read-article">`，底部"上一章/下一章/返回书页"导航 |

15 个标签 slug：`audio wife student anime celebrities fantasy family group exposure bdsm lgbt ntr boys comic`。

## 架构总览

```
前端 URL                              API 路由                              Extractor
─────────                             ────────                              ─────────
/?site=                               /api/posts?mtid=&site=                ┐
/read/:tid?site=                      /api/posts?tid=&site=                 │
/book/:cid?site=&chapter=             /api/books?cid=&site=&chapter=        ├─ resolveSite(site)
/categories?site=                     /api/categories?site=                 │   → extractor
/browse?type=&site=                   /api/browse?type=&site=               │
/search?q=&site=                      /api/browse?q=&site=                  ┘
                                      /api/featured?site= 等                （site=2 时 404，前端不暴露）
/history /favorites /tags             /api/me/*                             （跨站，按 site 可筛）
```

三层改动：
1. **core 层**：新增 `XbookcnExtractor` + 站点注册表 `sites.ts`，`getExtractor` 改为接受可选 site id。
2. **数据层**：三表加 `site` 列，幂等迁移，所有查询加 site 维度。
3. **API/前端**：所有内容端点读 `site` 参数；前端一套路由用 `?site=` 贯穿，导航按 site 动态过滤。

## 详细设计

### 1. 站点注册表（core 层）

新建 `packages/core/src/extractor/sites.ts`：

```ts
import { Cool18Extractor } from "./extractor"
import { XbookcnExtractor } from "./xbookcn"
import { Extractor, ExtractorError } from "./types"

/** 站点 id（数字字符串） */
export type SiteId = string

interface SiteEntry {
  /** 站点内部名，用于日志/诊断 */
  name: string
  getExtractor: () => Extractor
}

/** 站点注册表。新增站点 = 在此加一行 + 实现 Extractor。 */
export const SITES: Record<SiteId, SiteEntry> = {
  "1": { name: "cool18", getExtractor: () => new Cool18Extractor() },
  "2": { name: "xbookcn", getExtractor: () => new XbookcnExtractor() },
}

/** 默认站点 id（cool18），传不传 site 参数行为一致。 */
export const DEFAULT_SITE: SiteId = "1"

/** 按 id 解析站点并返回 extractor；未知 id 抛 400。 */
export function resolveSite(id?: string): Extractor {
  const entry = SITES[id ?? DEFAULT_SITE]
  if (!entry) throw new ExtractorError(`unknown site: ${id ?? "(empty)"}`, 400)
  return entry.getExtractor()
}

/** 校验 site id 合法性（不构造 extractor），用于前端参数透传前的校验。 */
export function isValidSite(id?: string): boolean {
  return !id || id in SITES
}
```

`packages/core/src/extractor/index.ts` 的 `getExtractor` **签名改为接受可选 site id**：`getExtractor(id?: string): Extractor`，内部直接调用 `resolveSite(id)`。一刀切，不保留旧的"按 name 取"语义——调用点全部迁移到 id（API 层从请求读 `site` 参数传入）。导出新增 `SITES`/`DEFAULT_SITE`/`resolveSite`/`isValidSite`，`getExtractor` 与 `resolveSite` 同义保留二者仅为命名偏好。

### 2. XbookcnExtractor 实现

新建 `packages/core/src/extractor/xbookcn.ts`。

```ts
export class XbookcnExtractor implements Extractor {
  name = "xbookcn"
  homeUrl = "https://www.xbookcn.org"

  buildUrl(tid: string): string {
    return `${this.homeUrl}/novel/${tid}`
  }
  buildBookUrl(cid: string): string {
    return `${this.homeUrl}/novel/${cid}`
  }
  /** 章节正文页 URL（非接口成员，内部辅助 + API 层使用） */
  buildChapterUrl(cid: string, chapter: string | number): string {
    return `${this.homeUrl}/novel/${cid}/${chapter}`
  }

  /** xbookcn 无帖子模型，章节正文走 extractBookContent(html, {chapter}) */
  extractContent(html: string): ContentResponse {
    throw new ExtractorError("xbookcn does not support posts", 404)
  }

  /**
   * 解析书库内容。opts.chapter 缺省 → 目录页；给定 → 章节正文页。
   * 两站共用一个方法，用 chapter 区分。
   */
  extractBookContent(html: string, opts?: { chapter?: string }): BookContentResponse {
    if (!opts?.chapter) return this.extractToc(html)
    return this.extractChapter(html, opts.chapter)
  }

  private extractToc(html: string): BookContentResponse {
    // h1 书名 / 作者 / 作品简介 / 章节目录 (共 N 章)
    // 返回 { title, content: 简介文本, intro, chapters: ChapterLink[], meta }
  }

  private extractChapter(html: string, chapter: string): BookContentResponse {
    // h1 章节名 / <article id="read-article"> 正文
    // 正文清洗：stripTags + escapeHtml + 章节内链接转 /book/:cid?site=2&chapter=:n
    // 返回 { title, content, chapterIndex, prevChapter, nextChapter, meta }
  }

  /** 首页/最新列表：mtid=0 返回首页精选，mtid=N 返回 /novels/N */
  async fetchHomeLinks(mtid: string): Promise<HomePage> {
    // 第一页拼首页，抓精选小说卡 + 15 个标签
    // 后续页 /novels/{mtid}，解析小说卡 → ChapterLink[]
    // nextMtid：取最后一页是否有"下一页"链接，推进游标
  }

  /** 从首页抽 15 个标签 → CategoryLink[]（kind="type"，label 用中文标签名）*/
  extractCategoryLinks(html: string): CategoryLink[] { ... }

  /** 标签筛选：query.type = tag slug，page 从 1 起，URL /tag/{slug}/{page} */
  async fetchCategoryPage(query: CategoryQuery, page: number): Promise<CategoryPage> {
    // 解析小说卡列表 + 下一页游标（page+1 是否存在）
  }

  // —— 以下方法 xbookcn 不支持，统一抛 404 ——
  extractGoldLinks(): ChapterLink[]      { throw notSupported("gold links") }
  extractHotPosts(): HotPost[]           { throw notSupported("hot posts") }
  extractCmtRankPosts(): CmtRankPost[]   { throw notSupported("comment rank") }
  extractRecommendSections(): RecommendSection[] { throw notSupported("recommend sections") }
  fetchReplies(): Promise<ReplyNode[]>   { throw notSupported("replies") }
  fetchRepliesRaw(): Promise<string>     { throw notSupported("replies") }
  parseReplies(): ReplyNode[]            { throw notSupported("replies") }
}
function notSupported(what: string): ExtractorError {
  return new ExtractorError(`xbookcn does not support ${what}`, 404)
}
```

**正文清洗**（`extractChapter`）：xbookcn 正文在 `<article id="read-article">`，复用 core 层已有的 `escapeHtml`/`stripTags`/`decodeHtmlEntities`（从 `extractor.ts` 抽到共享工具）。正文里的 `/novel/{cid}/{n}` 链接转成站内 `/book/{cid}?site=2&chapter={n}`，其余外链剥离只留文字——与 cool18 的 `extractPreHtml` 安全策略一致。

### 3. Extractor 接口签名变更

`extractBookContent` 当前是 `extractBookContent(html: string): { title; content; meta }`。扩展为支持 xbookcn 的目录/章节二态：

```ts
// types.ts
export interface BookContentResponse {
  title: string
  content: string
  meta: BookMeta
  // —— xbookcn 扩展（可选，cool18 不填，行为不变）——
  intro?: string               // 作品简介（目录页）
  chapters?: ChapterLink[]     // 章节目录（目录页）
  chapterIndex?: number        // 当前章节号（章节正文页）
  prevChapter?: number         // 上一章（无则 undefined）
  nextChapter?: number         // 下一章（无则 undefined）
}

export interface Extractor {
  // ...
  extractBookContent(
    html: string,
    opts?: { chapter?: string }
  ): BookContentResponse
}
```

`Cool18Extractor.extractBookContent` 签名跟着加可选第二参 `opts?`，函数体内忽略它（cool18 一页一整本，无章节概念），返回值不变。现有调用 `extractor.extractBookContent(content.html)` 不需改。

`BookContentResponse` 从 types.ts 导出（当前是内联返回类型，提升为具名 interface 以便前端复用）。

### 4. 数据层：加 site 列

`packages/core/src/storage/db.ts` 的 DDL 与迁移：

```sql
-- items（favorites / tags 同理）
CREATE TABLE IF NOT EXISTS items (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  site TEXT NOT NULL DEFAULT '1',          -- 新增
  id   TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  read_progress REAL,
  PRIMARY KEY (site, kind, id)             -- 原 (kind, id)
);
```

**幂等迁移**（`openDatabase` 内，沿用现有"检测列是否存在"模式）：

```ts
// 三表各做一次：site 列不存在则 ADD COLUMN ... DEFAULT '1'
for (const table of ["items", "favorites", "tags"]) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === "site")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN site TEXT NOT NULL DEFAULT '1'`)
  }
}
```

`DEFAULT '1'` 让现有 cool18 数据自动回填。注意 SQLite 的 `ALTER TABLE ADD COLUMN` 无法加 `NOT NULL` 除非有 `DEFAULT`——此处满足。

**PK 变更不破坏现有库**：`CREATE TABLE IF NOT EXISTS` 对已存在的表不会改 PK，旧库的 PK 仍是 `(kind, id)`。这会导致旧库的 `(site, kind, id)` 约束弱于新库。接受这个差异（单用户本地库，数据完整性风险低）；如需严格，可在迁移里检测旧 PK 并重建表，但成本不值得。新库天然是 `(site, kind, id)`。

`packages/core/src/storage/store.ts` 所有方法加 `site: SiteId` 参数（默认 `'1'` 以兼容 cool18 单测）：

- `recordVisit(site, kind, id, title, url)` / `setProgress(site, kind, id, progress)` / `getState(site, kind, id)` / `addFavorite(site, kind, id, ...)` / `removeFavorite(site, kind, id)` / `deleteItem(site, kind, id)` / `deleteItems(site, items)` / `clearHistory(site?)` / `setTags(site, kind, id, tags)` / `deleteTag(site?, tag)`
- `listHistory(query)` / `listFavorites(query)` / `listByTag(query)` / `listTags(site?)` 的 query 加可选 `site` 字段；不传则跨站返回（个人区默认看全部）。
- `tagsFor(site, ids)` 聚合查询 JOIN 条件加 `AND site = ?`。
- 所有 SQL 的 `WHERE kind = ? AND id = ?` 变 `WHERE site = ? AND kind = ? AND id = ?`，PK 前缀匹配保持索引高效。

**`/api/me/*` API 层**：每个端点从 query/body 读 `site` 参数透传给 store。`PUT /api/me/favorites`、`PUT /api/me/tags`、`PUT /api/me/progress` 的 body 加 `site` 字段（可选，默认 `'1'`）。`DELETE /api/me/history?kind=&id=` 加 `&site=`。列表响应每条 item 多返回一个 `site` 字段，供前端区分。

### 5. API 层：site 参数贯穿

`apps/api/src/index.ts`：

- 所有 handler 顶部 `const site = url.searchParams.get("site") ?? undefined`，传给 `resolveSite(site)` 而非 `getExtractor("cool18")`。7 处写死调用全改。
- `handleBooks` 读 `chapter` 参数，传给 `extractor.extractBookContent(content.html, { chapter })`。cool18 extractor 忽略 chapter；xbookcn 据此区分目录/正文，且 `buildBookUrl` 在 chapter 存在时改用 `buildChapterUrl` 抓章节页。
- `handlePosts(tid)`（帖子正文，含回复树）：site=2 时 extractor 的 `extractContent`/`fetchRepliesRaw`/`parseReplies` 都抛 404，天然拦截。
- `handleHomeExtract` / `handleComments` / `handleTrending`：site=2 时对应方法抛 404，由全局 `toErrorResponse` 转成 `{error, 404}`。
- 缓存 key：`readContentCache`/`writeContentCache` 的 key 当前是 `tid`/`cid`。加 site 前缀防撞：`assertSafeId(\`${site}:${cid}\`)`。`assertSafeId` 已校验路径安全，冒号合法。

### 6. 前端：一套路由，site 参数贯穿

`apps/web/src/lib/routes.ts`：

- 新增 `SiteId` 类型和 `DEFAULT_SITE = "1"`、`SITES` 元数据（id → 显示名"论坛"/"书库"，用于切换器）。
- 所有路径帮助函数加 `site` 透传。例如：
  ```ts
  export function bookPath(cid: string, opts?: { site?: string; chapter?: string }): string {
    const params = new URLSearchParams()
    if (opts?.site && opts.site !== DEFAULT_SITE) params.set("site", opts.site)
    if (opts?.chapter) params.set("chapter", opts.chapter)
    const qs = params.toString()
    return `/book/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`
  }
  ```
  `readPath`/`browsePath`/`searchPath` 同理加 `site`（非默认站才带参数，URL 干净）。
- `NAV_ITEMS` 每项加 `sites: SiteId[]` 字段声明支持站点。`site=2` 时精华/扫文/评论/人气/搜索被过滤掉。
- 新增 `useSite()` hook（从 `useSearchParams` 读 `site`，默认 `'1'`）+ `<SiteSwitcher>` 组件（顶部 1↔2 切换，切换时更新 `?site=` 并重置页面状态）。

`apps/web/src/App.tsx` 路由表不变（路径结构未改，靠 query 区分）。各页面组件读 `useSite()`，调 API 时带 `site`。

`BookPage.tsx` 扩展为支持 xbookcn 的目录/章节二态：
- 无 `chapter` → 渲染目录（简介 + 章节列表，点章节点 `bookPath(cid, {site, chapter: n})`）。
- 有 `chapter` → 渲染章节正文（顶部"← 上一章 / 返回书页 / 下一章 →"导航，底部同样）。cool18（site=1）忽略 chapter，仍一页整本。
- 收藏/历史/进度仍记 cid 级（site=2 时进度表示"整本书读到哪章"，章内滚动位置不持久化——符合用户决策 3）。

`HomePage.tsx`：site=1 不变；site=2 渲染 xbookcn 首页（精选小说卡 + 标签入口）。

`CategoriesPage.tsx` / `BrowsePage.tsx` / `SearchPage.tsx`：site 参数透传。site=2 的 categories 渲染 15 个标签网格；browse 的 `type` 用 tag slug。

### 7. 测试

- **`xbookcn.test.ts`**（新建）：用抓取的真实 HTML 片段（已存 `/tmp`，搬到测试 fixtures）测 `extractToc`/`extractChapter`/`extractCategoryLinks`/`fetchCategoryPage`/`fetchHomeLinks`。重点 negative test：正文里外链剥离、章节内 `/novel/{cid}/{n}` 正确转站内链接、base64 cid 正确解析。
- **`store.test.ts`** 扩展：site 列的 CRUD、跨站隔离（同 cid 不同 site 不串）、listHistory 按 site 过滤、旧库迁移回填 `'1'`。
- **`sites.test.ts`**（新建）：`resolveSite`/`isValidSite`，未知 id 抛 400，默认值。
- **`extractor.test.ts`**：Cool18 的 `extractBookContent` 新签名（带 `opts`）回归——确认 opts 被忽略、返回值不变。

## 改动清单（按依赖顺序）

1. `packages/core/src/extractor/types.ts` — `BookContentResponse` 提为具名 interface + 扩展可选字段；`extractBookContent` 签名加 `opts`。
2. `packages/core/src/extractor/extractor.ts` — `Cool18Extractor.extractBookContent` 适配新签名（加 opts 忽略）；把 `escapeHtml`/`stripTags`/`decodeHtmlEntities` 抽到共享工具模块（如 `extractor/utils.ts`）供 xbookcn 复用。
3. `packages/core/src/extractor/utils.ts`（新建）— 共享清洗工具。
4. `packages/core/src/extractor/xbookcn.ts`（新建）— `XbookcnExtractor`。
5. `packages/core/src/extractor/sites.ts`（新建）— 站点注册表 + `resolveSite`。
6. `packages/core/src/extractor/index.ts` — 重导出新 API，`getExtractor` 转发 `resolveSite`。
7. `packages/core/src/storage/db.ts` — 三表加 site 列 + 幂等迁移。
8. `packages/core/src/storage/store.ts` — 所有方法加 site 参数。
9. `packages/core/src/storage/cache.ts` — cache key 加 site 前缀。
10. `apps/api/src/index.ts` — 7 处 `getExtractor("cool18")` → `resolveSite(site)`；`handleBooks` 读 chapter；`/api/me/*` 透传 site。
11. `apps/web/src/lib/routes.ts` — site 类型、SITES 元数据、路径函数加 site、NAV_ITEMS 加 sites 字段。
12. `apps/web/src/App.tsx` — （路由表本身可能不变，确认）。
13. `apps/web/src/components/site-switcher.tsx`（新建）+ `apps/web/src/hooks/use-site.ts`（新建）。
14. `apps/web/src/pages/BookPage.tsx` — 目录/章节二态。
15. `apps/web/src/pages/HomePage.tsx`、`CategoriesPage.tsx`、`BrowsePage.tsx`、`SearchPage.tsx` — site 透传。
16. `apps/web/src/components/site-header.tsx` — NAV_ITEMS 按 site 过滤 + 嵌入 SiteSwitcher。
17. `apps/web/src/components/me-item-card.tsx` 等 — 列表项透传 site、链接带 site 参数。

## 验证

```bash
bun run test          # 含新 xbookcn/store/sites 测试
bun run typecheck     # 全仓类型
bun run build         # 全仓构建
bun run dev           # 手动验证：site=2 首页/标签/目录/章节正文/收藏/历史/进度
```

手动验证清单（site=2）：
- [ ] 首页显示精选小说卡 + 标签入口，无限滚动加载 `/novels/N`
- [ ] 点标签进 `/browse?type=wife&site=2`，分页正常
- [ ] 点小说进目录页，章节列表完整，点章节进正文
- [ ] 章节正文"上一章/下一章"导航正确
- [ ] 收藏一本书 → 收藏列表可见，带 site=2 标识
- [ ] 历史记录到 cid 级，重新打开恢复到目录页（不持久化章内位置）
- [ ] site=2 时导航不出现精华/扫文/评论/人气
- [ ] 切回 site=1，所有 cool18 功能原样可用

## 风险与权衡

- **旧库 PK 不重建**：旧库迁移后 PK 仍是 `(kind, id)`，新库是 `(site, kind, id)`。单用户本地库可接受；`site` 列 + DEFAULT 保证数据不串。
- **`extractCid` 隐式依赖 bookview**（cool18 既有）：与本次改动无关，不修。
- **xbookcn 上游结构变更**：HTML 解析依赖 `<article id="read-article">`、`/novel/{cid}/{n}` 等约定，上游改版需更新解析。解析逻辑集中在一个文件，易定位。
- **网络可达性**：xbookcn.org 可能需 HTTPS_PROXY，与 cool18 同样走 `fetchUpstream`，复用现有代理配置。
