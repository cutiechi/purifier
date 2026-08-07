# 同书章节折叠（Book Folding）设计

- 日期：2026-08-07
- 状态：待评审
- 范围：`apps/web`（纯前端，不涉及 API / extractor / DB）

## 1. 背景与问题

Cool18（`site=1`）的内容以"帖子"为单位发布，同一本小说的不同章节往往是各自独立的主帖（各自 `rootid === "0"`），散落在首页时间线、分类浏览、精华、榜单、历史/收藏等列表里。当前每个帖子渲染成独立一行，无法识别"这些帖子属于同一本书"，更无法折叠。

调研结论（详见调研记录）：

- 列表项 `ChapterLink` 只有 `{ index, title, tid }`，**没有任何"同书"硬标识**。
- 上游 ajax 返回的 `rootid` 是"跟帖→根帖"的回复树语义，且已被 `fetchHomeLinks` 过滤；对"按书聚合"无用——同书不同章本就是各自独立的主帖。
- 详情页 `meta.parent/rootTid` 是评论回复树，不进列表，语义也不符。
- cool18 帖子 URL 里没有书 id；历史/收藏 DB 主键是单条级 `(site, kind, id)`，无书名列。
- **唯一可用的弱信号是标题文本**：`apps/web/src/lib/title-parse.ts` 的 `parseListTitle` 能从混合标题里拆出 `{ title, chapters, author, genre, ... }`，其中 `title` 字段是可靠的"书名"依据。目前它只用于渲染副标题，从未用于分组。

xbookcn（`site=2`）天生以 cid 聚合（`/novel/{cid}/{n}`），不存在此问题，本设计不处理。

## 2. 目标与非目标

### 目标

在 cool18（`site=1`）站点下，将标题"书名"字段相同的多个章节帖子，在列表里默认折叠成一组，点击头部展开看各章。覆盖页面：

- 首页时间线（`HomePage`）
- 分类/关键词浏览（`BrowsePage`）
- 精华（`FeaturedPage`）、扫文推荐（`PicksPage`，组内聚合）、人气榜（`TrendingPage`）、评论榜（`CommentsPage`）
- 我的：历史（`HistoryPage`）、收藏（`FavoritesPage`）、标签筛选（`MeItemsPage`）

### 非目标（YAGNI）

- 不做模糊/跨名合并、"系列"识别；`第三部` 等靠 `parseListTitle` 拆出的 `title` 字段同名才算同一本。
- 不改 extractor / API / DB schema。
- 不做用户手动"合并/拆开"操作（纯启发式，错并接受）。
- 不做章节区间排序展示。
- xbookcn（`site=2`）不处理。
- 不按 site 再细分持久化 scope（YAGNI，撞名概率极低）。

## 3. 分组判定

### 判定依据

用 `parseListTitle(rawTitle).title` 作为分组键的来源。同名（归一化后相等）且出现 ≥2 条 → 折叠成一组；单条 → 照旧独立渲染。

### 归一化

```ts
function normalizeTitleKey(title: string): string {
  return title
    .replace(/^[《【［[]+|[》】］\]]+$/g, "") // 去首尾书名号/方括号包裹
    .trim()
    .toLowerCase()
}
```

目的：避免 `【XX】` 和 `XX`、`《XX》` 和 `XX` 因包裹符不同被拆成两组。全角/半角数字等更深的归一化暂不做（YAGNI）。

### 误并接受

两个不同作者写了同名短文（如都叫"日记"）会被并成一组。这是"仅书名、不做手动纠正"选择的既定代价，不设安全阈值（用户已确认不设阈值）。

### 边界

- 只对 `site === "1"` 且（历史/收藏场景下）`kind === "post"` 的项分组；xbookcn 与 `kind === "book"` 一律走 `single`，不参与聚合。
- `parseListTitle` 解析失败时 `title` 兜底返回 `raw.trim()`（已有逻辑），这类项各自 title 基本不同，自然全部 `single`，不会被错误合并。
- `normalizeTitleKey` 结果为空串的项（全标点/空标题），一律 `single`，避免所有空标题被并成一组。

## 4. 数据流与分组逻辑

### 新文件 `apps/web/src/lib/book-groups.ts`

纯函数，不依赖 React，可单测。

```ts
export type GroupedItem<T> =
  | { type: "single"; item: T }
  | { type: "group"; key: string; title: string; items: T[] }

export function normalizeTitleKey(title: string): string

export function groupBooks<T>(
  items: T[],
  getTitle: (item: T) => string,
  getId: (item: T) => string,
): GroupedItem<T>[]
```

### 算法（稳定，保留首次出现顺序）

1. 第一遍遍历：对每个 item，`key = normalizeTitleKey(parseListTitle(getTitle(item)).title)`，空串 key 的项直接标记为 single，不进 Map。其余进 `Map<key, T[]>`，并记录每个 key 的**首次出现顺序**与**展示用 title**（取首次出现的解析结果）。
2. 第二遍按首次出现顺序输出：key 对应数组长度 ≥2 → `group`（`items` 按原始列表顺序）；=1 → `single`。每个 key 只输出一次。

### 接入位置（渲染层 `useMemo`）

分组在渲染层做，不在数据获取层。以首页为例：

```ts
const grouped = useMemo(
  () => groupBooks(links, (l) => l.title, (l) => l.tid),
  [links],
)
```

首页的 `links` 是无限滚动累积的完整数组（`setLinks(prev => [...prev, ...new])`），分组天然在累积结果上做——同一本书的两章即便分属不同加载批次也会被正确合并，无需改 `loadMore`。

## 5. UI 组件

### 新组件 `apps/web/src/components/collapsible-book-group.tsx`

职责单一：默认折叠、点击头部展开/折叠、展开状态持久化。不关心数据来源。

```ts
function CollapsibleBookGroup({
  title,      // 书名（parseListTitle().title）
  summary,    // 头部副标题（作者等）
  count,      // 章节数
  bookKey,    // 持久化用归一化 key
  scope,      // 页面 scope
  trailing,   // 可选右侧元素（如题材胶囊）
  children,   // 展开后的各章卡片
}: { ... })
```

### 头部视觉

复用现有卡片风格（`rounded-2xl border border-border/80 bg-card/80`）：

- 左侧：书图标（`IconBookOpen`，已有）
- 中间：书名（主）+ 副标题（作者，可选）
- 右侧：可选 `trailing`（题材胶囊）+ `共 N 章` + 展开箭头（`IconChevronDown`，展开时旋转 180°）

整张头部用 `<button>` 包裹（a11y：`aria-expanded`），点击仅展开/折叠，不跳转。

展开后：头部下方平铺各章原卡片（`<ListPostCard>` / `<MeItemCard>` 等，带各自章节副标题）。展开用条件渲染 + 淡入，不做高度动画（求稳）。

### 折叠态头部展示

- 书名：`g.title`
- 章节数：`共 N 章`
- 作者：取组内第一个解析出 `author` 的项
- 题材胶囊：组内第一个有 `genre` 的项，照 `GenrePill` 风格放右侧

示例（折叠态）：

```
[📖] 马屌少年…            [都市]  共 5 章  ▾
     热爱生活的小东
```

### 榜单页特殊

人气榜/评论榜的组内各帖带 `rank`。折叠态头部**不显示单个 rank**（一本书不该占某个名次）；展开后各章仍带各自 rank。头部右侧 `trailing` 仍可放题材胶囊。

## 6. 展开状态持久化

### 新文件 `apps/web/src/hooks/use-collapsed-books.ts`

```ts
function useCollapsedBooks(scope: string): {
  isExpanded: (bookKey: string) => boolean
  toggle: (bookKey: string) => void
}
```

- 存储：`localStorage`，key = `purifier:expanded-books:<scope>`，值为 `string[]`（展开过的 bookKey 列表）。
- 默认折叠：不在数组中的 → 折叠；点开 → 加入；再点 → 移除。
- **scope 按页面隔离**：`"home"` / `"browse"` / `"featured"` / `"picks"` / `"trending"` / `"comments"` / `"history"` / `"favorites"` / `"me-items"`。不同页面互不干扰。
- `localStorage` 读取放 `useEffect`，避免 SSR/首屏不一致（本应用纯 SPA，仅为稳妥）。

## 7. 各页面接入

通用模式：列表渲染从 `items.map(item => <Card/>)` 改为对 `groupBooks(...)` 结果 map，`single` 走原卡片，`group` 走 `<CollapsibleBookGroup>` 包裹原卡片。

| 页面 | 文件 | 取标题 | scope | 备注 |
|---|---|---|---|---|
| 首页时间线 | `pages/HomePage.tsx` | `link.title` | `home` | 累积 `links` 上 `useMemo` 分组 |
| 分类浏览 | `pages/BrowsePage.tsx` | `link.title` | `browse` | 同首页模式 |
| 精华 | `pages/FeaturedPage.tsx` | `link.title` | `featured` | 同首页模式 |
| 扫文推荐 | `components/picks-sections.tsx` | `link.title` | `picks` | 每个 `RecommendSection` 内部分组 |
| 人气榜 | `pages/TrendingPage.tsx` | `post.title` | `trending` | 组内保留 rank；折叠头部不显 rank |
| 评论榜 | `pages/CommentsPage.tsx` | `post.title` | `comments` | 同人气榜 |
| 历史 | `pages/HistoryPage.tsx` | `item.title` | `history` | 仅 `kind==="post" && site==="1"` 参与 |
| 收藏 | `pages/FavoritesPage.tsx` | `item.title` | `favorites` | 同历史 |
| 标签筛选 | `pages/MeItemsPage.tsx` | `item.title` | `me-items` | 同历史 |

### 历史/收藏的关键差异

`MeItemCard` 的 `item.title` 对 cool18 post 就是章节标题，`parseListTitle` 同样适用。但 `MeListItem` 混了 `kind:"post"` 和 `kind:"book"`：分组前需**先过滤**，只对 `kind === "post" && site === "1"` 的项调 `groupBooks`，`kind === "book"`（含 xbookcn）的项直接当 `single` 与分组结果按原顺序合并输出。

## 8. 边界情况

1. 只聚合 cool18 帖子（`site=1` 且 `kind=post`）；xbookcn 与 book 不参与。
2. `parseListTitle` 解析失败的项，title 兜底为 `raw.trim()`，各自不同，自然全部 single。
3. `normalizeTitleKey` 结果为空串的项，一律 single。
4. 不设同名数量阈值（用户确认），泛名撞车照折。
5. 首页无限滚动：新批次让原本 single 的项变 group（第二章加载到了），`useMemo` 自动重算，无需特殊处理。展开状态按 bookKey（书名归一化值）存，与 tid 无关，跨批次稳定。
6. 换站/重拉：`links` 清空，分组自动重算。展开状态 localStorage 跨站保留，但按页面 scope 隔离，撞名概率极低，可接受。

## 9. 测试与验证

### 单测（方案 A）

`apps/web` 当前无测试入口。改动：

- `apps/web/package.json` 加 `"test": "bun test"`（turbo `test` 任务 `dependsOn: ["^test"]` 会自动级联）。
- 新增 `apps/web/src/lib/book-groups.test.ts`，覆盖 `normalizeTitleKey` 与 `groupBooks`：
  - 同名不同章合并、单条不合并、空标题 single、保留首次出现顺序、`getId` 去重作用。

### 组件层

`<CollapsibleBookGroup>` 的展开/折叠 + 持久化靠手动验证。

### 验证命令

```bash
bun run test       # 含新增单测
bun run typecheck
bun run build
```

### 手动验证清单

- 首页：同名书两章分属不同加载批次 → 折成一组；点开展开各章；刷新记住展开
- 分类浏览：同上
- 榜单页：折叠态头部不显示单个 rank；展开后各章带 rank
- 历史：只对 cool18 post 分组；xbookcn book 不参与
- 换站：xbookcn 站点列表无折叠（全 single）
- 持久化隔离：首页展开的书，切到分类页仍默认折叠

## 10. 改动清单

### 新增

- `apps/web/src/lib/book-groups.ts` — `normalizeTitleKey`、`groupBooks`、`GroupedItem` 类型
- `apps/web/src/lib/book-groups.test.ts` — 单测
- `apps/web/src/components/collapsible-book-group.tsx` — `<CollapsibleBookGroup>`
- `apps/web/src/hooks/use-collapsed-books.ts` — `useCollapsedBooks`

### 修改

- `apps/web/package.json` — 加 `"test": "bun test"`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/BrowsePage.tsx`
- `apps/web/src/pages/FeaturedPage.tsx`
- `apps/web/src/components/picks-sections.tsx`
- `apps/web/src/pages/TrendingPage.tsx`
- `apps/web/src/pages/CommentsPage.tsx`
- `apps/web/src/pages/HistoryPage.tsx`
- `apps/web/src/pages/FavoritesPage.tsx`
- `apps/web/src/pages/MeItemsPage.tsx`

### 不改

- API（`apps/api`）、extractor（`packages/core`）、DB schema、上游请求逻辑
