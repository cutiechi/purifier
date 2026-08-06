# 设计：增加 xbookcn.org 上游站点

- 日期：2026-08-06
- 状态：已确认，待实现（**全能力覆盖**：站上有的内容能力 Purifier 全支持）
- 修订：2026-08-06 — Chrome 实测后将搜索/热读榜/相关推荐/单篇纳入范围；并吸收 review Critical 项

## 背景与目标

当前应用只支持 cool18 一个上游。`Extractor` 接口已为多站点抽象，但 `getExtractor`（`packages/core/src/extractor/index.ts:7`）是硬编码 `case "cool18"` 单分支，API 层多处调用写死 `getExtractor("cool18")`，多站点扩展点未真正接通。

本次新增第二个上游 **xbookcn.org**（中文成人小说站，书籍/章节模型），并把「加一个站点」做成**纯增量操作**：注册一个 extractor + 分配一个 site id，不改路由结构、不碰现有 cool18 逻辑。

**范围原则（用户确认）**：**上游站上存在的内容能力，Purifier 全部支持**；仅排除上游不存在的模型（帖子跟帖、用户体系）以及 cool18 专属入口在 site=2 下的空壳。

## 用户决策（已确认）

1. **路由策略**：一套路由，`site` 参数贯穿前后端，不搞独立路由组。
2. **站点标识**：URL 上用**短数字 id**（`site=1` cool18、`site=2` xbookcn），不暴露站点名。cool18 是默认值，不传等同 `site=1`。
3. **数据粒度**：xbookcn 的历史/收藏/进度记到**书级（cid）**，章节不独立成 items 行。与 cool18 书库语义一致。
4. **数据隔离**：`items`/`favorites`/`tags` 三表加 **`site` 列**，PK 改为 `(site, kind, id)`。概念正交（kind=类型，site=站点），未来加第三站纯增量。
5. **前端入口**：xbookcn 作为**独立页面区**，导航按 site 动态渲染。
6. **内容范围（全覆盖）**：站上实测存在的能力全部做；见下表「能力矩阵」。
7. **上游不存在的能力**：帖子正文/跟帖、cool18 精华金贴、cool18 扫文推荐分区、评论榜 → extractor 抛 404，site=2 导航不暴露对应 cool18 专属入口。

## xbookcn.org 站点结构（Chrome 实测 2026-08-06）

UTF-8，路径式 URL（搜索用 query），无 `<pre>` 正文容器；正文在 `<article id="read-article">`。

| 页面 | URL | 结构 |
|---|---|---|
| 首页 | `/` | 统计；**时间线更新**小说卡；**今日热读榜**（约 12 条）；**有声小说**区块；**主题浏览**标签 |
| 最新列表 | `/novels` | 每页 24 条；分页：`/novels` 或 `/novels/1` 为第 1 页，`/novels/2`…；有「下一页」 |
| 标签页 | `/tag/{slug}` | 每页 24 条；第 1 页无数字后缀，第 2 页起 `/tag/{slug}/{N}` |
| 有声 | `/tag/audio`（导航）；首页「更多」偶见 `/tag/999`（同为有声列表） | 与普通标签相同的小说卡列表 |
| 搜索 | `/search?q={kw}&page={N}` | 每页 24 条；`page` query，第 1 页可省略 |
| 小说目录 | `/novel/{cid}` | cid 为 URL-safe base64（如 `MjI4NzE`、`OQ`）。h1 书名、作者、章数、字数、完读%、标签、简介、章节目录或「单篇」提示；**相关推荐**卡；推广外链需剥离 |
| 章节正文 | `/novel/{cid}/{n}` | h1 章名；`#read-article`；上一章/下一章/返回书页；推广外链需剥离 |
| 单篇 | 同上目录页 | 文案「该作品为单篇正文，无章节目录」；正文固定 `/novel/{cid}/1` |
| 联系 | `/contact` | 站方反馈页——**不做**（非内容能力） |
| 主题切换 | 前端按钮 | 用 Purifier 自有主题，不镜像 |

### 标签 slug（题材 + 有声）

| slug | 中文 |
|---|---|
| `wife` | 人妻女友 |
| `student` | 学生校园 |
| `anime` | 动漫游戏 |
| `celebrities` | 名人明星 |
| `fantasy` | 古典玄幻 |
| `family` | 家庭乱伦 |
| `group` | 多人群交 |
| `exposure` | 露出暴露 |
| `bdsm` | 强暴性虐 |
| `lgbt` | 同性主题 |
| `ntr` | 绿帽主题 |
| `boys` | 耽美小说 |
| `comic` | 漫画小说 |
| `audio` | 有声（导航入口；列表页也可用 `999`，解析时统一成 `audio` 展示即可） |

### 能力矩阵（site=2）

| 上游能力 | Purifier 支持 | 映射 |
|---|---|---|
| 首页时间线 | ✅ | `GET /api/posts?mtid=0&site=2` |
| 最新列表分页 | ✅ | `GET /api/posts?mtid=N&site=2`（见游标表） |
| 标签分类入口 | ✅ | `GET /api/categories?site=2` |
| 标签列表 | ✅ | `GET /api/browse?type={slug}&site=2&page=` |
| 关键词搜索 | ✅ | `GET /api/browse?q={kw}&site=2&page=` → 上游 `/search?q=&page=` |
| 今日热读榜 | ✅ | `GET /api/trending?site=2`（从首页解析热榜） |
| 有声分区 | ✅ | 标签 `audio`（与题材同一套 browse） |
| 书目录 | ✅ | `GET /api/books?cid=&site=2` |
| 章节正文 | ✅ | `GET /api/books?cid=&chapter=n&site=2` |
| 单篇正文 | ✅ | 目录无章节表；读 `chapter=1` |
| 相关推荐 | ✅ | 目录响应 `related: ChapterLink[]`（或同构书链） |
| 上一章/下一章 | ✅ | 响应 `prevChapter` / `nextChapter` + 前端导航 |
| 历史/收藏/用户标签/进度 | ✅ | `/api/me/*` + `site` 列（书级 cid） |
| 帖子 tid / 跟帖 | ❌ 上游无 | 404 + 导航不暴露 `/read` 入口（列表全进 `/book`） |
| cool18 精华金贴 | ❌ 上游无对等 | 404；导航不暴露「精华」 |
| cool18 扫文分区 | ❌ 上游无对等 | 404；导航不暴露「扫文」（相关推荐在书页内） |
| 评论榜 | ❌ 上游无 | 404；导航不暴露「评论」 |
| 联系反馈页 | ❌ 非内容 | 不做 |

**site=2 导航应出现**：首页、分类、搜索、人气（热读榜）、历史、收藏、标签。  
**site=2 导航隐藏**：精华、扫文、评论。（人气 = 今日热读榜，**保留**。）

## 架构总览

```
前端 URL                              API 路由                              Extractor
─────────                             ────────                              ─────────
/?site=2                              /api/posts?mtid=&site=2               首页/最新
/book/:cid?site=2&chapter=            /api/books?cid=&site=&chapter=        目录/章节
/categories?site=2                    /api/categories?site=2                标签入口
/browse?type=&site=2                  /api/browse?type=&site=2              标签列表
/search?q=&site=2                     /api/browse?q=&site=2                 关键词搜索
/trending?site=2                      /api/trending?site=2                  今日热读榜
/history /favorites /tags             /api/me/*                             跨站，列表项带 site
                                      /api/featured|picks|comments|posts?tid  site=2 → 404
```

三层改动：
1. **core 层**：`XbookcnExtractor` + `sites.ts`；`getExtractor` 接受可选 site id。
2. **数据层**：三表加 `site` 列；**迁移重建 PK** 为 `(site, kind, id)`（见 §4）。
3. **API/前端**：内容端点读 `site`；路径/导航/列表全链路透传；缓存 key 含 site + chapter。

## 详细设计

### 1. 站点注册表（core 层）

新建 `packages/core/src/extractor/sites.ts`：

```ts
import { Cool18Extractor } from "./extractor"
import { XbookcnExtractor } from "./xbookcn"
import { Extractor, ExtractorError } from "./types"

export type SiteId = "1" | "2" | string

interface SiteEntry {
  name: string
  getExtractor: () => Extractor
}

export const SITES: Record<string, SiteEntry> = {
  "1": { name: "cool18", getExtractor: () => new Cool18Extractor() },
  "2": { name: "xbookcn", getExtractor: () => new XbookcnExtractor() },
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

`getExtractor(id?: string)` 转发 `resolveSite`。调用点全部改为数字 id（从请求 `site` 读入）。不再支持 `getExtractor("cool18")` 按 name。

### 2. XbookcnExtractor 实现

新建 `packages/core/src/extractor/xbookcn.ts`。

```ts
export class XbookcnExtractor implements Extractor {
  name = "xbookcn"
  homeUrl = "https://www.xbookcn.org"

  buildUrl(_tid: string): string {
    // 无帖子模型；若被误调，由 extractContent 抛 404
    throw new ExtractorError("xbookcn does not support posts", 404)
  }
  buildBookUrl(cid: string): string {
    return `${this.homeUrl}/novel/${cid}`
  }
  /** 非接口成员：章节 URL */
  buildChapterUrl(cid: string, chapter: string | number): string {
    return `${this.homeUrl}/novel/${cid}/${chapter}`
  }

  extractContent(_html: string): ContentResponse {
    throw notSupported("posts")
  }

  /**
   * opts.chapter 缺省 → 目录页；给定 → 章节正文。
   * 单篇：目录无章节列表，仍可 chapter=1 取正文。
   */
  extractBookContent(html: string, opts?: { chapter?: string }): BookContentResponse {
    if (!opts?.chapter) return this.extractToc(html)
    return this.extractChapter(html, opts.chapter)
  }

  private extractToc(html: string): BookContentResponse {
    // h1 / 作者 / 字数 / 章数 / 简介 / 章节目录 or 单篇
    // related: 相关推荐 → ChapterLink[]（tid 字段复用为 cid，见 §列表模型）
    // meta.author
  }

  private extractChapter(html: string, chapter: string): BookContentResponse {
    // h1 章节名 / #read-article
    // 清洗：strip + escape；/novel/{cid}/{n} → /book/{cid}?site=2&chapter={n}
    // 外链（xchina.click 等）只留文字
    // prevChapter / nextChapter / chapterIndex
  }

  /**
   * 首页/最新列表游标（mtid 语义在 xbookcn 为页码，不是 cool18 的 tid 游标）：
   * - mtid=0 或空 → 抓首页 `/`，解析「时间线更新」卡片；nextMtid="1"
   * - mtid=n (n≥1) → 抓 `/novels/{n}`（实测 /novels/1 可用）；有「下一页」则 nextMtid=String(n+1)
   *
   * 首页时间线与 /novels/1 可能部分重叠，前端按 cid 去重即可。
   */
  async fetchHomeLinks(mtid: string): Promise<HomePage> { ... }

  /** 导航题材 + 有声 → CategoryLink[]；url 必须带 site=2 */
  extractCategoryLinks(html: string): CategoryLink[] {
    // url: `/browse?type=${slug}&site=2`
    // kind: "type"；label 用中文名
  }

  /**
   * type → /tag/{slug} 或 /tag/{slug}/{page}
   * keywords → /search?q=&page=  （搜索全支持）
   * page 从 1 起；page=1 时标签/最新不加数字后缀，搜索不带 page 或 page=1
   */
  async fetchCategoryPage(query: CategoryQuery, page: number): Promise<CategoryPage> { ... }

  /**
   * 今日热读榜：抓首页，解析「今日热读榜」12 条。
   * HotPost.tid 复用为 cid；reads 站上无确切数字时可填 0 或省略用 rank 即可。
   */
  extractHotPosts(html: string): HotPost[] { ... }

  // —— 上游无对等 ——
  extractGoldLinks(): ChapterLink[] {
    throw notSupported("gold/featured links")
  }
  extractCmtRankPosts(): CmtRankPost[] {
    throw notSupported("comment rank")
  }
  extractRecommendSections(): RecommendSection[] {
    throw notSupported("picks sections") // 相关推荐挂在书目录响应，不走 /api/picks
  }
  fetchReplies(): Promise<ReplyNode[]> {
    throw notSupported("replies")
  }
  fetchRepliesRaw(): Promise<string> {
    throw notSupported("replies")
  }
  parseReplies(): ReplyNode[] {
    throw notSupported("replies")
  }
}

function notSupported(what: string): ExtractorError {
  return new ExtractorError(`xbookcn does not support ${what}`, 404)
}
```

**正文清洗**：复用抽到 `extractor/utils.ts` 的 `escapeHtml` / `stripTags` / `decodeHtmlEntities`。策略与 cool18 一致：只保留站内 `/book/...` 链。

**列表模型（ChapterLink）**：不扩展类型。xbookcn 列表/热榜/相关推荐的 **cid 写入 `ChapterLink.tid` 字段**（复用既有 JSON）。前端约定：

```ts
// site === "2" → bookPath(link.tid, { site: "2" })
// site === "1" → readPath(link.tid)  // cool18 帖子列表
```

Browse/Home/Trending/Book related 一律遵守。文档与测试写死此约定。

### 3. Extractor 接口签名变更

```ts
export interface BookContentResponse {
  title: string
  content: string
  meta: BookMeta
  // xbookcn 扩展（可选，cool18 不填）
  intro?: string
  chapters?: ChapterLink[] // 目录；单篇时 [] 或 undefined，前端靠 singleShot/chapter 按钮
  singleShot?: boolean // 单篇无目录：true 时前端主 CTA「开始阅读」→ chapter=1
  chapterIndex?: number
  prevChapter?: number
  nextChapter?: number
  related?: ChapterLink[] // 相关推荐（目录页）
  // 可选展示：字数/章数文案，不强制
  wordCountLabel?: string
  chapterCount?: number
}

export interface Extractor {
  // ...
  extractBookContent(
    html: string,
    opts?: { chapter?: string }
  ): BookContentResponse
}
```

`Cool18Extractor.extractBookContent` 增加可选第二参并忽略。

`BookMeta` 可保持 `{ author }`；完读% 等若需要可进可选字段，非阻塞。

### 4. 数据层：加 site 列 + 重建 PK

**策略（相对旧版设计收紧）**：单用户本地库，迁移时**检测旧 PK 并重建三表**为 `(site, kind, id)`，避免 `ON CONFLICT(site, kind, id)` 在旧库炸。步骤：

1. `PRAGMA table_info` 无 `site` → `ADD COLUMN site TEXT NOT NULL DEFAULT '1'`。
2. 检测主键是否已含 `site`（或用 user_version / 标记表）；若否：
   - `CREATE TABLE items_new (... PRIMARY KEY (site, kind, id))`
   - `INSERT INTO items_new SELECT ... FROM items`（site 已 DEFAULT '1'）
   - 换表名；favorites / tags 同理。
3. 索引重建：`idx_items_visited` 等带 site 前缀可选。

`store.ts` 全部方法加 `site`（写路径必填；列表 query 可选 site，不传=跨站）。`ON CONFLICT(site, kind, id)`。JOIN / `tagsFor` key 含 site。

**章节访问与 recordVisit**：

- 请求带 `chapter` 时仍记 `(site, book, cid)` **一行**。
- **title** 优先用书名：章节响应可同时带 `bookTitle`（从章页「欲望夜」链或面包屑解析），无则不覆盖已有 title（SQL `title = COALESCE(NULLIF(excluded.title,''), items.title)` 或 API 层传入目录缓存的书名）。
- **url** 固定目录 URL `buildBookUrl(cid)`，不写章节 URL。
- `visit_count`：章节与目录访问都 +1 可接受（书级活跃度）。

**进度语义（拍板）**：

- 继续使用现有 `read_progress REAL`（0..1 **页内滚动**）。
- site=2：**仅章节正文页**启用 `useReadingProgress`；目录页不写进度。
- **不**把 progress 解释成「第 n 章」；重新打开历史默认进**目录页**（`bookPath(cid,{site})` 无 chapter）。若需「续读章节」作为后续增强，另开字段 `last_chapter`，不在本次范围。
- 与验证清单一致：章内滚动可恢复（同章再进时），跨会话从历史进书仍是目录。

### 5. API 层

- 所有内容 handler：`const site = url.searchParams.get("site") ?? undefined` → `resolveSite(site)`。
- **`handlePosts(tid)`**：site=2 时**短路 404**（不 `loadCachedReplies`、不抓 cool18）。仅 `mtid` 列表走 `fetchHomeLinks`。
- **`handleBooks`**：读 `chapter`；抓取 URL 为 `buildChapterUrl` 或 `buildBookUrl`；响应展开 `intro/chapters/related/prev/next/singleShot` 等。
- **`handleBrowse`**：`q` 走搜索；`type` 走标签。
- **`handleTrending`**：site=2 抓 `homeUrl`，`extractHotPosts`。
- **`handleComments` / featured / picks`**：site=2 随 extractor 404（或显式 404）。
- **`/api/me/*`**：query/body 透传 `site`（默认 `"1"`）；列表 item 返回 `site`；批量 delete 的 items 含 `site?`。

**缓存 key**（修正 review C1/C2）：

- **不要**把 `site:cid` 整串丢进现有 `assertSafeId`（仅 `[A-Za-z0-9]+`）。
- 方案：分层路径 + 分段校验：

```ts
// cache/{site}/book-{cid}.html          // 目录
// cache/{site}/book-{cid}-ch{n}.html    // 章节
// site / cid / chapter 各自 /^[A-Za-z0-9]+$/（cid base64 无 padding，实测符合）
```

或 id 编码为 `${site}_${cid}` / `${site}_${cid}_ch${n}`（下划线已在字母数字外则扩展 SAFE_ID 为 `/^[A-Za-z0-9_-]+$/`）。

`readContentCache` / `writeContentCache` 签名扩展 `site` + 可选 `chapter`。

### 6. 前端

#### routes / 导航

- `DEFAULT_SITE = "1"`，`SITES` 元数据（显示名：论坛 / 书库）。
- 路径助手：`bookPath` / `readPath` / `browsePath` / `searchPath` / `trending` 等，非默认 site 才写 `?site=`。
- `NAV_ITEMS` 加 `sites: SiteId[]`：
  - site=2：**首页、分类、搜索、人气、历史、收藏、标签**
  - 隐藏：精华、扫文、评论
- `useSite()` + `<SiteSwitcher>`：内容页切站 → `navigate({ pathname: "/", search: site=N })`；个人区保留 path，只改全局 site 上下文或筛选。

#### 列表链接

- `HomePage` / `BrowsePage` / `SearchPage` / `TrendingPage`：`site=== "2"` 时 `href={bookPath(id, { site })}`，否则 `readPath`。
- `MeItemCard`：带 `item.site`，`book` → `bookPath(id,{site})`，`post` → `readPath(id,{site})`。
- `CategoryGrid`：`CategoryLink.url` 已含 `site=2`，或渲染时强制拼 site。

#### BookPage

- 无 `chapter`：目录 UI（简介、章节列表、单篇 CTA、相关推荐网格）。
- 有 `chapter`：正文 + 上一/下一/回目录；启用滚动进度。
- 请求：`/api/books?cid=&site=&chapter=`；`ItemActions` / `useItemState` / progress **全部带 site**。

#### HomePage site=2

- 时间线小说卡 + 可选首页热读入口（或依赖导航「人气」）。
- 无限滚动：mtid 游标按 §2 表；按 cid 去重。

#### SearchPage

- site=2 **保留入口**；API 走 `/api/browse?q=&site=2`。

#### TrendingPage

- site=2 拉 `/api/trending?site=2`，卡片进 book。

### 7. 测试

- `xbookcn.test.ts`：fixtures 入库 `packages/core/src/extractor/fixtures/xbookcn/`（裁剪最小 HTML，勿整页大文件）。覆盖：
  - extractToc / 单篇 / extractChapter
  - 外链剥离、章内链改写
  - extractCategoryLinks（url 含 site=2）
  - fetchHomeLinks 游标语义（可用 stub fetch）
  - extractHotPosts
  - fetchCategoryPage 搜索 vs 标签 URL 拼装
- `store.test.ts`：site CRUD、隔离、迁移后 PK/ON CONFLICT
- `sites.test.ts`：resolve / 未知 id
- `extractor.test.ts`：cool18 新签名回归
- `cache.test.ts`：site + chapter 分文件不互盖

## 改动清单（按依赖顺序）

1. `types.ts` — `BookContentResponse` 扩展；`extractBookContent` opts
2. `extractor/utils.ts` — 共享清洗
3. `extractor.ts` — Cool18 适配；import utils
4. `xbookcn.ts` — 全能力实现
5. `sites.ts` + `index.ts`
6. `db.ts` — site 列 + **重建 PK** 迁移
7. `store.ts` + `types.ts`（ListItem.site）
8. `cache.ts` — site/chapter 路径
9. `apps/api/src/index.ts` — site 贯穿、books chapter、posts 短路、me 透传
10. `routes.ts` + `use-site` + `site-switcher`
11. 列表页 / BookPage / Trending / Search / Categories / Browse — site 与 book 链
12. `item-actions` / `use-reading-progress` / me 卡片 — site
13. `site-header` — NAV 按 site 过滤
14. 测试 + fixtures
15. 更新 `Agents.md` API 表：`site`、`chapter`、xbookcn 行为

## 验证

```bash
bun run test
bun run typecheck
bun run build
bun run dev
```

手动清单（site=2）：

- [ ] 首页时间线 + 无限滚动最新列表，点卡进**书**目录（不是 /read）
- [ ] 分类 14 题材 + 有声；browse 分页
- [ ] 搜索关键词有结果、分页
- [ ] 人气 = 今日热读榜，点进书
- [ ] 多章目录 + 章节正文 + 上下章 + 相关推荐
- [ ] 单篇：目录 CTA → chapter=1 正文
- [ ] 正文无站外推广链；章链带 site=2
- [ ] 收藏/历史书级；列表带 site；重新打开进目录
- [ ] 章节页滚动进度可恢复；目录不写脏书名
- [ ] 导航无精华/扫文/评论；有搜索/人气
- [ ] 切回 site=1，cool18 全功能正常

## 风险与权衡

- **ChapterLink.tid 复用 cid**：语义不纯，但零协议破坏；前端按 site 分支即可。
- **首页与 /novels/1 重叠**：前端去重。
- **推广 HTML 变体**：清洗集中在 extractChapter/extractToc；测 fixtures 含广告样本。
- **旧库迁移重建表**：短暂锁表，单用户可接受；比双 SQL 路径干净。
- **上游改版**：选择器依赖 h2「今日热读榜」等文案/结构，集中在 xbookcn.ts。
- **网络**：走既有 `fetchUpstream` / HTTPS_PROXY。

## 与 cool18 能力对照（实现检查用）

| Purifier 入口 | cool18 (site=1) | xbookcn (site=2) |
|---|---|---|
| 首页 | 主帖时间线 | 小说时间线 + 滚最新 |
| 分类 | 题材/栏目 | 题材标签 + 有声 |
| 搜索 | keywords browse | `/search?q=` |
| 人气 | hot 表 | 今日热读榜 |
| 精华 | gold | 隐藏 + 404 |
| 扫文 | recommend sections | 隐藏 + 404（相关推荐在书页） |
| 评论 | cmtrank | 隐藏 + 404 |
| 帖子/跟帖 | tid + replies | 无 |
| 书 | bookview 整本 | 目录 + 章节 |
| me/* | 有 | 有（多 site） |
