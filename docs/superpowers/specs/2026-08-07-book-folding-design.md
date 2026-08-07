# 同书章节折叠（Book Folding）设计

- 日期：2026-08-07
- 状态：待评审（v2，已据 review 修订）
- 范围：`apps/web`（纯前端，不涉及 API / extractor / DB）

## 1. 背景与问题

Cool18（`site=1`）的内容以"帖子"为单位发布，同一本小说的不同章节往往是各自独立的主帖（各自 `rootid === "0"`），散落在首页时间线、分类/关键词浏览、搜索、精华、榜单、历史/收藏等列表里。当前每个帖子渲染成独立一行，无法识别"这些帖子属于同一本书"，更无法折叠。

调研结论：

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
- 搜索（`SearchPage`）
- 精华（`FeaturedPage`）、扫文推荐（`PicksPage` 的 `PicksSections`，仅非 chip 路径）、人气榜（`TrendingPage`）、评论榜（`CommentsPage`）
- 我的：历史（`HistoryPage`）、收藏（`FavoritesPage`）、标签筛选（`TagsPage` 的 `TagItemsView`）——三者共用 `MeListPage` 组件

### 非目标（YAGNI）

- 不做模糊/跨名合并、"系列"识别；`第三部` 等靠 `parseListTitle` 拆出的 `title` 字段同名才算同一本。
- 不改 extractor / API / DB schema。
- 不做用户手动"合并/拆开"操作（纯启发式，错并接受）。
- 不做章节区间排序展示。
- xbookcn（`site=2`）不处理。
- 不按 site 再细分持久化 scope（撞名概率极低）。
- 分页跨页不合并（见 §4、§8）。

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

目的：避免 `【XX】` 和 `XX`、`《XX》` 和 `XX` 因包裹符不同被拆成两组。全角/半角数字等更深的归一化暂不做。

### 误并接受

两个不同作者写了同名短文（如都叫"日记"）会被并成一组。这是"仅书名、不做手动纠正"选择的既定代价，不设安全阈值。

### 边界

- 只对 `site === "1"` 且（历史/收藏场景下）`kind === "post"` 的项分组；xbookcn 与 `kind === "book"` 一律走 `single`，不参与聚合。
- `parseListTitle` 解析失败时 `title` 兜底返回 `raw.trim()`（已有逻辑），这类项各自 title 基本不同，自然全部 `single`。
- `normalizeTitleKey` 结果为空串的项（全标点/空标题），一律 `single`，避免所有空标题被并成一组。
- **已知限制**：`parseListTitle` 在章节与作者之间遇到短副标时会做 `title = \`${title} · ${midText}\``（title-parse.ts L137）。同书不同章若中段备注不同，归一化 key 会不同 → 不折叠。这与"只认 title 字段、不模糊合并"一致，验收时不视为 bug。

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
): GroupedItem<T>[]
```

> 不再接受 `getId` 参数：首页 `loadMore` 已按 `tid` 去重，其它列表无同 tid 双份，组内去重无实际作用（YAGNI）。

### 算法（稳定，保留首次出现顺序）

1. 第一遍遍历：对每个 item，`key = normalizeTitleKey(parseListTitle(getTitle(item)).title)`，空串 key 的项直接标记为 single，不进 Map。其余进 `Map<key, T[]>`，并记录每个 key 的**首次出现顺序**与**展示用 title**（取首次出现的解析结果）。
2. 第二遍按首次出现顺序输出：key 对应数组长度 ≥2 → `group`（`items` 按原始列表顺序）；=1 → `single`。每个 key 只输出一次。

### 分组作用域（关键：区分两种列表形态）

| 列表形态 | 页面 | 分组作用域 |
| --- | --- | --- |
| 无限滚动累积 | 首页（`links` 跨 `loadMore` 批次累积） | 累积后的完整数组 |
| 分页（每页替换） | Browse / Search / 历史 / 收藏 / 标签筛选 | **仅当前页** |
| 单次拉取 | 精华 / 榜单 / Picks 单个 section | 当前结果集 |

**除首页外，分组仅在当前渲染数组内进行。** 同书两章若分属历史第 1 页与第 2 页，不会折成一组——这是接受的限制。

### 接入位置（渲染层 `useMemo`）

分组在渲染层做，不在数据获取层。**必须带 `site !== "1"` 短路**，否则 xbookcn 也会被标题启发式误折：

```ts
const grouped = useMemo(() => {
  if (site !== "1") {
    return links.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(links, (l) => l.title)
}, [links, site])
```

首页的 `links` 是无限滚动累积的完整数组，分组天然在累积结果上做——同一本书的两章即便分属不同加载批次也会被正确合并，无需改 `loadMore`。

Picks 的 `readPath(link.tid)` 无 site 参数，默认按 cool18 处理，无需短路。

## 5. UI 组件

### 新组件 `apps/web/src/components/collapsible-book-group.tsx`

职责单一：默认折叠、点击头部展开/折叠。**不直接读写 localStorage，展开状态经 props 传入**（避免多实例各自写 localStorage 互相覆盖，见 §6）。

```ts
function CollapsibleBookGroup({
  title,       // 书名（parseListTitle().title）
  summary,     // 头部副标题（作者等）
  count,       // 章节数
  bookKey,     // 归一化 key（用于 isExpanded 查询 + 列表 key）
  isExpanded,  // 由页面层 hook 提供
  onToggle,    // 由页面层 hook 提供
  trailing,    // 可选右侧元素（题材胶囊）
  children,    // 展开后的各章卡片
}: { ... })
```

### 头部视觉

复用现有卡片风格（`rounded-2xl border border-border/80 bg-card/80`）：

- 左侧：书图标（`IconBookOpen`，已有）
- 中间：书名（主）+ 副标题（作者，可选）
- 右侧：可选 `trailing`（题材胶囊）+ `共 N 章` + 展开箭头（`IconChevronDown`，**需新增**，见 §10；展开时旋转 180°）

整张头部用 `<button>` 包裹，点击仅展开/折叠，不跳转。

### a11y

- 按钮 `aria-expanded={isExpanded}` `aria-controls={contentId}`
- 展开区域 `<div id={contentId} role="region">`
- 列表中的 key 用 `group:${bookKey}`，避免与 tid key 冲突

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

展开用条件渲染 + 淡入，不做高度动画（求稳）。

### 展开后子卡

- **列表帖路径**（`ListPostCard`）：各章原卡片，主标题是书名、副标题含章节/作者——天然不冗余。
- **Me 路径**（`MeItemCard`）：`MeItemCard` 原样展示完整 `item.title`，组头已是书名时会重复。组内 Me 子卡改为用 `parseListTitle` 拆出的 `chapters`/`formatTitleMeta` 作主/副标题，避免重复。具体：给 `MeItemCard` 增加可选 `titleOverride`/`subtitleOverride` props，组内渲染时传入解析结果。

### 榜单页特殊

人气榜/评论榜的组内各帖带 `rank`。折叠态头部**不显示单个 rank**；展开后各章仍带各自 rank。头部右侧 `trailing` 仍可放题材胶囊。

## 6. 展开状态持久化

### 新文件 `apps/web/src/hooks/use-expanded-books.ts`

```ts
function useExpandedBooks(scope: string): {
  isExpanded: (bookKey: string) => boolean
  toggle: (bookKey: string) => void
}
```

> 命名统一为 **expanded**（与 storage key `expanded-books` 一致），不用 collapsed，避免默认折叠/展开语义搞反。

### 所有权：页面/列表层单例（关键）

**每个页面（或 `MeListPage` / `PicksSections`）调用一次** `useExpandedBooks(scope)`，把 `isExpanded` / `toggle` 经 props 传给各 `<CollapsibleBookGroup>`。组件本身不挂 hook。

若每个 group 实例各自挂 hook，同一页 N 个组就有 N 份 React state，各自持有"展开 key 数组"拷贝，写入会互相覆盖（组 A 写 `["book1"]`，组 B 仍持旧的 `[]` 写 `["book2"]` 抹掉 book1）。

### 存储

- `localStorage`，key = `purifier:expanded-books:<scope>`，值为 `string[]`（展开过的 bookKey 列表）。
- 默认折叠：不在数组中的 → 折叠；点开 → 加入；再点 → 移除。
- **scope 按页面隔离**：`home` / `browse` / `search` / `featured` / `picks` / `trending` / `comments` / `history` / `favorites` / `me-items`。

### 健壮性

- 读写均 `try/catch`（隐私模式/配额），与同仓 `reading-settings.tsx` 一致。读失败当默认全折叠，写失败静默，内存态仍可切换。
- 首屏渲染前 `localStorage` 未 hydrate → 全折叠，`useEffect` 读入后更新。已展开组较多时可能首帧闪一下，纯 SPA 可接受。

## 7. 各页面接入

通用模式：列表渲染从 `items.map(item => <Card/>)` 改为对 `groupBooks(...)` 结果 map（带 `site !== "1"` 短路），`single` 走原卡片，`group` 走 `<CollapsibleBookGroup>` 包裹原卡片。页面层调用一次 `useExpandedBooks(scope)`。

| 页面 | 实际改动文件 | 取标题 | scope | 备注 |
|---|---|---|---|---|
| 首页 | `pages/HomePage.tsx` | `link.title` | `home` | 无限滚动累积数组上分组 |
| 分类浏览 | `pages/BrowsePage.tsx` | `link.title` | `browse` | **分页，仅当前页**分组 |
| 搜索 | `pages/SearchPage.tsx` | `link.title` | `search` | 分页，仅当前页 |
| 精华 | `pages/FeaturedPage.tsx` | `link.title` | `featured` | 单次拉取 |
| 扫文推荐 | `components/picks-sections.tsx` | `link.title` | `picks` | **仅非 chip 的 PostList 路径**分组；chip 路径保持原样 |
| 人气榜 | `pages/TrendingPage.tsx` | `post.title` | `trending` | 组内保留 rank；折叠头部不显 rank |
| 评论榜 | `pages/CommentsPage.tsx` | `post.title` | `comments` | 同人气榜 |
| 历史 | `pages/HistoryPage.tsx` 传 scope → `components/me-list-page.tsx` | `item.title` | `history` | 见下方 Me 说明 |
| 收藏 | `pages/FavoritesPage.tsx` 传 scope → `components/me-list-page.tsx` | `item.title` | `favorites` | 见下方 Me 说明 |
| 标签筛选 | `pages/TagsPage.tsx` 传 scope → `components/me-list-page.tsx` | `item.title` | `me-items` | 见下方 Me 说明 |

### Me 列表接入（关键：接入点在 `MeListPage`）

`HistoryPage` / `FavoritesPage` / `TagsPage` 的列表渲染**全部在 `components/me-list-page.tsx`**（`items.map` → `<MeItemCard>`）。这三个 Page 只负责 `buildUrl` / toolbar / trailing，不渲染列表。

改动集中在 **`me-list-page.tsx` 一处**：

- 新增可选 prop `bookGroupScope?: string`。传入时启用分组，不传则保持原样（向后兼容）。
- 在该组件内调用 `useExpandedBooks(bookGroupScope)`、对 `items` 做 `groupBooks`。
- `HistoryPage` / `FavoritesPage` / `TagsPage` 只需把对应 scope 传进去，不各自实现分组。
- `kind === "post" && site === "1"` 才参与分组；`kind === "book"` 直接 single。组内 Me 子卡用解析后标题（§5）。

可在 `book-groups.ts` 提供共享函数 `groupMeListItems(items)`，封装"book 项直通 single、post 项按 title 分组、保持原序 interleave"逻辑，避免分散。

### Picks 接入（关键：仅 PostList 路径）

`PicksSections` 对每个 `PickSection` 有两条路径：

- `sectionUsesChips(section)` 为真 → chip 网格（年份/序号/短标签），**保持原样，不分组**（按书名折叠无意义且破坏布局）。
- 否则 → `PostList` 路径，**仅此路径**做 `groupBooks`。

组件名对齐代码：`PicksSections` / `PickSection`（非 `RecommendSection`）。`useExpandedBooks("picks")` 在 `PicksSections` 层调用一次。

## 8. 边界情况

1. 只聚合 cool18 帖子（`site=1` 且 `kind=post`）；xbookcn 与 book 不参与。
2. `parseListTitle` 解析失败的项，title 兜底为 `raw.trim()`，各自不同，自然全部 single。
3. `normalizeTitleKey` 结果为空串的项，一律 single。
4. 不设同名数量阈值，泛名撞车照折。
5. 首页无限滚动：新批次让原本 single 的项变 group，`useMemo` 自动重算。展开状态按 bookKey 存，与 tid 无关，跨批次稳定。
6. 换站/重拉：列表清空，分组自动重算。展开状态 localStorage 跨站保留，但按页面 scope 隔离，撞名概率极低。
7. **分页页（Browse/Search/历史/收藏/标签）跨页不合并**：同书两章分属不同页时各自独立显示。接受的限制。
8. **列表计数文案保持原始 item 数**（帖数），不改为 group 数——首页"已载入 N 条"等仍用 `links.length`，与无限滚动语义一致。

## 9. 测试与验证

### 单测

`apps/web` 当前无测试入口。改动：

- `apps/web/package.json` 加 `"test": "bun test"`（turbo `test` 任务 `dependsOn: ["^test"]` 会自动级联，与根 `turbo.json` 一致）。
- 新增 `apps/web/src/lib/book-groups.test.ts`，覆盖：
  - `normalizeTitleKey`：`《X》` / `【X】` / `［X］` / `[X]` / `X` 归一为同一 key
  - 同名不同章 → 合并为 group；单条 → single
  - 空标题/全标点 → single，不并入同一组
  - 顺序：group 按首次出现位置排序；组内 items 按原始相对序
  - 多个不同 group 混排，互不串扰

组件/localStorage 靠手动验证。

### 验证命令

```bash
bun run test       # 含新增单测
bun run typecheck
bun run build
```

### 手动验证清单

- 首页：同名书两章分属不同加载批次 → 折成一组；点开展开各章；刷新记住展开
- 分类浏览：同书两章在同一页 → 折叠；分属不同页 → 各自独立（验证跨页不合并）
- 搜索：同分类浏览
- 榜单页：折叠态头部不显示单个 rank；展开后各章带 rank
- 历史：只对 cool18 post 分组；xbookcn book 不参与；Me 子卡标题不与组头重复
- 换站：xbookcn 站点列表无折叠（全 single）
- 持久化隔离：首页展开的书，切到分类页仍默认折叠
- 持久化健壮性：硬刷新后展开态恢复（允许首帧折叠）

## 10. 改动清单

### 新增

- `apps/web/src/lib/book-groups.ts` — `normalizeTitleKey`、`groupBooks`、`GroupedItem` 类型、`groupMeListItems`
- `apps/web/src/lib/book-groups.test.ts` — 单测
- `apps/web/src/components/collapsible-book-group.tsx` — `<CollapsibleBookGroup>`
- `apps/web/src/hooks/use-expanded-books.ts` — `useExpandedBooks`

### 修改

- `apps/web/package.json` — 加 `"test": "bun test"`
- `apps/web/src/components/icons.tsx` — 补 `IconChevronDown`
- `apps/web/src/components/me-item-card.tsx` — 加可选 `titleOverride`/`subtitleOverride` props
- `apps/web/src/components/me-list-page.tsx` — 加 `bookGroupScope` prop + 分组接入
- `apps/web/src/components/picks-sections.tsx` — 仅 PostList 路径分组
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/BrowsePage.tsx`
- `apps/web/src/pages/SearchPage.tsx`
- `apps/web/src/pages/FeaturedPage.tsx`
- `apps/web/src/pages/TrendingPage.tsx`
- `apps/web/src/pages/CommentsPage.tsx`
- `apps/web/src/pages/HistoryPage.tsx` — 传 scope `"history"`
- `apps/web/src/pages/FavoritesPage.tsx` — 传 scope `"favorites"`
- `apps/web/src/pages/TagsPage.tsx` — 传 scope `"me-items"`

### 不改

- API（`apps/api`）、extractor（`packages/core`）、DB schema、上游请求逻辑
