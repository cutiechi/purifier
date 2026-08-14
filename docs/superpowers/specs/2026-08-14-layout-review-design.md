# 布局与交互审查改版设计

日期：2026-08-14
状态：已脑爆认可 + grok review 修订（NEEDS_CHANGES 13 条已逐条落实），待实施
路线：按 grok 审查优先级 1→6 逐项落地（用户选定 B 路线）

## 背景

Purifier 是 Cool18 净化阅读器（Bun workspace monorepo：`apps/api` + `apps/web` Vite/React 19/Tailwind 4/React Router 7）。grok 对线上各页做了布局与交互审查，给出 6 条结论与建议优先级。本文档为逐项设计，已按源码行号核实并经 review 修订。

**脑爆澄清结论**：
- 使用场景：手机 + 桌面对半，两边都不能妥协。
- 「搜索相似」使用频率：不清楚，按默认处理（保留图标入口、隐藏文字）。
- 章节导航：按推荐做论坛侧轻量底栏。

## 审查结论核对（实现前提，已核实）

| grok 结论 | 代码事实 | 影响 |
|---|---|---|
| 导航 < lg 汉堡横滑 | `site-header.tsx` 用 `overflow-x-auto`，断点 `lg` | 属实 |
| 发现/我的 Tab 两行 | 发现页 4 栏目页 = `PageSiteTabs` + `SectionTabs` 两行；**「我的」页只有一行**（`MeListPage` 无站点 Tab，跨站默认） | 范围修正：「我的」无需改 |
| 统计/任务/目录窄 | `PageShell` 默认 `max-w-3xl`，无 5xl 档 | 属实 |
| 热力图只 hover | `stats-heatmap.tsx` 仅 `onMouseEnter/Leave` | 属实 |
| 相似搜索空结果无下一步 | `SimilarSearchPanel` 无「去搜索页」引导 | 属实 |
| 阅读无章节底栏 | 论坛 `ReadPage` 无；**书库 `BookPage` 已有内联 prev/next**（`prevChapter/nextChapter`） | 范围修正：底栏只做论坛侧 |
| 论坛 links 的 index 语义 | `extractor.ts:110-127`：去重后**按 tid 数值排序**，`index` 重赋为 1-based 排序下标，**当前帖 tid 不在列表**（扩展链接 = 其它帖） | index 不是章节号；links 整表不能当章节目录（review 中-1） |
| 题材胶囊 | `formatTitleMeta` 已含 genre（`packages/core/src/title-parse.ts:238`） | 「胶囊进副标题」= 删 pill 分支 |
| 分页无跳转 | `Pager` 只有 `onPrev/onNext`，无页码回调 | 属实（review 高-3） |
| 返回无历史兜底 | `SiteHeader` showBack = 无条件 `navigate(-1)`（`site-header.tsx:55-58`） | 属实 |
| 发现页跨站降级 | `FeaturedPage:51-53` / `PicksPage:27-29` / `CommentsPage:48-50`：`site !== "1"` 已 `<Navigate to={/trending?site=…} replace />` | `/featured?site=2` 不会落空榜（review 中-2） |
| 越界 clamp 现状 | `me-list-page.tsx:112-118`、`BookmarksPage:174-180`、`GroupPage:395-396`、`JobsPage:107-108` 已有；`ArchivePage` 缺 | 只补 Archive（review 低-3） |
| 阅读页底部占用 | `item-actions.tsx:124-128`：FAB `fixed right-4 z-50` + inline `calc(env(safe-area-inset-bottom,0px) + 1.25rem)`；`reading-progress` 进度条同用 safe-area | 底栏须避开 FAB、抄 calc 写法（review 中-7） |

## 设计（按 grok 优先级 1→6）

### 1. 手机导航（≤1h，低风险）

- **1a 汉堡内固定列数网格**：`site-header.tsx` 移动菜单由 `flex gap-1.5 overflow-x-auto` + `shrink-0` 改为 **`grid grid-cols-2 sm:grid-cols-4`**（写死列数，窄屏 2 列起步，杜绝 3+3+2 与横滑裁切）。8 项在 sm+ 为 4×2。
- **1a 补充：菜单外点击关闭**：现在只在 `pathname` 变化时 `setOpen(false)`。加遮罩（点击 `open` 状态下的全屏透明层）或菜单外点击关闭。
- **1c 断点提前 md**：桌面横排 `lg:flex → md:flex`，汉堡按钮 `lg:hidden → md:hidden`。md 下收紧 `px-2.5 → px-2`。
- **可选（后置）1b 底部 Tab bar**：首页/目录/发现/我的 + 更多抽屉。需要 `NAV_ITEMS` 分组（`lib/routes.ts`）、active 匹配改造、抽屉组件、阅读页隐藏逻辑。结构性改动，不在本轮。

涉及文件：`apps/web/src/components/site-header.tsx`
风险：低。md 断点验收见下方「验证方式」（768/820 两档写死）。

### 2. 站点 Tab 按需出现（≤1h，低风险）

论坛专属发现页的站点 Tab 没有可切换对象，去掉后少一行：

- `FeaturedPage` / `PicksPage` / `CommentsPage` → **`<PageSiteTabs sites={["1"]} hideWhenSingle />`**。`hideWhenSingle` 必须显式传（`page-site-tabs.tsx` 默认 `false`，只传 `sites={["1"]}` 仍渲染单个「论坛」胶囊，见 `GroupPage.tsx:434`）。组件本身不改，prop 已存在。
- `TrendingPage` → 保持默认 `sites={["1","2"]}`（两站共用）。
- `sites` 取值从 `DISCOVER_TABS` 对应栏目声明推导（`lib/routes.ts` 已有 `sites` 字段），避免与栏目声明写两份。
- **不做**「消除 `/featured?site=2` 无效状态」：三页已有 `Navigate` 降级到 `/trending`，无此问题（review 中-2）。
- **可选（后置）2b Tab 视觉合并**：站点胶囊 + 栏目胶囊同一容器 `flex-wrap`。本轮不做。

涉及文件：`apps/web/src/pages/{Featured,Picks,Comments}Page.tsx`（Trending 无 diff；`ArchivePage` 已是 `<PageSiteTabs sites={["1","2"]} />`，无 diff，不列）
风险：低。Trending 仍两行属预期。

### 3. 宽度与热力图（2-3h，低风险）

- **3-1 页面栏宽独立档位**：新增 `type PageWidth = "normal" | "wide" | "xwide"` 与独立 class map（`normal: "max-w-3xl"`、`wide: "max-w-4xl"`、`xwide: "max-w-5xl"`），供 `PageShell` / `SiteHeader` 的 `maxWidth` prop 使用。**`ReadingMaxWidth` / `MAXWIDTH_VALUES` / `purifier:reading` 存储 / 阅读偏好面板保持 `normal | wide` 不动**——`xwide` 绝不进入 `ReadingSettings.maxWidth`，避免污染用户阅读偏好（review 中-4）。`readingMaxWidthClass` 签名改接受 `PageWidth`（更宽的 union），或新增 `pageWidthClass`，实现时二选一，存储与控件不动为前提。`StatsPage` / `JobsPage` / `ArchivePage` 三页改 `maxWidth="xwide"`。
- **3-2 热力图默认滚到最近**：`stats-heatmap.tsx` 容器（`overflow-x-auto`）挂载时 `scrollLeft = scrollWidth`，effect 依赖 `weeks.length`；周日对齐的 null 占位格子不影响滚到最右。保留 GitHub 式完整时间轴。
- **3-3 热力图点击反馈**：容器去掉 `role="img"`（否则嵌套 365 个交互格子违规），改普通 group + `aria-label`；格子保持 `title` tooltip，**不进入 Tab 序**（禁止 365 次 Tab）；点击写入 `selected` state 固定详情行，`onMouseEnter` 仅桌面 hover 预览且**不覆盖 selected**（当前 `onMouseLeave` 清 hover 的逻辑改为只影响预览态）；键盘可访问性由详情区（或「上一周/下一周」步进）承担，实现时定，禁止每格可聚焦（review 中-6）。

涉及文件：`components/reading-settings.tsx`（仅 class map / 签名）、`components/page-shell.tsx`、`components/site-header.tsx`、`pages/{Stats,Jobs,Archive}Page.tsx`、`components/stats-heatmap.tsx`
风险：低。

### 4. 列表卡片（30min，低风险）

- **题材胶囊进副标题**：删除 `ListPostCard` 的 `genreAsPill` 分支（`showGenre` 时不再渲染 trailing 胶囊），`formatTitleMeta` 天然把 genre 放进副标题。trailing 只留统计/操作。`showGenre` prop 保留（调用处语义不变）。
- **副标题截断**：`PostCard` 副标题当前无截断（只有标题有 `line-clamp-2`，`post-card.tsx:62-68`）。给副标题加 **`line-clamp-1`**，防 genre 入副标题后撑高卡片（review 中-5）。`CollapsibleBookGroup` 仍用独立 `GenrePill`，不受影响。
- **搜索相似保持现状**：图标入口、文字 `sm+` 显示。不做溢出菜单/长按（无使用数据支撑）。

涉及文件：`apps/web/src/components/list-post-card.tsx`、`apps/web/src/components/post-card.tsx`
风险：低。

### 5. Pager 跳页（2h，中风险）

- **`Pager` 加 `onPage?(n: number)` 回调**：组件内不直接改 URL（各页有自己的 `setSearchParams` 逻辑，直接改会打架）。`totalPages > 1` 时在中间标签处显示页码输入框 + 「跳转」按钮（回车等价提交）；输入 clamp 到 `[1, totalPages]` 后回调。`totalPages` 缺失（Browse/Search 的 nextPage 分页）不显示跳页，保持现状（review 高-3）。
- **接线全部已传 `totalPages` 的调用方**（grep 核实）：
  - `components/me-list-page.tsx:241`（历史/收藏/标签共享）
  - `pages/ArchivePage.tsx:310`
  - `pages/BookmarksPage.tsx:245`
  - `pages/GroupPage.tsx:516`（`totalPages={pages}`）
  - `pages/JobsPage.tsx:535`
  - `pages/BrowsePage.tsx:207`、`pages/SearchPage.tsx:244`：不传 `totalPages`，不接。
- **越界回退只补 ArchivePage**：`me-list-page`、`BookmarksPage`、`GroupPage`、`JobsPage` 已有 `page > maxPage` clamp（见审查核对表），勿重复实现；`ArchivePage.tsx` 补同样逻辑（跳旧末页或归档增长后越界时回退到末页）。
- 不做 5b「跳到最新/最旧」（输入等价）与 5c 页码条。

涉及文件：`apps/web/src/components/pager.tsx`、`apps/web/src/components/me-list-page.tsx`、`apps/web/src/pages/{Archive,Bookmarks,Group,Jobs}Page.tsx`
风险：中。跳页依赖 `totalPages` 实时性；越界由各页现有/补齐的 clamp 覆盖。

### 6. 阅读页（底栏半天 + 返回 30min，中风险）

- **6-1 返回兜底**：`SiteHeader` showBack 改为**仅实测过的 `window.history.state?.idx === 0`**（React Router v7 history 等价字段）时 `navigate(routes.home)`，否则 `navigate(-1)`。**不用 `history.length`**（Chrome 新标签下不可靠，review 中-8）。ReadPage/BookPage 共用。验证：新标签直达 `/read/:tid` 回首页；从首页点进阅读返回仍回首页。
- **6-2 论坛章节底栏——数据源重定义（review 高-1）**：
  - **事实**：`content.links` 是「扩展链接」= 正文 pre **外**的其它帖链接，按 tid 数值排序，**当前帖 tid 不在其中**；`index` 是排序下标非章节号。原「`findIndex` 定位当前 tid」方案在多数帖子 `pos === -1`，底栏几乎永不出现，且 tid 数值序不是阅读顺序——**方案废弃**。
  - **新数据源（双来源，均按标题模式匹配，不当作序列；review 二轮）**：仓库规范用例是 **pre 外** 的 `<a>下一章</a>` 进 `content.links`（`extractor.test.ts:8-24` 断言 `links === [{ title: "下一章", tid: "999" }]`），pre **内**同类链接才进 `content`（内链保留为 `/read/:tid`）。只扫 `content` 会漏主路径，两个来源都用：
    - 来源 A（pre 内）：`DOMParser` 解析清洗后 `content`，取 `a[href*='/read/']` 且文本匹配标题模式的链接。
    - 来源 B（pre 外）：`content.links` 中 `title` 匹配同一模式的条目。
    - 标题模式（**不含目录**）：`上一章|上一回|上章`（「上」侧）与 `下一章|下一回|下章`（「下」侧）。`目录|返回目录` 不放进正则、不做第三颗按钮——目录导航由 `RelatedLinks` 列表承担。
    - 取「上」/「下」各一条：多候选时按来源优先级 [content, links] 取第一条。
    - **仍不用 tid 排序当阅读顺序**（links 是 tid 序，语义无效）。
  - **显示条件**：仅当解析出上一章或下一章链接时显示底栏；单帖/无章节链接帖不显示。
  - **布局**：半透明固定底栏，**右端避让 `ItemActions` FAB**（`fixed right-4 z-50`，右端留空或短条），`z-index` 低于 FAB；safe-area 沿用 `item-actions.tsx:125` 的 inline `calc(env(safe-area-inset-bottom, 0px) + …)` 写法，**不发明 `pb-safe` 工具类**（review 中-7）；`article`/`main` 加与底栏等高的 padding-bottom 防遮挡正文。
  - **进度条显式避让（review 二轮）**：`ReadingProgress` 的细条（`fixed inset-x-0 bottom-0 z-30 h-0.5`）与百分比（`fixed right-2 z-30`）都是 fixed（`reading-progress.tsx:4-17`），正文 padding 抬不动。底栏出现时，给 `ReadingProgress` 增加抬升（如 `bottomOffset` prop 或 CSS 变量）：细条与百分比 `bottom` 改为 `calc(底栏高度 + env(safe-area-inset-bottom, 0px))`（底栏高度用统一常量/CSS 变量，实现时定）。验证项：有底栏时进度条在底栏**上方**仍可见。
  - 书库 `BookPage` 内联 prev/next 不动。
  - 底栏与 `ReadingSelectionToolbar`（文字选择工具栏）触发时共存策略实现时验证（选择工具栏出现时不遮挡、可关闭）。

涉及文件：`apps/web/src/pages/ReadPage.tsx`、`apps/web/src/components/article-view.tsx`（或新小组件）、`apps/web/src/components/site-header.tsx`、`apps/web/src/components/reading-progress.tsx`（进度条抬升）
风险：中。数据源为标题模式启发式（以真实页面校准）；**降级条件 = 来源 A、B 都匹配不到上/下链接**（不是「pre 内没有」——规范用例就是 pre 外「下一章」进 `content.links`，见 `extractor.test.ts:8-24`；pre 内没有但 links 有，必须出底栏）；降级时在实施计划中标注（备选：extractor 后端扩展，超出本轮范围，列「明确不做」）。

### 收尾：可达性（1h，低风险）

- skip-to-main：`SiteHeader` 首元素加「跳到正文」（`sr-only focus:not-sr-only`），`PageShell` 的 `<main>` 加 `id="main"` + `tabIndex={-1}`。
- 焦点（review 补充 4）：`confirm-dialog.tsx` **已有** Escape、`aria-modal`、打开时 focus 确认钮——只补 **Tab trap** 与**关闭后焦点归还**。`CharacterMarkPopover` / `ReadingSelectionToolbar` 已有 Escape 且**不是 modal，不硬套 trap**，只验证关闭后焦点归还（若适用）。

涉及文件：`components/site-header.tsx`、`components/page-shell.tsx`、`components/confirm-dialog.tsx`
风险：低。

## 方案清单（按 grok 顺序，含 review 修订）

| # | 改动 | 涉及文件 | 风险 | 成本 |
|---|---|---|---|---|
| 1 | 汉堡固定列数网格 + 外点关闭 + 断点提前 md | `components/site-header.tsx` | 低（md 溢出实测） | ≤1h |
| 2 | 站点 Tab 按需出现（`hideWhenSingle`） | `pages/{Featured,Picks,Comments}Page.tsx` | 低 | ≤1h |
| 3 | 页面栏宽 `PageWidth`(xwide=5xl) 独立档 + 热力图滚动/点击 | `reading-settings.tsx`、`page-shell.tsx`、`site-header.tsx`、`Stats/Jobs/Archive` 页、`stats-heatmap.tsx` | 低 | 2-3h |
| 4 | 题材胶囊进副标题 + 副标题 line-clamp-1；相似搜索保持现状 | `components/list-post-card.tsx`、`components/post-card.tsx` | 低 | 30min |
| 5 | Pager `onPage` + 5 处接线 + Archive 越界回退 | `components/pager.tsx`、`me-list-page.tsx`、`pages/{Archive,Bookmarks,Group,Jobs}Page.tsx` | 中（越界） | 2h |
| 6 | 论坛章节底栏（content+links 双来源章链）+ 返回兜底 | `pages/ReadPage.tsx`、`article-view.tsx`、`site-header.tsx`、`reading-progress.tsx` | 中（数据源启发式/浮层与进度条避让） | 半天 |
| A11y | skip-to-main + confirm-dialog Tab trap/焦点归还 | `site-header.tsx`、`page-shell.tsx`、`confirm-dialog.tsx` | 低 | 1h |
| 可选 | 底部 Tab bar（1b）、Tab 视觉合并（2b） | `routes.ts`、`site-header.tsx`、新组件 | 高 | 1-2 天 |

## 验证方式

- 导航：浏览器实测拆两档（review 二轮低）：
  - **`<768`**：logo + 搜索图标 + 用户名（sm:inline）+ 退出 + 主题 + 汉堡（横排 nav 隐藏）。
  - **`≥768`（md 起）**：logo + 8 nav + 用户名 + 退出 + 主题（汉堡与搜索图标 `md:hidden` 消失）；820px 复查无换行/溢出。
  - 溢出对策：`md:hidden` 用户名或退出改图标（review 低-2）。
- 宽度/热力图：三页 `xwide` 生效；热力图触摸点击固定详情、键盘步进可用、默认滚到最近一周。
- 分页：跳页输入 clamp 与回退；Archive 越界回退到末页；Browse/Search 不显示跳页输入。
- 章节底栏（review 高-1 + 二轮验证项）：打开多章连载帖（含 **pre 外「下一章」主路径**，对应 `extractor.test.ts:8-24` 夹具结构）确认底栏出现且上一章/下一章 tid 正确；单帖/无章节链接帖不显示；正文不被底栏遮挡、**进度条在底栏上方仍可见**、FAB 不被遮挡。
- 返回兜底：新标签直达 `/read/:tid` 回首页；从首页点进阅读返回回首页（review 中-8）。
- 回归：`bun run typecheck` + `bun run build` + **`bun run test`**（改 extractor 语义或 pager 行为时，`packages/core` 与前端单测都要跑，review 补充 5）。

## 明确不做

- 底部 Tab bar（可选后置）
- Tab 视觉合并（可选后置）
- 「搜索相似」溢出菜单/长按
- 「我的」页站点 Tab（无此问题）
- 书库章节导航改造（已有内联 prev/next）
- 热力图只画有数据的月份（丢时间轴完整性）
- extractor 后端扩展「章节序列」字段（来源 A、B 均无上/下链接且样本确认后，底栏整体降级为不做，而非扩后端）
