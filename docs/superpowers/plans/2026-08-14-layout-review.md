# 布局与交互审查改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 grok 审查 1→6 优先级落实 Purifier 前端的布局与交互改进（导航、Tab、宽度、热力图、卡片、分页、阅读底栏、可达性）。

**Architecture:** 全部改动在 `apps/web`（Vite + React 19 + Tailwind 4 + React Router 7）。导航/热力图/卡片为纯样式与交互改造；章节底栏新增纯函数库 `lib/chapter-nav.ts`（含 bun test）+ 展示组件；Pager 增加 `onPage` 回调并接线全部已传 `totalPages` 的调用方。

**Tech Stack:** React 19、Tailwind CSS 4（工具类）、react-router-dom 7、lucide-react、bun test（`apps/web` 已有 `"test": "bun test"`，测试文件自动发现 `*.test.ts`，并入根 `bun run test`）。

## Global Constraints

- TypeScript `strict`；Prettier 无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 前端页面导入用 `@/` 别名；图标优先 lucide-react，`@/components/icons` 内已有 `IconChevronLeft/Right` 可直接用。
- 阅读宽度偏好 `ReadingMaxWidth` / `purifier:reading` 存储 / 阅读偏好面板**保持 `normal | wide` 不动**；页面栏宽用独立 `PageWidth`（含 `xwide`）。
- 每次提交前跑 `bun run typecheck`（或 `bun run --filter=web typecheck`）；涉及新增测试跑 `bun test apps/web/src/lib/chapter-nav.test.ts`；UI 改动按各任务「验证」节浏览器实测（`bun run dev:web`）。
- 分页越界 clamp 已有：`me-list-page.tsx:112-118`、`BookmarksPage.tsx:174-180`、`GroupPage.tsx:395-396`、`JobsPage.tsx:107-108`——**勿重复实现**，只补 `ArchivePage`。
- 章节底栏降级条件：仅当来源 A（正文 `content` 内）、B（`content.links`）**都**匹配不到上/下链接时不显示；pre 内没有但 links 有，必须显示。

---

### Task 1: 手机导航网格 + 外点关闭 + md 断点

**Files:**
- Modify: `apps/web/src/components/site-header.tsx`

**Interfaces:**
- 无对外接口变化（`SiteHeader` props 不变）。

- [ ] **Step 1: 移动菜单横滑改固定列数网格**

`site-header.tsx` 中 `{open && (<nav ...>)}` 里的菜单容器：

```tsx
<div className="flex gap-1.5 overflow-x-auto pb-1">
```

改为：

```tsx
<div className="grid grid-cols-2 gap-1.5 pb-1 sm:grid-cols-4">
```

同块内每个菜单 `<Link>` 的 className 去掉 `shrink-0`（原 `"inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-medium transition-colors"` → 去掉 `shrink-0`）。

- [ ] **Step 2: 菜单外点击关闭**

`<nav className={cn("mx-auto border-t ... lg:hidden", widthClass)}>` 之前（仍在 `<header>` 内）插入：

```tsx
{open && (
  <div
    aria-hidden
    className="fixed inset-0 z-40"
    onClick={() => setOpen(false)}
  />
)}
```

同时把该菜单 `<nav>` 的 className 加 `relative z-50`（遮罩 `z-40` 在 header 的 stacking context 内会盖住普通流菜单，菜单必须提层）。最终：

```tsx
{open && (
  <>
    <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
    <nav className={cn("relative z-50 mx-auto border-t border-border/60 px-3 py-3 lg:hidden", widthClass)}>
      ...
    </nav>
  </>
)}
```

- [ ] **Step 3: 断点提前 md（4 处）**

| 位置 | 现类 | 改 |
|---|---|---|
| 桌面导航 `<nav>` | `hidden ... lg:flex` | `md:flex` |
| 搜索图标 `<Link>` | `lg:hidden` | `md:hidden` |
| 汉堡按钮 | `lg:hidden` | `md:hidden` |
| 移动菜单 `<nav>`（Step 2 内） | `lg:hidden` | `md:hidden` |

- [ ] **Step 4: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器实测（`bun run dev:web`）：
- `<768`（如 390px）：汉堡网格 2 列；点菜单外区域关闭。
- `≥768`（如 768px 与 820px）：横排 8 项导航出现、汉堡与搜索图标消失，无换行/溢出。溢出则把用户名 `sm:inline` 改 `md:hidden` 或「退出」改图标（仅溢出时）。
- 手机导航链路 `?site=` 参数保留（点击菜单项跳转后 `pathname` 变化自动关闭）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/site-header.tsx
git commit -m "feat(web): mobile nav grid, outside-click close, md breakpoint"
```

---

### Task 2: 站点 Tab 按需出现

**Files:**
- Modify: `apps/web/src/pages/FeaturedPage.tsx`
- Modify: `apps/web/src/pages/PicksPage.tsx`
- Modify: `apps/web/src/pages/CommentsPage.tsx`

**Interfaces:**
- 使用 `PageSiteTabs` 既有 props：`sites`、`hideWhenSingle`（`hideWhenSingle` 默认 `false`，单站仍渲染胶囊，必须显式传）。

- [ ] **Step 1: 三页传单站 + hideWhenSingle**

每页 `<PageSiteTabs />` 改为：

```tsx
<PageSiteTabs sites={["1"]} hideWhenSingle />
```

（FeaturedPage:65、PicksPage:41、CommentsPage:62 三处。`sites` 与 `DISCOVER_TABS` 中对应栏目声明一致：featured/picks/comments 均为 `["1"]`。`TrendingPage` 保持 `<PageSiteTabs />` 默认两站。）

- [ ] **Step 2: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：`/featured`、`/picks`、`/comments` 无站点 Tab 行（单行栏目 Tab）；`/trending` 仍两站 Tab + 栏目 Tab；`/featured?site=2` 仍重定向 `/trending?site=2`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/FeaturedPage.tsx apps/web/src/pages/PicksPage.tsx apps/web/src/pages/CommentsPage.tsx
git commit -m "feat(web): hide site tabs on forum-only discover columns"
```

---

### Task 3: 页面栏宽独立档位 PageWidth

**Files:**
- Modify: `apps/web/src/components/reading-settings.tsx`（`MAXWIDTH_CLASS` 区）
- Modify: `apps/web/src/components/page-shell.tsx`
- Modify: `apps/web/src/components/site-header.tsx`（仅 import 与类型）
- Modify: `apps/web/src/pages/StatsPage.tsx`
- Modify: `apps/web/src/pages/JobsPage.tsx`
- Modify: `apps/web/src/pages/ArchivePage.tsx`

**Interfaces:**
- Produces: `export type PageWidth = "normal" | "wide" | "xwide"`；`export function pageWidthClass(maxWidth: PageWidth): string`（`normal→max-w-3xl`、`wide→max-w-4xl`、`xwide→max-w-5xl`）。
- Removes: `readingMaxWidthClass`（仅 `page-shell.tsx`、`site-header.tsx` 两处调用，一并迁移）。

- [ ] **Step 1: reading-settings.tsx 加 PageWidth 与 pageWidthClass**

替换现有：

```ts
const MAXWIDTH_CLASS: Record<ReadingMaxWidth, string> = {
  normal: "max-w-3xl",
  wide: "max-w-4xl",
}

// 供 PageShell / SiteHeader 对齐栏宽用（Phase 2 Task 2.1）
export function readingMaxWidthClass(maxWidth: ReadingMaxWidth): string {
  return MAXWIDTH_CLASS[maxWidth]
}
```

为：

```ts
/** 页面栏宽（含宽屏档）；与阅读偏好 ReadingMaxWidth 分离，不进存储/面板 */
export type PageWidth = "normal" | "wide" | "xwide"

const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
  normal: "max-w-3xl",
  wide: "max-w-4xl",
  xwide: "max-w-5xl",
}

export function pageWidthClass(maxWidth: PageWidth): string {
  return PAGE_WIDTH_CLASS[maxWidth]
}
```

`ReadingMaxWidth`、`MAXWIDTH_VALUES`、`DEFAULT_READING_SETTINGS`、`loadSettings`、`ReadingSettingsProvider` 一律不动。

- [ ] **Step 2: page-shell.tsx 迁移**

```tsx
import { pageWidthClass, type PageWidth } from "@/components/reading-settings"
```

`maxWidth` prop 类型 `"normal" | "wide"` → `PageWidth`；`widthClass` 计算改为：

```tsx
const widthClass = pageWidthClass(maxWidth ?? "normal")
```

`<main>` 同时加可达性锚点（Task 12 会用到，一并加）：

```tsx
<main
  id="main"
  tabIndex={-1}
  className={cn(
    "relative mx-auto w-full px-3.5 py-5 sm:px-5 sm:py-8",
    widthClass,
    className
  )}
>
```

- [ ] **Step 3: site-header.tsx 迁移**

`import { readingMaxWidthClass } from "@/components/reading-settings"` → `import { pageWidthClass, type PageWidth } from "@/components/reading-settings"`；`maxWidth?: "normal" | "wide"` → `maxWidth?: PageWidth`；`const widthClass = readingMaxWidthClass(maxWidth ?? "normal")` → `pageWidthClass(...)`。

- [ ] **Step 4: 三页放宽**

`StatsPage`、`JobsPage`、`ArchivePage` 的 `<PageShell>` 改为 `<PageShell maxWidth="xwide">`。

- [ ] **Step 5: 验证**

Run: `bun run typecheck`（Turbo 全仓）→ PASS。`bun run build:web` → PASS。
浏览器：`/stats`、`/jobs`、`/archive` 内容区约 1024px（max-w-5xl）；`/history` 等保持 768px（max-w-3xl）；阅读页 `maxWidth` 设置不受影响（读一篇帖子验证阅读宽度仍 3xl/4xl）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/reading-settings.tsx apps/web/src/components/page-shell.tsx apps/web/src/components/site-header.tsx apps/web/src/pages/StatsPage.tsx apps/web/src/pages/JobsPage.tsx apps/web/src/pages/ArchivePage.tsx
git commit -m "feat(web): page width PageWidth with xwide tier, keep reading pref untouched"
```

---

### Task 4: 热力图滚动到最近 + 点击/键盘

**Files:**
- Modify: `apps/web/src/components/stats-heatmap.tsx`

**Interfaces:**
- 无对外接口变化（`StatsHeatmap({ days })` 不变）。

- [ ] **Step 1: 挂载滚动到最近一周 + selected 状态**

新增 `useEffect`/`useRef` 与 `selected`：

```tsx
import { useEffect, useRef, useState } from "react"
```

组件内：

```tsx
const [hover, setHover] = useState<Day | null>(null)
const [selected, setSelected] = useState<Day | null>(null)
const scrollRef = useRef<HTMLDivElement>(null)

// 挂载/周数变化时滚到最近一周（365 天从最旧画起，最新在右端）
useEffect(() => {
  const el = scrollRef.current
  if (el) el.scrollLeft = el.scrollWidth
}, [weeks.length])
```

详情行改为「selected 优先，hover 仅桌面预览」：

```tsx
const shown = selected ?? hover
```

（渲染处 `{shown && (<p ...>...)}`，内容引用 `shown`。）

- [ ] **Step 2: 容器去 role="img" 改 group，加键盘步进**

容器（含 `ref={scrollRef}`）：

```tsx
<div
  ref={scrollRef}
  className="flex gap-[3px] overflow-x-auto"
  role="group"
  aria-label="近一年阅读热力图，左右方向键切换所选日期"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const base = shown?.date ?? keyOf(todayMid)
    const d = new Date(base + "T00:00:00")
    d.setDate(d.getDate() + (e.key === "ArrowRight" ? 1 : -1))
    const nextKey = keyOf(d)
    setSelected(byDate.get(nextKey) ?? { date: nextKey, durationS: 0, estimated: 0 })
  }}
>
```

`keyOf`、`todayMid`、`byDate` 均已存在（`keyOf` 是模块内函数，`todayMid` 在组件内已定义）。

- [ ] **Step 3: 格子点击与 hover 语义**

格子 `onMouseEnter={() => setHover(c)}` 保持（预览）；`onMouseLeave={() => setHover(null)}` 保持（只清预览，selected 不受影响）；新增：

```tsx
onClick={() => setSelected(c)}
```

格子 title 保留。删除容器原 `role="img"` 与 `aria-label="近一年阅读热力图"`（已由 Step 2 的 group 承担）。

- [ ] **Step 4: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：`/stats` 有数据时默认视口停在最近几周；鼠标悬停预览详情、点击固定详情（移开鼠标不消失）；键盘聚焦容器后左右箭头切换日期详情；触屏点格子有反馈。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/stats-heatmap.tsx
git commit -m "feat(web): heatmap scroll-to-recent, click select, keyboard stepping"
```

---

### Task 5: 列表卡片：题材进副标题 + 副标题截断

**Files:**
- Modify: `apps/web/src/components/list-post-card.tsx`
- Modify: `apps/web/src/components/post-card.tsx`

**Interfaces:**
- `ListPostCard` props 不变（`showGenre` 保留，调用处无 diff）。

- [ ] **Step 1: list-post-card.tsx 删 pill 分支**

```tsx
const genreAsPill = showGenre && !!parsed.genre && statValue == null
const subtitle = formatTitleMeta(
  genreAsPill ? { ...parsed, genre: null } : parsed
)
```

改为：

```tsx
const subtitle = formatTitleMeta(parsed)
```

`defaultTrailing` 删除 genreAsPill 分支：

```tsx
let defaultTrailing: ReactNode
if (statValue != null && statUnit) {
  defaultTrailing = <StatTrailing value={statValue} unit={statUnit} />
} else if (genreAsPill && parsed.genre) {
  defaultTrailing = <GenrePill genre={parsed.genre} />
}
```

改为：

```tsx
let defaultTrailing: ReactNode
if (statValue != null && statUnit) {
  defaultTrailing = <StatTrailing value={statValue} unit={statUnit} />
}
```

`GenrePill` 导出保留（`CollapsibleBookGroup` 等仍在用）。

- [ ] **Step 2: post-card.tsx 副标题 line-clamp-1**

```tsx
{subtitle != null && subtitle !== "" && (
  <span className="text-xs text-muted-foreground">{subtitle}</span>
)}
```

改为：

```tsx
{subtitle != null && subtitle !== "" && (
  <span className="line-clamp-1 text-xs text-muted-foreground">{subtitle}</span>
)}
```

- [ ] **Step 3: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：首页/榜单列表无 trailing 题材胶囊（题材在副标题行，单行截断）；有统计的卡片 trailing 只余统计；`/groups` 折叠组头部 `GenrePill` 仍显示。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/list-post-card.tsx apps/web/src/components/post-card.tsx
git commit -m "feat(web): genre into subtitle line, clamp subtitle to one line"
```

---

### Task 6: Pager 加 onPage 与跳页输入

**Files:**
- Modify: `apps/web/src/components/pager.tsx`

**Interfaces:**
- Produces: `Pager` 新可选 prop `onPage?: (page: number) => void`。`totalPages != null && totalPages > 1 && onPage` 时显示跳页输入，提交 clamp 到 `[1, totalPages]`。组件内不直接改 URL。

- [ ] **Step 1: 加状态与提交逻辑**

`pager.tsx` 顶部 `import { type ReactNode } from "react"` → `import { type ReactNode, useState } from "react"`。

组件签名加 `onPage`：

```tsx
export function Pager({
  page,
  hasNext,
  onPrev,
  onNext,
  disabled,
  className,
  totalPages,
  total,
  onPage,
}: {
  page: number
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
  className?: string
  totalPages?: number
  total?: number
  onPage?: (page: number) => void
}) {
  const [jump, setJump] = useState("")

  const submitJump = () => {
    if (totalPages == null || !onPage) return
    const n = parseInt(jump, 10)
    if (!Number.isFinite(n)) return
    onPage(Math.min(Math.max(n, 1), totalPages))
    setJump("")
  }
```

- [ ] **Step 2: 中间标签区加输入**

中间 `<div className="min-w-0 px-1 text-center text-sm ...">` 内、`{sub}` 之后追加：

```tsx
{totalPages != null && totalPages > 1 && onPage && (
  <span className="mt-1 block sm:mt-0 sm:ml-2 sm:inline-flex sm:items-center sm:gap-1">
    <input
      type="number"
      min={1}
      max={totalPages}
      value={jump}
      onChange={(e) => setJump(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          submitJump()
        }
      }}
      aria-label="跳转到页码"
      className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-xs tabular-nums"
    />
    <button
      type="button"
      onClick={submitJump}
      className="inline-flex min-h-7 items-center rounded-md bg-accent px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent/70"
    >
      跳转
    </button>
  </span>
)}
```

（label 是 `第 p / P 页`，输入框在 `sm` 同行右侧、手机换行。）

- [ ] **Step 3: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：在 `/archive`（有 totalPages）中间区出现跳页输入；输入越界值（如 9999）提交后落在末页且 URL `page` 被 clamp；输入非数字无反应；`/search`（无 totalPages）不显示输入。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pager.tsx
git commit -m "feat(web): pager onPage callback with clamped jump input"
```

---

### Task 7: Pager 接线 5 处

**Files:**
- Modify: `apps/web/src/components/me-list-page.tsx`（Pager 调用处 ~241）
- Modify: `apps/web/src/pages/ArchivePage.tsx`（~310）
- Modify: `apps/web/src/pages/BookmarksPage.tsx`（~245）
- Modify: `apps/web/src/pages/GroupPage.tsx`（~516）
- Modify: `apps/web/src/pages/JobsPage.tsx`（~535）

**Interfaces:**
- 消费 `Pager.onPage`。各页 update 函数均已接受 `{ page }`。

- [ ] **Step 1: 五处各加一行**

每处 `<Pager ... onPrev={...} onNext={...} disabled={loading} />` 追加：

```tsx
onPage={(n) => update({ page: n })}
```

（`me-list-page` 的 `update` 签名 `{ q?, kind?, page? }`；`ArchivePage`/`BookmarksPage` 的 `update` 接受 `{ page }`；`GroupPage` 的 `update` 接受 `{ q?, filter?, sort?, page? }`；`JobsPage` 的 `update` 同。）`BrowsePage`、`SearchPage` 不传 `totalPages`，**不接**。

- [ ] **Step 2: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：`/history`、`/bookmarks`、`/groups`、`/jobs`、`/archive` 跳页输入均出现且跳转正确；`/search`、`/browse` 无跳页输入。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/me-list-page.tsx apps/web/src/pages/ArchivePage.tsx apps/web/src/pages/BookmarksPage.tsx apps/web/src/pages/GroupPage.tsx apps/web/src/pages/JobsPage.tsx
git commit -m "feat(web): wire pager onPage across totalPages callers"
```

---

### Task 8: Archive 页码越界回退

**Files:**
- Modify: `apps/web/src/pages/ArchivePage.tsx`

**Interfaces:**
- 复用既有 `calcTotalPages`、`ARCHIVE_PAGE_SIZE`、`update`。

- [ ] **Step 1: 补 clamp effect**

`useScrollTop([page, sort, q])` 之后插入（与 `me-list-page.tsx:112-118` 同模式）：

```tsx
// 页码越界 → 回退到最后一页（其余列表页已有同样逻辑）
useEffect(() => {
  if (loading || error) return
  if (total <= 0) return
  const maxPage = calcTotalPages(total, ARCHIVE_PAGE_SIZE)
  if (page > maxPage) update({ page: maxPage })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only on total/page
}, [loading, error, total, page])
```

`ArchivePage` 已 import `useEffect`、`calcTotalPages`、`ARCHIVE_PAGE_SIZE`。

- [ ] **Step 2: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：`/archive?page=99999` 加载后自动回退末页（URL `page` 修正）；正常翻页不受影响。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ArchivePage.tsx
git commit -m "fix(web): archive page overflow clamp to last page"
```

---

### Task 9: 阅读返回兜底

**Files:**
- Modify: `apps/web/src/components/site-header.tsx`

**Interfaces:**
- 无对外变化。

- [ ] **Step 1: showBack 无历史回首页**

`showBack` 按钮的 `onClick={() => navigate(-1)}` 改为：

```tsx
onClick={() => {
  // 新标签直达（history idx=0）时无前向页可退，回首页
  if (window.history.state?.idx === 0) navigate(routes.home)
  else navigate(-1)
}}
```

`navigate`、`routes` 均已 import。

- [ ] **Step 2: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器：新标签打开 `/read/<某 tid>` 点返回 → 首页；从首页进入 `/read/<tid>` 点返回 → 回首页（历史存在，`navigate(-1)`）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/site-header.tsx
git commit -m "fix(web): back button falls back to home when no history"
```

---

### Task 10: 章节邻居提取库 + 测试

**Files:**
- Create: `apps/web/src/lib/chapter-nav.ts`
- Test: `apps/web/src/lib/chapter-nav.test.ts`

**Interfaces:**
- Produces:
  - `export type ChapterLinkLike = { tid: string; title: string }`
  - `export type ChapterNeighbor = { prev?: ChapterLinkLike; next?: ChapterLinkLike }`
  - `export function extractChapterNeighbors(contentLinks: ChapterLinkLike[], bodyLinks: ChapterLinkLike[]): ChapterNeighbor`
  - `export function extractBodyChapterLinks(html: string): ChapterLinkLike[]`
- 规则：标题模式 `上一章|上一回|上章`（上侧）与 `下一章|下一回|下章`（下侧）；**不含** `目录|返回目录`；多候选按来源优先级 `[bodyLinks, contentLinks]` 取第一条；两侧都无则返回 `{}`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/lib/chapter-nav.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import {
  extractBodyChapterLinks,
  extractChapterNeighbors,
} from "./chapter-nav"

describe("extractChapterNeighbors", () => {
  test("pre 外「下一章」走 contentLinks（extractor.test.ts 夹具同构）", () => {
    const links = [{ tid: "999", title: "下一章", index: 1 }]
    const res = extractChapterNeighbors(links, [])
    expect(res.next).toEqual({ tid: "999", title: "下一章" })
    expect(res.prev).toBeUndefined()
  })

  test("正文内「上一章」走 bodyLinks", () => {
    const body = [{ tid: "100", title: "上一章" }]
    const res = extractChapterNeighbors([], body)
    expect(res.prev).toEqual({ tid: "100", title: "上一章" })
  })

  test("同侧多候选：body 优先于 contentLinks", () => {
    const links = [{ tid: "1", title: "下一章" }]
    const body = [{ tid: "2", title: "下一章" }]
    const res = extractChapterNeighbors(links, body)
    expect(res.next).toEqual({ tid: "2", title: "下一章" })
  })

  test("目录/返回目录不命中", () => {
    const links = [
      { tid: "3", title: "目录" },
      { tid: "4", title: "返回目录" },
    ]
    expect(extractChapterNeighbors(links, [])).toEqual({})
  })

  test("两侧都无 → {}", () => {
    const links = [{ tid: "5", title: "第一章 开始" }]
    expect(extractChapterNeighbors(links, [])).toEqual({})
  })
})

describe("extractBodyChapterLinks", () => {
  test("解析清洗后 HTML 的站内链接", () => {
    const html =
      '<p>正文</p><a href="/read/100">上一章</a><a href="/read/101?bm=2">下一章</a>'
    expect(extractBodyChapterLinks(html)).toEqual([
      { tid: "100", title: "上一章" },
      { tid: "101", title: "下一章" },
    ])
  })

  test("外链与空标题忽略", () => {
    const html =
      '<a href="https://example.com/x">外链</a><a href="/read/102"></a>'
    expect(extractBodyChapterLinks(html)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test apps/web/src/lib/chapter-nav.test.ts`
Expected: FAIL（`chapter-nav.ts` 不存在 / 函数未定义）。

- [ ] **Step 3: 实现**

`apps/web/src/lib/chapter-nav.ts`：

```ts
/**
 * 论坛章节邻居提取。
 *
 * 数据源（spec §6-2，双来源标题模式，不当作序列）：
 *  - contentLinks：正文 pre 外扩展链接（extractLinksFromDom 输出，tid 数值序、index 非章节号）
 *  - bodyLinks：正文 content 内的站内链接（extractBodyChapterLinks 解析清洗后 HTML）
 * 当前帖 tid 不在任一来源时，依赖标题匹配而非位置。
 */

export type ChapterLinkLike = { tid: string; title: string }
export type ChapterNeighbor = {
  prev?: ChapterLinkLike
  next?: ChapterLinkLike
}

const PREV_RE = /^(上一章|上一回|上章)$/
const NEXT_RE = /^(下一章|下一回|下章)$/

export function extractChapterNeighbors(
  contentLinks: ChapterLinkLike[],
  bodyLinks: ChapterLinkLike[]
): ChapterNeighbor {
  const pick = (re: RegExp) => {
    const fromBody = bodyLinks.find((l) => re.test(l.title.trim()))
    if (fromBody) return fromBody
    return contentLinks.find((l) => re.test(l.title.trim()))
  }
  const prev = pick(PREV_RE)
  const next = pick(NEXT_RE)
  if (!prev && !next) return {}
  return { prev, next }
}

/** 解析清洗后正文 HTML 的站内 /read/:tid 链接（DOMPurify 仅留 href 属性，顺序可控） */
export function extractBodyChapterLinks(
  html: string
): ChapterLinkLike[] {
  const out: ChapterLinkLike[] = []
  const re = /<a\s+href="([^"]*\/read\/([^"?#]+)[^"]*)">([^<]*)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tid = decodeURIComponent(m[2]!)
    const title = m[3]!.trim()
    if (tid && title) out.push({ tid, title })
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test apps/web/src/lib/chapter-nav.test.ts`
Expected: PASS（8 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chapter-nav.ts apps/web/src/lib/chapter-nav.test.ts
git commit -m "feat(web): chapter neighbor extraction lib with tests"
```

---

### Task 11: 章节底栏组件 + ReadPage 接线 + 进度条抬升

**Files:**
- Create: `apps/web/src/components/chapter-nav-bar.tsx`
- Modify: `apps/web/src/components/reading-progress.tsx`
- Modify: `apps/web/src/components/article-view.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`

**Interfaces:**
- Consumes: `extractChapterNeighbors`、`extractBodyChapterLinks`（Task 10）、`readPath`。
- Produces:
  - `ChapterNavBar({ prev?, next?, site }: { prev?: ChapterLinkLike; next?: ChapterLinkLike; site: SiteId })`——两侧都无时返回 null。
  - `ReadingProgress({ progress, bottomOffset? }: { progress: number; bottomOffset?: number })`（默认 0）。
  - `ArticleView` 新可选 prop `progressBottomOffset?: number`，透传给 `ReadingProgress`。

- [ ] **Step 1: chapter-nav-bar.tsx**

```tsx
import { Link } from "react-router-dom"
import { IconChevronLeft, IconChevronRight } from "@/components/icons"
import { readPath, type SiteId } from "@/lib/routes"
import { type ChapterLinkLike } from "@/lib/chapter-nav"

/**
 * 论坛阅读底栏：上一章/下一章。右端留白避让 ItemActions FAB（fixed right-4 z-50）。
 * z-40：盖正文、低于 FAB；进度条经 bottomOffset 抬升到本底栏之上。
 */
export function ChapterNavBar({
  prev,
  next,
  site,
}: {
  prev?: ChapterLinkLike
  next?: ChapterLinkLike
  site: SiteId
}) {
  if (!prev && !next) return null
  return (
    <nav
      aria-label="章节导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-2 pl-3 pr-12 sm:pl-5 sm:pr-14">
        {prev ? (
          <Link
            to={readPath(prev.tid, site)}
            className="inline-flex min-h-10 min-w-0 flex-1 items-center gap-1 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconChevronLeft size={16} />
            <span className="line-clamp-1">{prev.title}</span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <Link
            to={readPath(next.tid, site)}
            className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="line-clamp-1">{next.title}</span>
            <IconChevronRight size={16} />
          </Link>
        ) : (
          <span className="flex-1" />
        )}
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: reading-progress.tsx 加 bottomOffset**

```tsx
export function ReadingProgress({
  progress,
  bottomOffset = 0,
}: {
  progress: number
  bottomOffset?: number
}) {
  const clamped = Math.max(0, Math.min(1, progress))
  const barBottom = `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px))`
  const pctBottom = `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px) + 0.4rem)`
  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-0.5 bg-transparent"
        style={{ bottom: barBottom }}
        aria-hidden
      >
        <div
          className="h-full bg-foreground/30"
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span
        className="pointer-events-none fixed right-2 z-30 text-[10px] leading-none tabular-nums text-muted-foreground/80"
        style={{ bottom: pctBottom }}
        aria-hidden
      >
        {Math.round(clamped * 100)}%
      </span>
    </>
  )
}
```

- [ ] **Step 3: article-view.tsx 透传**

props 类型加 `progressBottomOffset?: number`；渲染处：

```tsx
{progress !== undefined && (
  <ReadingProgress
    progress={progress}
    bottomOffset={progressBottomOffset}
  />
)}
```

- [ ] **Step 4: ReadPage 接线**

import 追加（`useMemo` 需加进现有 react import）：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChapterNavBar } from "@/components/chapter-nav-bar"
import {
  extractBodyChapterLinks,
  extractChapterNeighbors,
} from "@/lib/chapter-nav"
```

`content` 加载后计算邻居（放在 return 前）：

```tsx
const neighbors = useMemo(() => {
  if (!content) return { prev: undefined, next: undefined }
  return extractChapterNeighbors(
    content.links ?? [],
    extractBodyChapterLinks(content.content)
  )
}, [content])

const showChapterNav = Boolean(neighbors.prev || neighbors.next)
```

渲染：`<AsyncBody>` 外包一层防遮挡 padding，底栏与工具栏并列：

```tsx
<PageShell showBack maxWidth={settings.maxWidth}>
  <div className={showChapterNav ? "pb-14" : undefined}>
    <AsyncBody ...>...</AsyncBody>
  </div>
  <ChapterNavBar prev={neighbors.prev} next={neighbors.next} site={site} />
  <ReadingSelectionToolbar ... />
```

`ArticleView` 传 `progressBottomOffset={showChapterNav ? 48 : 0}`（48 = 底栏 `h-12`，`pb-14` 与 safe-area 实测微调）。

- [ ] **Step 5: 验证**

Run: `bun test apps/web/src/lib/chapter-nav.test.ts` → PASS；`bun run --filter=web typecheck` → PASS。
浏览器：
- 多章连载帖（含 pre 外「下一章」，对应 `extractor.test.ts:8-24` 夹具结构）：底栏出现，上一章/下一章跳转 tid 正确。
- 单帖/无上/下链接帖：底栏不显示。
- 有底栏时：进度条在底栏**上方**仍可见、FAB（右下设置钮）不被遮挡、正文底部（回复区/扩展链接）不被底栏遮住。
- 书库章节页 `/book/...?chapter=N`：底栏不出现（书库走内联 prev/next）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chapter-nav-bar.tsx apps/web/src/components/reading-progress.tsx apps/web/src/components/article-view.tsx apps/web/src/pages/ReadPage.tsx
git commit -m "feat(web): forum chapter nav bar with progress lift"
```

---

### Task 12: 可达性：skip-to-main + confirm-dialog 焦点

**Files:**
- Modify: `apps/web/src/components/site-header.tsx`
- Modify: `apps/web/src/components/page-shell.tsx`（Task 3 Step 2 已加 `id="main"`，此处确认无遗漏）
- Modify: `apps/web/src/components/confirm-dialog.tsx`

**Interfaces:**
- 无对外变化。

- [ ] **Step 1: skip-to-main 链接**

`site-header.tsx` 的 `<header>` 内、`{showBack ? ... : null}` 之前插入：

```tsx
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
>
  跳到正文
</a>
```

确认 `page-shell.tsx` 的 `<main id="main" tabIndex={-1}>` 已存在（Task 3 Step 2 已加）。

- [ ] **Step 2: confirm-dialog Tab trap + 焦点归还**

`ConfirmProvider` 内新增 ref 与 keydown：

```tsx
const dialogRef = useRef<HTMLDivElement | null>(null)
const prevFocusRef = useRef<HTMLElement | null>(null)
```

`confirm` 回调开头（`setOpts` 之前）记录触发元素：

```tsx
prevFocusRef.current =
  document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
```

`finish` 中（清 `opts` 之后）归还焦点：

```tsx
const prev = prevFocusRef.current
if (prev && document.contains(prev)) prev.focus()
```

`role="alertdialog"` 的 `<div>` 加 `ref={dialogRef}` 与 `onKeyDown`：

```tsx
onKeyDown={(e) => {
  if (e.key !== "Tab") return
  const el = dialogRef.current
  if (!el) return
  const focusables = Array.from(
    el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  )
  if (focusables.length === 0) return
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}}
```

（Escape 关闭已存在，勿重复加；`CharacterMarkPopover` / `ReadingSelectionToolbar` 非 modal，不硬套 trap。）

- [ ] **Step 3: 验证**

Run: `bun run --filter=web typecheck` → PASS。
浏览器（键盘）：
- Tab 首键落在「跳到正文」（可见时在左上）。
- `/history` 点「清空本页」开确认框：Tab 在取消/确认间循环（不逃出）；Shift+Tab 反向循环；关闭后焦点回到「清空本页」按钮。
- 阅读页选中文字调出工具栏、关闭角色弹层，焦点行为不回归。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/site-header.tsx apps/web/src/components/page-shell.tsx apps/web/src/components/confirm-dialog.tsx
git commit -m "feat(web): skip-to-main link, dialog tab trap and focus restore"
```

---

## 最终验证

```bash
bun run test        # 含 chapter-nav.test.ts（turbo → apps/web bun test）
bun run typecheck
bun run build
```

浏览器回归：导航两档（<768 / ≥768 与 820）、站点 Tab、三页 xwide、热力图触摸/键盘、列表卡片、跳页输入与 clamp、阅读底栏与进度条/FAB 共存、返回兜底、键盘可达性。
