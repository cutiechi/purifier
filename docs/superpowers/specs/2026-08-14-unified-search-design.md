# 跨站合并搜索设计

日期：2026-08-14
状态：已确认（含两轮 review 修正）

## 目标

搜索页去掉「论坛 / 书库」两个站点 Tab，改为一个搜索框同时搜索两站；结果合并为一条列表，每项带来源标签（论坛 / 书库），每页内按标题排序。

## 现状

- `/search` 页：搜索框 + `PageSiteTabs`（论坛/书库）+ 按站调 `/api/browse?q=&site=&page=`。
- `/api/browse`：按 `site` 解析单个 extractor，调 `fetchCategoryPage({ keywords: q }, page)`；结果缓存在进程内，键 `browse:${siteId}:${type ?? ""}:${q ?? ""}:${page}`（TTL 45s）。
- cool18（site 1）搜索：`?act=threadsearch&app=forum&keywords=...`，解析 `ul.thread-list li.l-m1 a`。
- xbookcn（site 2）搜索：`/search?q=...`，解析小说卡片。
- 两站返回同一模型 `CategoryPage { category, links: ChapterLink[], nextPage }`；`ChapterLink = { index, title, tid }`，其中 `title` 是**上游原始标题**（未 parse）。
- 前端已有通用分组函数 `groupMeListItems`（`book-groups.ts`）：仅 `kind === "post" && site === "1"` 的项按 `normalizeTitleKey(parseListTitle(title).title)` 全局成桶，其余直通 single，按原序 walk 发射（组头 = 首成员位置，书条目自然 interleave）。搜索合并列表正是这个形状。
- **`parseListTitle` 有两份且已分叉**：web `apps/web/src/lib/title-parse.ts` 是完整版（`_`/`★☆◇◆`/`[贺岁]`/迎新前缀、`「」`/`〖〗` 书名号、`作_者`/`by`/`ｂｙ` 作者格式、全角数字章节、`[小小书童_原创]` 作者提取）；core `packages/core/src/title-parse.ts` 是旧简版（缺上述全部）。「排序键与分组键同源」只有把 web 版整段收进 core 才成立。
- `normalizeTitleKey` / `stripTrailingChapterMarker` 只在 web `book-groups.ts`；`archive_auto_group.ts:12` 另有一份行为不同的本地拷贝（缺「」剥离与 `toLowerCase`）。`archive_auto_group.ts:3` 也从 core `title-parse` 导入 `parseListTitle`。
- `apps/web` 已依赖 `@workspace/core`（workspace:*）；core `package.json` exports 目前无 `./title-parse`。

## 方案（已选）

新增 `/api/search` 端点，服务端并行抓两站、合并、排序；`/api/browse` 保持单站语义不动。前置一步：标题解析管线收拢到 core（见下），否则服务端排序键与前端分组键在真实论坛标题上不一致。

## 标题管线收拢（packages/core）

1. **`parseListTitle` 整段搬家**：把 web `title-parse.ts` 全部内容（`ParsedTitle`、`parseListTitle`、`formatTitleMeta`、deprecated `parseFeaturedTitle`；文件无 import、自包含）搬进 `packages/core/src/title-parse.ts`，**替换** core 旧简版实现。
2. **导出**：`packages/core/package.json` exports 增加 `"./title-parse": "./src/title-parse.ts"`。
3. **web re-export**：`apps/web/src/lib/title-parse.ts` 改为 `export * from "@workspace/core/title-parse"`。web 侧 8 处调用点（book-groups / groups / list-post-card / me-list-page / favorited-group-card / similar-search-panel / ArchivePage / GroupPage）与 `title-parse.test.ts` 零改动。
4. **normalize 收拢**：`normalizeTitleKey` / `stripTrailingChapterMarker` 从 web `book-groups.ts` 移入 core `title-parse.ts`（采用 web 版语义：剥 `「《【〖［[」` 等首尾装饰、剥尾随章节标记、`toLowerCase`）；web `book-groups.ts` 改从 `@workspace/core/title-parse` 导入并继续 re-export（`groups.ts` 等既有导入不动）；`archive_auto_group.ts` 删本地拷贝、改从 `../../title-parse` 导入（自动获得完整 parser，是对齐而非回归，跑 `archive_auto_group.test.ts` 确认）。

## API

`GET /api/search?q=&page=`

- 校验：`q` trim 后必填非空、≤200 字；`page` ≥1。
- 并发：按 `Object.keys(SITES)`（`sites.ts` 注册表）遍历，并行调各站 `fetchCategoryPage({ keywords: q }, page)`。两个 extractor 零改动。kind 由表推导：`SITE_KIND: Record<SiteId, "post" | "book"> = { "1": "post", "2": "book" }`（未来加站需补表项）。
- 缓存（关键边界）：
  - **按站缓存成功的 `CategoryPage`**，键与 `handleBrowse` 同一条模板 `browse:${siteId}:${type ?? ""}:${q ?? ""}:${page}`（搜索时 type 段为空，实际键 `browse:1::q:1`；**不要省略空 type 段**，否则与 browse 错键、共享缓存落空）——同词先浏览后搜索不重复打上游。
  - **合并结果不缓存**：每页重建 = 每站 1 次内存命中 + 至多 1 次上游抓取，开销可忽略；一站失败（200 + `errors`）的半残页因此不会进任何缓存。
  - `q` 入键前 trim。
  - **`/api/search` 响应一律 `NO_STORE_HEADERS`**：合并页不进 CDN/浏览器缓存；带 `errors` 的 200 不会被 s-maxage 钉 60s。按站成功页仍在进程内 mem cache（45s），重复搜索服务端仍是内存命中。
- 失败降级：一站失败仍返回另一站结果，`errors: { [site]: "..." }`；两站全挂时按现有错误映射：全部为 `UpstreamTimeoutError` → 504，否则取第一份错误的 `ExtractorError.statusCode`（上游非 2xx 是 502）。
- 响应：

```ts
interface MergedSearchItem {
  site: "1" | "2" // SiteId
  kind: "post" | "book"
  link: ChapterLink
}
interface MergedSearchPage {
  items: MergedSearchItem[]
  nextPage: number | null // 任一站有下一页 → page+1
  errors?: Record<string, string>
}
```

### 合并纯函数（packages/core/src/extractor/merge-search.ts）

```ts
export function searchSortKey(title: string): string
// = normalizeTitleKey(parseListTitle(title).title)，与前端 groupKeyFromTitle 同一条管线

export function mergeSearchPages(
  results: Array<{ site: SiteId; page: CategoryPage | null; error?: string }>
): MergedSearchPage
```

- 排序：`new Intl.Collator("zh", { numeric: true })` 按 `searchSortKey(link.title)` 升序。排序键与分组键同源（同一份 parseListTitle + normalize）⇒ 同键条目排序后相邻，折叠组显示连续。
- 平局：稳定排序，输入顺序 = `SITES` 键序（site 1 先于 site 2）→ 同标题论坛在前。
- 组内章序不依赖跨条 sort key：沿用 `groupMeListItems` 的 id 数值升序。
- 跨站同名/同 id：不合并、不去重（内容不同；列表身份靠 site 区分）。

## 前端

### SearchPage.tsx

- 去掉 `PageSiteTabs`；搜索请求不携带 site。
- **`?site=` 只服务全站导航，不参与 `/api/search`**：`searchPath` 保持接受并回写 `site`（现状不变），顶栏 `navHref(routes.search, site)` 带来的 `?site=` 原样保留——用户在书库语境点搜索再提交，URL 仍是 `/search?q=…&site=2`，顶栏站点上下文不丢；`/api/search` fetch 只带 `q` + `page`。
- 改调 `${api.search}?q=&page=`；`errors` 非空时列表上方显示一行非阻塞警告（如「书库搜索暂不可用：…」），另一站结果照常显示。
- 页头描述 `「q」· 第 N 页 · M 条`，M = 合并后长度；空态「没有找到「q」相关内容」；Pager 沿用现状。`maxLength={40}` 保持不变（API 上限 200 不冲突）。
- 保留 `useExpandedBooks("search")` 折叠状态。

### 列表构建：复用 groupMeListItems，不新写分组

- `groupMeListItems` 入参收窄为 `Pick<MeListItem, "kind" | "site" | "id" | "title">[]`（`book-groups.ts` 一处改动；历史/收藏/标签调用方传完整 `MeListItem[]` 仍兼容，勿用 `as` 断言）。
- `apps/web/src/lib/merge-search.ts` 只放映射，不复制 walk/bucket 逻辑：

```ts
export function toMeListItems(
  items: MergedSearchItem[]
): Pick<MeListItem, "kind" | "site" | "id" | "title">[]
// 映射 { kind, site, id: link.tid, title: link.title }

export function mergeItemKey(item: { site: string; id: string }): string
// = `${site}:${id}`，React key 用；跨站同 tid 不撞
```

SearchPage：`groupMeListItems(toMeListItems(items))` 得展示单元；组头 `CollapsibleBookGroup`（题材胶囊 + `SourceBadge`，窄屏 `shrink-0`）、书单条 `ListPostCard`（`trailing` 放标签）、论坛单条 `SimilarPostCard` 加可选 `badge` prop（与相似触发器并排，共享组件约 +5 行，唯一消费者）。

- 渲染 key：单条/书条目用 `` `key={mergeItemKey(...)}` ``；折叠组沿用 `group:${key}`。
- `SourceBadge` 组件：SearchPage 文件内局部实现，样式对齐 `GenrePill`；论坛 = 中性色，书库 = 强调色。

### routes.ts

- `api.search = "/api/search"`。
- `searchPath` 签名不变（仍带 `site`）；`goTo` 继续传 `site`。

### site-header.tsx

不动。

## 不改的部分

- 两个 extractor 与 `extractor.test.ts`（搜索 URL/解析零改动）。
- `/api/browse` 与 BrowsePage（单站分类/栏目浏览保持原样）。
- 跨站同名不合并、不去重；不加来源筛选器（YAGNI）。
- 前端搜索框 `maxLength=40` 不变。
- web 侧 8 处 `@/lib/title-parse` 调用点不改（re-export 后同 API）。

## 测试

- `packages/core/src/extractor/merge-search.test.ts`：
  - `searchSortKey`：与 `book-groups.test.ts` 同源用例（书名号 `【X】`、作者后缀、`（完）`）；numeric 用留在 title 里的正文数字（`第2部` < `第10部`），章节标记已被 parse 剥离，不指望跨条 sort key 保留章序。
  - `mergeSearchPages`（假 `CategoryPage`）：两站合并、nextPage 取 OR（一站耗尽另一站还有 → 仍前进，后页只含一站条目）、单站失败 errors 透传、两站全挂、平局 site1 在前、跨站同 tid 两条都保留且 site 字段区分。
- `apps/web/src/lib/merge-search.test.ts`：
  - `toMeListItems` 映射字段正确（Pick 形状）；`mergeItemKey` 跨站同 tid 不撞（`1:12345` ≠ `2:12345`）。
  - **同键断言**：取 `title-parse.test.ts` 既有用例（`_` 前缀、`作_者`、`〖〗by`、`[小小书童_原创]` 等），断言 `searchSortKey(title) === groupKeyFromTitle(title)` —— 服务端排序键与前端分组键对真实标题同键。
  - 分组行为本身由既有 `book-groups.test.ts` 覆盖，不重测。
- 回归：`title-parse.test.ts`（re-export 后测 core 实现）、`book-groups.test.ts`、`archive_auto_group.test.ts`（normalize 收拢 + 完整 parser 对齐）。
- handler 行为（trim 空 `q` → 400、单站失败不 502、错误页不入缓存）按仓库「api 靠 core 纯函数单测 + 手测」惯例：核心逻辑已由上述单测表达，其余 dev 手测。

## 文档

- AGENTS.md API 表新增：`GET /api/search` | `q`、`page` | 跨站合并搜索 `{ items, nextPage, errors? }`（`NO_STORE`）。

## 验证

`bun run test` + `bun run typecheck` + `bun run build`；dev 起服务实际搜索一个词，确认：两站混排、标签正确、翻页、单站故障警告、跨站同 id 两条都渲染、从书库语境进搜索提交后 `?site=` 不丢。
