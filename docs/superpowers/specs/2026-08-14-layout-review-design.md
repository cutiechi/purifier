# 布局与交互审查改版设计

日期：2026-08-14
状态：已脑爆认可，待实施
路线：按 grok 审查优先级 1→6 逐项落地（用户选定 B 路线）

## 背景

Purifier 是 Cool18 净化阅读器（Bun workspace monorepo：`apps/api` + `apps/web` Vite/React 19/Tailwind 4/React Router 7）。grok 对线上各页做了布局与交互审查，给出 6 条结论与建议优先级。本文档为逐项设计。

**脑爆澄清结论**：
- 使用场景：手机 + 桌面对半，两边都不能妥协。
- 「搜索相似」使用频率：不清楚，按默认处理（保留图标入口、隐藏文字）。
- 章节导航：按推荐做论坛侧轻量底栏。

## 审查结论核对（实现前提）

| grok 结论 | 代码事实 | 影响 |
|---|---|---|
| 导航 < lg 汉堡横滑 | `site-header.tsx` 用 `overflow-x-auto`，断点 `lg` | 属实 |
| 发现/我的 Tab 两行 | 发现页 4 栏目页 = `PageSiteTabs` + `SectionTabs` 两行；**「我的」页只有一行**（`MeListPage` 无站点 Tab，跨站默认） | 范围修正：「我的」无需改 |
| 统计/任务/目录窄 | `PageShell` 默认 `max-w-3xl`，无 5xl 档 | 属实 |
| 热力图只 hover | `stats-heatmap.tsx` 仅 `onMouseEnter/Leave` | 属实 |
| 相似搜索空结果无下一步 | `SimilarSearchPanel` 无「去搜索页」引导 | 属实 |
| 阅读无章节底栏 | 论坛 `ReadPage` 无；**书库 `BookPage` 已有内联 prev/next**（`prevChapter/nextChapter`） | 范围修正：底栏只做论坛侧 |
| 论坛章节链接 index 恒 0 | `Cool18Extractor.extractLinksFromDom` 全部 `index: 0`（正文外链接列表） | 底栏按数组顺序定位，非 index |
| 题材胶囊 | `formatTitleMeta` 已含 genre（`packages/core/src/title-parse.ts`） | 「胶囊进副标题」= 删 pill 分支 |
| 分页无跳转 | `Pager` 只有上一页/下一页 | 属实 |
| 返回无历史兜底 | `SiteHeader` showBack = `navigate(-1)` | 属实 |

## 设计（按 grok 优先级 1→6）

### 1. 手机导航（≤1h，低风险）

- **1a 汉堡内换行网格**：`site-header.tsx` 移动菜单 `flex-wrap` 替换 `overflow-x-auto`，8 项 4×2 排布，消灭横滑裁切。
- **1c 断点提前 md**：桌面横排从 `lg:flex` 改为 `md:flex`（汉堡按钮 `lg:hidden` → `md:hidden`），平板获得完整导航。md 下收紧 `px-2.5 → px-2`，用户名折叠（`max-w-40` 已截断，必要时 `md:hidden`）。
- **可选（后置）1b 底部 Tab bar**：首页/目录/发现/我的 + 更多抽屉。需要 `NAV_ITEMS` 分组（`lib/routes.ts`）、active 匹配改造、抽屉组件、阅读页隐藏逻辑。结构性改动，不在本轮。

涉及文件：`apps/web/src/components/site-header.tsx`
风险：md 下 8 项 + logo + 右侧图标约 760px，768px 临界，实测溢出则 `md` 用 `px-2` 或隐藏「退出」文字。

### 2. 站点 Tab 按需出现（≤1h，低风险）

各调用处把栏目声明的 `sites` 传给 `PageSiteTabs`：

- `FeaturedPage` / `PicksPage` / `CommentsPage` → `sites={["1"]}`（论坛专属，站点 Tab 消失，单行）
- `TrendingPage` → `sites={["1","2"]}`（两站共用，保留）
- `ArchivePage` → `sites={["1","2"]}`（两站都有）

顺带消除 `/featured?site=2` 无效状态（栏目 Tab 无高亮、内容为空）。`DISCOVER_TABS` 的 `sites` 声明已存在，直接用。

- **可选（后置）2b Tab 视觉合并**：站点胶囊 + 栏目胶囊同一容器 `flex-wrap`。本轮不做。

涉及文件：`apps/web/src/pages/{Featured,Picks,Comments,Trending,Archive}Page.tsx`、`components/page-site-tabs.tsx`（不改或仅默认值）
风险：低；Trending 仍两行属预期。

### 3. 宽度与热力图（2-3h，低风险）

- **3-1 宽度档 `xwide`**：`reading-settings.tsx` 的 `MAXWIDTH_CLASS` 加 `xwide: "max-w-5xl"`（与用户阅读设置 normal/wide 分离，不混用）；`page-shell.tsx` / `site-header.tsx` 的 `maxWidth` prop 类型加 `"xwide"`；`StatsPage` / `JobsPage` / `ArchivePage` 三页改 `maxWidth="xwide"`。
- **3-2 热力图滚动**：`stats-heatmap.tsx` 容器挂载时 `scrollLeft = scrollWidth`（滚到最近一周）。一个 effect，保留 GitHub 式完整时间轴。
- **3-3 热力图点击反馈**：格子加 `onClick` / `onKeyDown`（Enter/Space）/ `tabIndex` / `role="button"`（或保留 `role="img"` 时用 focus 状态），点击/聚焦固定详情行；`title` tooltip 保留。

涉及文件：`components/reading-settings.tsx`、`components/page-shell.tsx`、`components/site-header.tsx`、`pages/{Stats,Jobs,Archive}Page.tsx`、`components/stats-heatmap.tsx`
风险：低。`role` 语义选择实现时定（img + focus 或 button）。

### 4. 列表卡片（30min，低风险）

- **题材胶囊进副标题**：删除 `ListPostCard` 的 `genreAsPill` 分支（`showGenre` 时不再渲染 trailing 胶囊），`formatTitleMeta` 天然把 genre 放进副标题（已含 `p.genre`）。trailing 只留统计/操作。`showGenre` prop 保留（调用处语义不变）。
- **搜索相似保持现状**：图标入口、文字 `sm+` 显示。不做溢出菜单/长按（无使用数据支撑）。

涉及文件：`apps/web/src/components/list-post-card.tsx`
风险：低；副标题变长由 `PostCard` 现有省略处理兜底。

### 5. Pager 跳页（2h，中风险）

- `pager.tsx`：`totalPages > 1` 时在中间标签处嵌页码输入框 + 「跳转」按钮（回车等价提交）；`totalPages` 缺失时（搜索等）不显示。
- 越界回退：`me-list-page.tsx` 已有「页码越界回退到末页」；`ArchivePage.tsx` **补同样逻辑**（跳旧末页或归档增长后越界时回退）。
- 不做 5b「跳到最新/最旧」（输入等价）与 5c 页码条。

涉及文件：`apps/web/src/components/pager.tsx`、`apps/web/src/pages/ArchivePage.tsx`
风险：中。跳页依赖 `totalPages` 实时性；越界由回退逻辑覆盖（复用 `me-list-page` 的模式）。

### 6. 阅读页（底栏半天 + 返回 30min，中风险）

- **6-1 返回兜底**：`SiteHeader` showBack 改：`window.history.state?.idx === 0`（或 `history.length <= 1`）时 `navigate(routes.home)`，否则 `navigate(-1)`。ReadPage/BookPage 共用。React Router v7 history `idx` 语义实现时实测。
- **6-2 论坛章节底栏**：`ReadPage` 计算 `pos = content.links.findIndex(l => l.tid === tid)`；`pos >= 0 && (pos > 0 || pos < len-1)` 时渲染半透明固定底栏「上一章 / 下一章」（`links[pos-1]` / `links[pos+1]`，`bookPath` 无关，走 `readPath`）；底部 `pb-safe` 下边距；仅多章节帖显示。书库 `BookPage` 内联 prev/next 不动。
- 底栏与 `ReadingSelectionToolbar` / `CharacterMarkPopover` 浮层共存：检查 z-index 与触发时机（文字选择工具栏出现时底栏不遮挡）。

涉及文件：`apps/web/src/pages/ReadPage.tsx`、`apps/web/src/components/article-view.tsx`（或新小组件）、`apps/web/src/components/site-header.tsx`
风险：中。论坛 `links` 可能含非章节链接，底栏导航与 `RelatedLinks` 列表行为一致（约束：仅当前 tid 在 links 内才显示）；浮层冲突实现时验证。

### 收尾：可达性（1h，低风险）

- skip-to-main：`SiteHeader` 首元素加「跳到正文」（`sr-only focus:not-sr-only`），`PageShell` 的 `<main>` 加 `id="main"` + `tabIndex={-1}`。
- 焦点验证：`ReadingSelectionToolbar` / `CharacterMarkPopover` / `confirm-dialog` 的 Escape 关闭与焦点归还；是 modal 则补 trap。

涉及文件：`components/site-header.tsx`、`components/page-shell.tsx`、`components/confirm-dialog.tsx`、`components/character-mark-popover.tsx`、`components/reading-selection-toolbar.tsx`
风险：低。

## 方案清单（按 grok 顺序）

| # | 改动 | 涉及文件 | 风险 | 成本 |
|---|---|---|---|---|
| 1 | 汉堡换行网格 + 断点提前 md | `components/site-header.tsx` | 低（md 溢出实测） | ≤1h |
| 2 | 站点 Tab 按需出现 | `pages/{Featured,Picks,Comments,Trending,Archive}Page.tsx` | 低 | ≤1h |
| 3 | 宽度档 xwide(5xl) + 热力图滚动/点击 | `reading-settings.tsx`、`page-shell.tsx`、`site-header.tsx`、`Stats/Jobs/Archive` 页、`stats-heatmap.tsx` | 低 | 2-3h |
| 4 | 题材胶囊进副标题；相似搜索保持现状 | `components/list-post-card.tsx` | 低 | 30min |
| 5 | Pager 跳页 + Archive 越界回退 | `components/pager.tsx`、`pages/ArchivePage.tsx` | 中（越界） | 2h |
| 6 | 论坛章节底栏 + 返回兜底 | `pages/ReadPage.tsx`、`article-view.tsx`、`site-header.tsx` | 中（links 语义/浮层冲突） | 半天 |
| A11y | skip-to-main + 焦点验证 | `site-header.tsx`、`page-shell.tsx`、浮层组件 | 低 | 1h |
| 可选 | 底部 Tab bar（1b）、Tab 视觉合并（2b） | `routes.ts`、`site-header.tsx`、新组件 | 高 | 1-2 天 |

## 验证方式

- 导航/宽度/热力图/分页/卡片：浏览器实测（md 断点、触摸点击热力图、跳页、越界回退）。
- 章节底栏：实测多章节论坛帖 + 与浮层共存；无章节帖不显示。
- 返回兜底：无历史直达场景（新标签打开 /read/x）回首页。
- 全套：`bun run typecheck` + `bun run build`（按 AGENTS.md）。

## 明确不做

- 底部 Tab bar（可选后置）
- Tab 视觉合并（可选后置）
- 「搜索相似」溢出菜单/长按
- 「我的」页站点 Tab（无此问题）
- 书库章节导航改造（已有内联 prev/next）
- 热力图只画有数据的月份（丢时间轴完整性）
