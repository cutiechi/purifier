# 跨站合并搜索设计

日期：2026-08-14
状态：已确认

## 目标

搜索页去掉「论坛 / 书库」两个站点 Tab，改为一个搜索框同时搜索两站；结果合并为一条列表，每项带来源标签（论坛 / 书库），每页内按标题排序。

## 现状

- `/search` 页：搜索框 + `PageSiteTabs`（论坛/书库）+ 按站调 `/api/browse?q=&site=&page=`。
- `/api/browse`：按 `site` 解析单个 extractor，调 `fetchCategoryPage({ keywords: q }, page)`。
- cool18（site 1）搜索：`?act=threadsearch&app=forum&keywords=...`，解析 `ul.thread-list li.l-m1 a`。
- xbookcn（site 2）搜索：`/search?q=...`，解析小说卡片。
- 两站返回同一模型 `CategoryPage { category, links: ChapterLink[], nextPage }`；`ChapterLink = { index, title, tid }`，其中 `title` 是**上游原始标题**（未 parse）。
- 前端：论坛结果按书名折叠分组（`groupBooks`），书库结果单条；链接目标 `readPath(tid, site)`（论坛）/ `bookPath(tid, site)`（书库）。

## 方案（已选）

新增 `/api/search` 端点，服务端并行抓两站、合并、排序；`/api/browse` 保持单站语义不动。

## API

`GET /api/search?q=&page=`

- 校验：`q` 必填（trim 后非空）、≤200 字；`page` ≥1。
- 并发：`Promise.allSettled` 并行调 `resolveSite("1")` / `resolveSite("2")` 的 `fetchCategoryPage({ keywords: q }, page)`。两个 extractor 零改动。
- 缓存：键 `search:${q}:${page}`，复用 `getListMemCache` / `setListMemCache`，`LIST_CACHE_HEADERS`（s-maxage=60）。
- 失败降级：一站失败仍返回另一站结果，`errors: { "1": "..." }` 携带失败站点信息；两站都失败 → 502（取第一个错误信息）。
- 响应：

```ts
interface MergedSearchItem {
  site: "1" | "2"
  kind: "post" | "book" // site 1 → post，site 2 → book
  link: ChapterLink
}
interface MergedSearchPage {
  items: MergedSearchItem[]
  nextPage: number | null // 两站任一有下一页 → page+1
  errors?: Record<string, string>
}
```

### 合并纯函数（packages/core/src/extractor/merge-search.ts）

```ts
export function searchSortKey(title: string): string
// 剥首尾括号装饰（【】《》「」等）+ 尾随章节标记；空标题兜底原样返回

export function mergeSearchPages(
  site1: { page: CategoryPage | null; error?: string },
  site2: { page: CategoryPage | null; error?: string }
): MergedSearchPage
```

- 排序：`new Intl.Collator("zh", { numeric: true })` 按 `searchSortKey(link.title)` 升序。
- 排序键规范化理由：`link.title` 是上游原文，直接排会让「【X】」类标题（U+3010）乱序，且与前端 `parseListTitle` 显示的主标题不一致。
- 平局：稳定排序，输入顺序 site1 先于 site2 → 同标题论坛在前。
- 跨站同名不同 id：都保留，不合并去重（内容不同）。

## 前端

### SearchPage.tsx

- 去掉 `PageSiteTabs` 与 `useSite` 依赖；搜索忽略 `?site=`。
- 改调 `${api.search}?q=&page=`；`errors` 非空时列表上方显示一行非阻塞警告（如「书库搜索暂不可用：…」），另一站结果照常显示。
- 页头描述 `「q」· 第 N 页 · M 条`，M = 合并后长度；空态「没有找到「q」相关内容」；Pager 沿用现状。
- 保留 `useExpandedBooks("search")` 折叠状态。

### 展示单元纯函数（apps/web/src/lib/merge-search.ts）

```ts
type SearchUnit =
  | { type: "group"; site: "1"; key: string; title: string;
      items: ChapterLink[]; author: string | null; genre: string | null }
  | { type: "single"; site: "1" | "2"; kind: "post" | "book"; link: ChapterLink }

export function buildSearchList(items: MergedSearchItem[]): SearchUnit[]
```

- 论坛条目按归一化书名分组（≥2 条成组），书库条目始终单条。
- 组头锚定在组内首成员的服务端排序位置；书条目插在各自排序位置。
- 覆盖场景：书条目排在两个同键论坛条目之间时，论坛条目仍归一组、书条目独立插在中间。

### 来源标签

- `SourceBadge` 组件：SearchPage 文件内局部实现，样式对齐 `GenrePill`；论坛 = 中性色，书库 = 强调色。
- 书库单条：`ListPostCard` 的 `trailing` 插槽放标签（自动与题材胶囊并排）。
- 论坛单条：`SimilarPostCard` 增加可选 `badge?: ReactNode` prop，与相似触发器并排（共享组件约 +5 行，唯一消费者）。
- 论坛组：`CollapsibleBookGroup` 的 `trailing` 放「题材胶囊 + 标签」。

### routes.ts

- `api.search = "/api/search"`。
- `searchPath` 去掉 `site` 参数（唯一调用方是 SearchPage 的 `goTo`）。

### site-header.tsx

不动。导航到 `/search` 携带的 `?site=` 被搜索页忽略，无副作用。

## 不改的部分

- 两个 extractor 与 `extractor.test.ts`（搜索 URL/解析零改动）。
- `/api/browse` 与 BrowsePage（单站分类/栏目浏览保持原样）。
- 跨站同名不合并、不去重；不加来源筛选器（YAGNI）。

## 测试

- `packages/core/src/extractor/merge-search.test.ts`：
  - `searchSortKey`：剥装饰、剥尾随章节标记、空标题兜底、数字 numeric 排序（第 2 章 < 第 10 章）。
  - `mergeSearchPages`：两站合并、nextPage 取 OR、单站失败 errors 透传、两站全挂、平局论坛在前、跨站同名保留。
- `apps/web/src/lib/merge-search.test.ts`（对齐 book-groups.test.ts 模式）：
  - `buildSearchList`：书条目插在论坛组员之间、非相邻同键组员归组、组头 = 首成员位置、单条论坛不分组。

## 文档

- AGENTS.md API 表新增：`GET /api/search` | `q`、`page` | 跨站合并搜索 `{ items, nextPage, errors? }`。

## 验证

`bun run test` + `bun run typecheck` + `bun run build`；dev 起服务实际搜索一个词，确认两站混排、标签正确、翻页、单站故障警告。
