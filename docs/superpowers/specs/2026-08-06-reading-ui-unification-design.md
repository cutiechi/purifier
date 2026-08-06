# 阅读页 UI 统一与进度条设计

日期：2026-08-06
状态：已通过 brainstorming，待写实施计划

## 与已有 spec 的关系

`2026-08-06-reading-experience-design.md` 已实现并落地（其 §1–§3）：

- 阅读设置系统（`apps/web/src/components/reading-settings.tsx`，localStorage `purifier:reading`）
- `ArticleView` 衬线排版改造（`article-view.tsx`，`.reading-body`）
- 阅读进度记忆（`apps/web/src/hooks/use-reading-progress.ts` + 后端 `PUT /api/me/progress` + 列表卡片「已读 X%」）

本 spec 在其**已落地的基础上**做两件事，不重复造进度系统、不重做排版：

1. **进度条可视化**：阅读进度数据已由 `useReadingProgress` 采集并存后端，但阅读页本身无可视化进度条。本次补一个底部进度条。
2. **UI 风格统一**：阅读偏好面板用原生 `<select>`/`<input range>`，与全站 Tailwind/oklch token 体系脱节；阅读页操作区混用圆形/胶囊两种按钮形态。本次建一组视觉原语，把操作区与设置面板收敛进单个统一浮层。

## 不改的部分（明确边界）

本 spec 只动**视觉与交互层**，存储机制保持现状：

- localStorage `purifier:reading`（阅读偏好）—— 不动
- 后端 `/api/me/*` + SQLite（收藏/标签/进度/历史）—— 不动
- `next-themes`（站点主题，顶栏 `ModeToggle` + `d` 键）—— 不动，不收进本次浮层

## 背景：现状的三处割裂

| 位置 | 问题 |
| --- | --- |
| 阅读偏好面板（`reading-settings-panel.tsx`） | 用原生 `<select>` 和裸 `<input type="range">`，是全站唯一一处原生控件，不跟随 oklch 色板，dark 模式下突兀 |
| 阅读页操作区（`item-actions.tsx:100-156`） | 混三种按钮形态：胶囊文字按钮（收藏/刷新/编辑标签/保存/取消，`rounded-lg bg-muted/70`）+ 圆角标签 chip（`rounded-md`）+ 圆形带边框齿轮（`rounded-full border`，全站唯一圆形按钮） |
| 设置面板展开方式 | 齿轮点击后 `ReadingSettingsPanel` 以 `w-full` 块撑开，把正文往下推，视觉跳跃大 |

收藏/标签 chip 本身（`rounded-md bg-muted/70 text-[11px]`）与胶囊按钮还算协调，最需重做的是阅读偏好的原生控件、齿轮按钮形态、面板展开方式。

## §1 整体架构

自底向上三层：

1. **视觉原语层** `apps/web/src/components/ui/`（新目录），新增可复用控件：
   - `SegmentedControl`——分段按钮组（替代原生 `select`）
   - 定制 `<input type="range">` 的 CSS（替代裸滑块）
   - `Popover`——轻量浮层（自建，不引 radix）
2. **统一操作浮层**：把 `ItemActions` 的全部操作（收藏/刷新/标签）+ 阅读偏好面板内容收敛进单个 `Popover`，trigger 是单个图标按钮。
3. **进度条**：底部 fixed 细条，复用 `useReadingProgress` 的采样值。

### 文件落点

| 动作 | 文件 |
| --- | --- |
| 新增 | `apps/web/src/components/ui/segmented-control.tsx` |
| 新增 | `apps/web/src/components/ui/popover.tsx` |
| 新增 | `apps/web/src/components/reading-progress.tsx` |
| 改 CSS | `packages/ui/src/styles/globals.css`（滑块样式，见 §2.2） |
| 改写 | `apps/web/src/components/reading-settings-panel.tsx`（用原语重做，作为浮层下半部分的子组件） |
| 改写 | `apps/web/src/components/item-actions.tsx`（全部操作 + 偏好收进 `Popover`） |
| 改 | `apps/web/src/components/article-view.tsx`（`ArticleView` 加可选 `progress` prop，渲染底部进度条） |
| 改 | `apps/web/src/hooks/use-reading-progress.ts`（对外返回 `progress` state） |
| 改 | `apps/web/src/pages/ReadPage.tsx`、`apps/web/src/pages/BookPage.tsx`（传 `progress` 给 `ArticleView`） |

## §2 视觉原语

所有原语只消费 `globals.css` 已有 token（`--muted`/`--card`/`--popover`/`--border`/`--accent`），不引入新色值。

### 2.1 SegmentedControl

`apps/web/src/components/ui/segmented-control.tsx`，替代原生 `<select>`。

```ts
interface Option<T> { value: T; label: ReactNode }
interface Props<T> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  "aria-label"?: string
}
```

视觉（与标签 chip、`bg-muted/70` 操作按钮同语言）：

- 容器：`inline-flex rounded-lg bg-muted/60 p-0.5`
- 每项：`rounded-md px-2.5 py-1 text-xs`，移动端 `min-h-9`，桌面 `sm:min-h-0`——与收藏/刷新按钮同高同圆角
- 选中项：`bg-card text-foreground shadow-sm`
- 未选中：`text-muted-foreground hover:text-foreground`
- 键盘：原生 `<button>`，自带 Tab/Enter/Space 无障碍

### 2.2 定制滑块（保留原生 `<input type="range">`）

**决策：保留原生 `<input type="range">`，只加定制样式。** 原生滑块自带键盘/移动端无障碍和拖拽；自建 div 拖拽要重写 `pointerdown/move/up` + `keydown` + 触屏，风险高收益低。问题只出在裸样式不跟色板。

在 `packages/ui/src/styles/globals.css` 追加（项目样式集中于此，所有 token 与 `.reading-body` 都在），用 `accent-color` + `-webkit-slider-thumb` 定制：

- 轨道与拇指用 `--accent`/`--card`
- 数值在标签右侧用 `tabular-nums` 显示（复用面板现有 `fontSize px` / `lineHeight.toFixed(1)` 写法）

### 2.3 Popover

`apps/web/src/components/ui/popover.tsx`，自建，不引 radix——保持项目「零运行时 UI 框架」现状。

```ts
interface Props {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"   // 相对 trigger 的水平对齐，默认 "end"
  className?: string        // 面板额外类名
}
```

行为：

- trigger 外包 `relative inline-flex`，面板 `absolute` 定位其下
- `align="end"`（默认，阅读页 trigger 在右侧）时面板 `right-0`，避免溢出视口右侧
- 三路关闭：点外面（`pointerdown` listener）、按 Escape、再点 trigger toggle
- 用 `--popover`/`--popover-foreground` token，`rounded-xl border border-border shadow-lg p-3 min-w-[240px]`
- **不做 portal**：阅读页 `<article>` 和 `<main>` 都没有 `overflow:hidden`，`absolute` 不会被裁剪。实测发现裁剪再升级 portal（YAGNI）

## §3 统一操作浮层（合并操作区 + 阅读偏好）

把原 `ItemActions` 的全部操作 + `ReadingSettingsPanel` 内容收进单个 `Popover`。操作区从「一排 5 个胶囊/圆形按钮」收敛为「单个 trigger → 浮层」。

### 3.1 trigger

- 图标：lucide `Settings2`（与原齿轮一致，认知迁移成本低）
- 形态：从圆形 `rounded-full border` 改为与刷新按钮同语言的方形图标按钮——`inline-flex size-8 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`
- **收藏状态可见性**（关键）：全收进浮层后，trigger 是唯一外部可见物，必须反映收藏状态。`state?.favorited` 为真时 trigger 套用收藏按钮现有的 amber 高亮（`text-amber-500 bg-amber-400/15 dark:text-amber-400`），并在 `Settings2` 旁叠一个 `Star size-3` 小图标。未收藏时中性 `bg-muted/70`。

### 3.2 浮层内部结构

```
[⚙] ▾
┌──────────────────────────────────┐  Popover (w-72, 来自 §2.3)
│ [★ 已收藏]  /  [☆ 收藏]          │  ← 全宽收藏 toggle
│ [↻ 刷新]                         │  ← 全宽刷新（刷新中 spin）
│ [编辑标签]  #a #b                 │  ← 标签：chip 预览 + 编辑入口
│ ────────────────────────────────│  ← 分隔线 border-t border-border my-2
│  阅读偏好                         │  ← 小标题 text-xs text-muted-foreground
│  字体 [衬线|无衬线|等宽]          │  ← SegmentedControl（§2.1）
│  字号 ──●────── 17px             │  ← 定制 range + tabular-nums（§2.2）
│  行高 ─●──────── 1.8            │
│  栏宽 [标准|宽屏]                │  ← SegmentedControl
│  恢复默认                         │  ← 文字按钮（§3.4）
└──────────────────────────────────┘
```

### 3.3 操作行（浮层上半部分）

操作按钮（收藏/刷新/标签）从胶囊形改为**全宽行式布局**，更适合菜单语境：

- `flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm hover:bg-accent`
- 收藏行：左侧图标 + 文案（已收藏时文案「已收藏」+ amber 高亮整行；未收藏「收藏」），点击 toggle
- 刷新行：左侧 `IconRefreshCw`（`refreshing` 时 `animate-spin`）+ 文案「刷新」，点击 `onRefresh`
- 标签行：显示 `TagChips`（现有 chip 预览）+「编辑」按钮；点编辑原地展开 input（复用 `TagEditor` 逻辑，但全宽布局）；保存调 `PUT /api/me/tags`

### 3.4 阅读偏好子组件（浮层下半部分）

`reading-settings-panel.tsx` 改写为只渲染偏好那几行的子组件，作为浮层下半部分复用：

| 字段 | 原控件 | 新控件 | 备注 |
| --- | --- | --- | --- |
| 字体（serif/sans/mono） | `<select>` | `SegmentedControl` | 3 项 |
| 字号（14–22） | `<range>` | 定制 `<range>` + 右侧数值 | 数值 `tabular-nums` |
| 行高（1.4–2.2） | `<range>` | 定制 `<range>` + 右侧数值 | 数值 `1.8` 格式 |
| 栏宽（normal/wide） | `<select>` | `SegmentedControl` | 2 项 |

每行结构：图标 + 标签（左，`text-muted-foreground`）+ 控件（右），`gap-3`。标签图标沿用 `Type`/`Settings2`/`AlignLeft`/`Maximize2`（lucide，已 import）。

底部「恢复默认」文字按钮：`text-xs text-muted-foreground hover:text-foreground`，调 `update(...DEFAULT_READING_SETTINGS)`。用户调乱字号后可一键回到 serif/17px/1.8/normal。

### 3.5 ItemActions 改造后形态

```tsx
<Popover trigger={<SettingsButton favorited={state?.favorited} />}>
  <div className="flex flex-col gap-1">
    <FavoriteRow ... />
    <RefreshRow ... />
    <TagRow ... />
    <div className="border-t border-border my-2" />
    <ReadingSettingsPanel />
  </div>
</Popover>
```

`showSettings` state 和原 `w-full` 展开逻辑删除——开关状态收到 `Popover` 内部。收藏/刷新/标签的业务逻辑（`toggleFavorite`/`onRefresh`/`saveTags`/`removeTag`）原样保留，只改触发它们的 UI 形态。

## §4 进度条

### 4.1 数据来源

复用现有 `useReadingProgress`。改造：hook 内部用 `lastProgress.current`（ref）存采样值只对内，现额外返回 `progress: number`（0–1）state 供进度条订阅：

- hook 内 `useState<number>(0)`，`onScroll` 里除了更新 `lastProgress.current` 也 `setProgress(p)`
- 返回 `{ progress }`；`restore`/`flush` 逻辑完全不动
- scroll 期间每帧 setState 是进度条的常见模式（`onScroll` 已 `{ passive: true }`，React 18 自动批处理）；若实测掉帧再加 rAF 节流，先按最简来

`ReadPage`/`BookPage` 从 `useReadingProgress(opts)` 解构出 `progress`，传给 `ArticleView`。

### 4.2 ReadingProgress 组件

`apps/web/src/components/reading-progress.tsx`：

```ts
function ReadingProgress({ progress }: { progress: number })
// progress 已 clamp 到 0–1
```

**定位：底部 fixed，宽度匹配阅读列宽**（非全屏宽、非 sticky）。理由：

- sticky 在 `<article>` 内部放底部不可行——进度条作为 article 最后子元素，用户滚到文章末尾附近才进入视口，中段时在视口外下方看不到
- fixed 贴视口底，阅读时始终可见；宽度匹配正文列宽，与正文视觉一体，随栏宽设置（normal/wide）变化

```
            ═══════════════════════════   ← 居中，max-w-3xl/4xl，与正文对齐
```

实现：`fixed bottom-0 left-1/2 -translate-x-1/2` + 复用 `readingMaxWidthClass(maxWidth)`（`reading-settings.tsx:122`）。

填充条：

- 容器：`h-0.5 w-full bg-transparent`（底色透明，仅填充条可见）
- 填充：`h-full bg-foreground/30 transition-[width] duration-150 ease-out`，`style={{ width: \`${progress * 100}%\` }}`
- `progress === 0` 时 `width:0` 不占位；`progress === 1`（读完）保持满条（读完也是进度信息）
- 颜色用 `bg-foreground/30` 而非品牌色——阅读场景需克制，且自动适配 dark/light

### 4.3 挂载点

`ArticleView`（`article-view.tsx:57-93`）是两阅读页共用最外层 `<article>`。新增可选 prop `progress?: number`，不传则不渲染进度条（其他用到 `ArticleView` 的地方不受影响）。

进度条在 `ArticleView` 内条件渲染（`progress !== undefined && <ReadingProgress ... />`）——调用方只传一个 prop，封装干净；`fixed` 定位与视口绑定，不依赖 `<article>` 的 DOM 嵌套关系，放在 `ArticleView` 内只是组件组合上的就近原则，不影响定位行为。

```tsx
// ArticleView 内
{progress !== undefined && <ReadingProgress progress={progress} />}
```

## §5 推进策略

每步独立可验证、独立 commit：

1. §2 视觉原语（`SegmentedControl` + 滑块 CSS + `Popover`）—— 纯新增，不影响现有 UI
2. §4 进度条（hook 返回 progress + `ReadingProgress` 组件 + `ArticleView` prop + 两阅读页接入）—— 独立可验收
3. §3 统一操作浮层（改写 `reading-settings-panel` + 改写 `item-actions` + 接入）—— 最后做，依赖 §2

## 验证

`apps/web` 无前端测试框架，本次也不引入（与项目现状一致）。正确性靠手动验证 + 类型/构建：

```bash
bun run typecheck
bun run build
```

手动验收点：

- 打开任意帖子/书库正文，底部出现进度条，滚动时填充随之变化，宽度与正文对齐
- 切换栏宽（normal/wide），进度条宽度跟随
- trigger 单个按钮，点击打开浮层；已收藏时 trigger 显 amber 高亮 + Star 角标
- 浮层内收藏 toggle、刷新、标签编辑、字体/字号/行高/栏宽、恢复默认全部可用
- 点浮层外、按 Escape、再点 trigger 三路关闭均生效
- dark/light 模式下控件配色正确跟随
