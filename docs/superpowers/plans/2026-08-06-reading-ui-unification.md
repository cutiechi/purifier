# 阅读页 UI 统一与进度条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已落地的阅读体验基础上，新增底部进度条可视化，并把阅读页操作区 + 阅读偏好面板收敛进单个统一浮层，消除原生控件与按钮形态的视觉割裂。

**Architecture:** 三层自底向上——(1) 新建 `components/ui/` 原语层（SegmentedControl + 自建 Popover + 定制 range CSS）；(2) 进度条组件复用 `useReadingProgress` 采样值；(3) 改写 `ItemActions` 把收藏/刷新/标签/偏好全收进 Popover。存储机制（localStorage `purifier:reading`、后端 `/api/me/*`、next-themes）完全不动。

**Tech Stack:** React 19 + TypeScript strict、Tailwind CSS 4（oklch token）、lucide-react 图标、Vite。前端无测试框架（与项目现状一致），靠 `bun run typecheck` + `bun run build` + 手动验收。

## Global Constraints

- TypeScript `strict`；代码风格由 Prettier 定义：**无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`**。
- 跨包导入用 `@workspace/...`；前端页内导入用 `@/`。
- 样式只消费 `globals.css` 已有 token（`--muted`/`--card`/`--popover`/`--border`/`--accent`/`--foreground`），不引入新色值。
- 图标优先 lucide-react（已在用）；项目自建图标在 `apps/web/src/components/icons.tsx`（`IconStar` 带 `filled` prop、`IconRefreshCw`、`IconClose` 已存在）。
- 只动视觉/交互层：**不碰** localStorage key、不碰 `/api/me/*`、不碰 next-themes、不碰 `extractor`。
- `apps/web` 无前端测试框架，本次不引入。每个任务验收 = `bun run typecheck` + `bun run build` 通过 + 手动验收点。

**对照 spec**：`docs/superpowers/specs/2026-08-06-reading-ui-unification-design.md`

---

## File Structure

| 动作 | 文件 | 职责 |
| --- | --- | --- |
| 新增 | `apps/web/src/components/ui/segmented-control.tsx` | 分段按钮组原语，替代原生 select |
| 新增 | `apps/web/src/components/ui/popover.tsx` | 轻量浮层原语（自建，三路关闭 + 高度约束 + a11y） |
| 新增 | `apps/web/src/components/reading-progress.tsx` | 底部 fixed 全宽进度条 |
| 改 CSS | `packages/ui/src/styles/globals.css` | 追加 `.reading-range` 滑块样式（webkit + moz） |
| 改写 | `apps/web/src/components/reading-settings-panel.tsx` | 用原语重做，去外壳，作为浮层下半部分 |
| 改写 | `apps/web/src/components/item-actions.tsx` | 全部操作 + 偏好收进单个 Popover |
| 改 | `apps/web/src/components/article-view.tsx` | `ArticleView` 加 `progress?` prop，条件渲染进度条 |
| 改 | `apps/web/src/hooks/use-reading-progress.ts` | 返回 `{ progress }`；restore/id 重置同步 |
| 改 | `apps/web/src/pages/ReadPage.tsx`、`BookPage.tsx` | 解构 progress 传给 ArticleView |

依赖方向：Task 1-3（原语）互相独立 → Task 4（进度条，依赖 hook 改造）→ Task 5（面板重做，依赖 Task 1+3）→ Task 6（ItemActions 收敛，依赖 Task 2+5）。

---

## Task 1: SegmentedControl 原语

**Files:**
- Create: `apps/web/src/components/ui/segmented-control.tsx`

**Interfaces:**
- Produces: `SegmentedControl<T>(props)` —— 泛型分段控件

```ts
interface SegmentedOption<T> { value: T; label: ReactNode }
interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  "aria-label"?: string
}
export function SegmentedControl<T>(props: SegmentedControlProps<T>): JSX.Element
```

- [ ] **Step 1: 创建组件文件**

创建 `apps/web/src/components/ui/segmented-control.tsx`：

```tsx
import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

interface SegmentedOption<T> {
  value: T
  label: ReactNode
}

interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  "aria-label"?: string
}

export function SegmentedControl<T>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg bg-muted/60 p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex min-h-9 items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS（组件未被使用，但类型须自洽；`@workspace/ui/lib/utils` 的 `cn` 已在 `tag-chips.tsx` 等处使用，确认存在）

- [ ] **Step 3: build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/segmented-control.tsx
git commit -m "feat(web): add SegmentedControl primitive"
```

---

## Task 2: Popover 原语

**Files:**
- Create: `apps/web/src/components/ui/popover.tsx`

**Interfaces:**
- Produces: `Popover(props)` —— 浮层容器，trigger 触发，三路关闭

```ts
interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"   // 默认 "end"
  className?: string        // 面板额外类名
  triggerAriaLabel: string  // trigger 的 aria-label（强制，a11y）
}
export function Popover(props: PopoverProps): JSX.Element
```

行为契约（spec §2.3 + §2.4 + §2.5）：
- 三路关闭：点外面（`pointerdown` + contain 检测，面板内交互不冒泡）、Escape（默认关；但面板内元素可 `e.stopPropagation()` 拦截，如标签编辑态）、再点 trigger toggle
- 面板 `absolute z-50`，`align="end"` 时 `right-0`，`align="start"` 时 `left-0`
- 高度约束：`max-h-[min(24rem,calc(100dvh-2rem))] overflow-y-auto`
- a11y：trigger `aria-expanded`/`aria-haspopup="dialog"`；关闭后 `trigger.focus()`
- 故意不做焦点陷阱（轻量菜单，Tab 可穿出）

- [ ] **Step 1: 创建组件文件**

创建 `apps/web/src/components/ui/popover.tsx`：

```tsx
import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"
  className?: string
  triggerAriaLabel: string
}

export function Popover({
  trigger,
  children,
  align = "end",
  className,
  triggerAriaLabel,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // 统一关闭：三路（外点 / Esc / toggle 关）共用，都回焦到 trigger。
  // 不能各自直接 setOpen(false) —— 外点路径会漏 focus（review Issue 1）。
  const close = () => {
    setOpen(false)
    // 下一帧回焦，避免与触发关闭的 click 同帧冲突
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  // 点外面关闭：wrapperRef contain 检测，面板内交互不冒泡关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  // Escape 关闭：若焦点在可编辑元素上，留给该元素自己处理（如标签编辑态先取消编辑），
  // 不关层（review Issue 2 方案 1 —— 不依赖 stopPropagation 冒泡路径，更硬）。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      const editable =
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        t?.isContentEditable === true
      if (editable) return // 可编辑元素的 Esc 由它自己处理
      close()
    }
    // 必须 bubble 阶段监听（默认），capture 会先于 input 触发导致拦不住
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={triggerAriaLabel}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          className={cn(
            "absolute top-full z-50 mt-1 min-w-[240px] max-h-[min(24rem,calc(100dvh-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg",
            align === "end" ? "right-0" : "left-0",
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
```

注意：
- `trigger` 是 ReactNode（图标内容），Popover 自己包 `<button>` 以统一管理 `ref`/`aria`/`onClick`。trigger 元素本身不要再是 button
- 外层 button 加 `inline-flex p-0 focus-visible:ring`（review Issue 3）——避免基线空隙、补键盘 focus 环
- `aria-controls={open ? panelId : undefined}`（review Issue 5）关联合上 trigger 与面板
- 三路关闭（外点 / Esc / toggle 关）统一走 `close()`，都回焦（review Issue 1）
- Esc 路径对可编辑 target（input/textarea/contenteditable）直接 return，不关层（review Issue 2 方案 1）——比依赖 `stopPropagation` 冒泡路径更稳，capture 监听或 window 监听场景下都成立

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS

若报 `RefAttributes` 未用，移除该 import（保留 `ReactNode`）。若 `useId` 在 strict 下 OK（React 19 已稳定）。

- [ ] **Step 3: build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/popover.tsx
git commit -m "feat(web): add Popover primitive"
```

---

## Task 3: 定制 range 滑块 CSS

**Files:**
- Modify: `packages/ui/src/styles/globals.css`（末尾追加）

**Interfaces:**
- Produces: CSS class `.reading-range`，供 `<input type="range" className="reading-range">` 使用

- [ ] **Step 1: 在 globals.css 末尾追加滑块样式**

在 `packages/ui/src/styles/globals.css` 文件**末尾**（`.reading-body p:last-child` 块之后）追加：

```css
/* 阅读偏好滑块：webkit + moz 一致，跟随 oklch token */
input[type="range"].reading-range {
  accent-color: var(--accent);
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  height: 1.25rem;
  cursor: pointer;
}
input[type="range"].reading-range::-webkit-slider-runnable-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--muted);
}
input[type="range"].reading-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  margin-top: -0.375rem;
  height: 1rem;
  width: 1rem;
  border-radius: 9999px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.15);
}
input[type="range"].reading-range::-moz-range-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--muted);
}
input[type="range"].reading-range::-moz-range-thumb {
  height: 1rem;
  width: 1rem;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--card);
}
input[type="range"].reading-range::-moz-range-progress {
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--accent);
}
```

- [ ] **Step 2: build 验证 CSS 编译**

Run: `bun run build`
Expected: PASS（Tailwind 4 + Vite 处理 globals.css，纯 CSS 追加不影响 TS）

- [ ] **Step 3: 手动验证（可选，确认滑块外观）**

此时 `.reading-range` 无消费者，无法直接看到。可在 Task 5 完成后回验。此步仅确保 build 不破。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles/globals.css
git commit -m "style(ui): add .reading-range slider styling (webkit + moz)"
```

---

## Task 4: useReadingProgress 返回 progress + ReadingProgress 组件

**Files:**
- Modify: `apps/web/src/hooks/use-reading-progress.ts`
- Create: `apps/web/src/components/reading-progress.tsx`
- Modify: `apps/web/src/components/article-view.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx:31-35`
- Modify: `apps/web/src/pages/BookPage.tsx:27-31`

**Interfaces:**
- Consumes: 现有 `useReadingProgress(kind, id, opts)` —— 现返回 void
- Produces: `useReadingProgress` 改为返回 `{ progress: number }`；`ReadingProgress({ progress })` 组件；`ArticleView` 新增可选 `progress?: number` prop

**关键（spec §4.1，review Issue 1）**：restore 路径用 programmatic `scrollTo`，不触发 scroll event。若只在 `onScroll` 里 `setProgress`，打开已读文章进度条卡 0。须在 restore 的 scrollTo 之后 + id 重置时也 setProgress。

- [ ] **Step 1: 改造 use-reading-progress.ts 返回 progress**

修改 `apps/web/src/hooks/use-reading-progress.ts`。**只列改动点，不重写整个文件**：

1. 顶部 import 加 `useState`：
```tsx
import { useEffect, useRef, useState } from "react"
```

2. 在 `useReadingProgress` 函数体开头（`const writeTimer = ...` 之前）加 progress state：
```tsx
const [progress, setProgress] = useState(0)
```

3. restore effect 内，双 rAF 回调的 `scrollTo` 之后加 `setProgress`（spec §4.1）。找到这段：
```tsx
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max > 0) window.scrollTo(0, Math.round(target * max))
      })
    )
```
改为：
```tsx
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max > 0) {
          window.scrollTo(0, Math.round(target * max))
          setProgress(target) // 恢复后立即同步进度条（programmatic scroll 不触发 scroll event）
        } else {
          setProgress(0) // 短文（max<=0）不显示进度，与 onScroll 兜底一致（review Issue 4）
        }
      })
    )
```

4. 写入 effect 的开头（`if (!opts.ready) return` 之后），id 切换重置处加 `setProgress(0)`。找到：
```tsx
    if (!opts.ready) return
    // id 变化时（同组件实例复用）重置采样，避免串用上一篇的进度
    lastProgress.current = null
    lastSent.current = null
```
改为：
```tsx
    if (!opts.ready) return
    // id 变化时（同组件实例复用）重置采样，避免串用上一篇的进度
    lastProgress.current = null
    lastSent.current = null
    setProgress(0)
```

5. `onScroll` 内，更新 `lastProgress.current` 处同时 `setProgress`。找到：
```tsx
    const onScroll = () => {
      const p = computeProgress()
      if (p !== null) lastProgress.current = p
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    }
```
改为：
```tsx
    const onScroll = () => {
      const p = computeProgress()
      if (p !== null) {
        lastProgress.current = p
        setProgress(p)
      }
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    }
```

6. 文件末尾，函数签名结尾的 `}` 前加 return。当前函数以写入 effect 的 `}, [opts.ready, kind, id])` 结束，在其后加：
```tsx
  return { progress }
```

最终函数签名从 `export function useReadingProgress(...)` 无返回，变为返回 `{ progress: number }`。

- [ ] **Step 2: 创建 reading-progress.tsx 组件**

创建 `apps/web/src/components/reading-progress.tsx`：

```tsx
export function ReadingProgress({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress))
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-0.5 bg-transparent"
      style={{ bottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-hidden
    >
      <div
        className="h-full bg-foreground/30"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  )
}
```

要点（spec §4.2）：
- `fixed inset-x-0 bottom-0` 全宽贴视口底
- `bottom: env(safe-area-inset-bottom, 0px)` 让出 iOS Home Indicator（review Issue 11）
- `bg-foreground/30` 克制配色，自动适配 dark/light
- **无 width transition**（review Issue 8）——避免 scroll 时进度条滞后
- `pointer-events-none` + `aria-hidden`——纯装饰，不拦截点击
- `z-30` 低于 Popover 的 z-50，避免遮挡浮层

- [ ] **Step 3: ArticleView 加 progress prop + 条件渲染**

修改 `apps/web/src/components/article-view.tsx`。

1. 顶部 import 加 `ReadingProgress`：
```tsx
import { ReadingProgress } from "@/components/reading-progress"
```

2. `ArticleView` 的 props 类型加 `progress?: number`。找到：
```tsx
export function ArticleView({
  title,
  meta,
  contentHtml,
  sourceUrl,
  currentTid,
  actions,
  footer,
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
}) {
```
改为：
```tsx
export function ArticleView({
  title,
  meta,
  contentHtml,
  sourceUrl,
  currentTid,
  actions,
  footer,
  progress,
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
  progress?: number
}) {
```

3. 在 `return` 的 `<article>` 内、`</article>` 之前，加条件渲染。找到：
```tsx
      <ContentBody html={contentHtml} />

      {footer}
    </article>
  )
}
```
改为：
```tsx
      <ContentBody html={contentHtml} />

      {footer}

      {progress !== undefined && <ReadingProgress progress={progress} />}
    </article>
  )
}
```

- [ ] **Step 4: ReadPage 解构 progress 传入**

修改 `apps/web/src/pages/ReadPage.tsx`。

1. 找到（`:31-35`）：
```tsx
  useReadingProgress("post", tid, {
    ready: loadedTid === tid,
    stateReady: state !== null && state.id === tid,
    restore: state?.id === tid ? state.read_progress : undefined,
  })
```
改为：
```tsx
  const { progress } = useReadingProgress("post", tid, {
    ready: loadedTid === tid,
    stateReady: state !== null && state.id === tid,
    restore: state?.id === tid ? state.read_progress : undefined,
  })
```

2. `<ArticleView>` 加 `progress` prop。找到：
```tsx
            <ArticleView
              title={content.title}
              meta={content.meta ?? {}}
              contentHtml={content.content}
              sourceUrl={content.url}
              currentTid={tid}
              actions={
```
改为（在 `currentTid={tid}` 后插入一行）：
```tsx
            <ArticleView
              title={content.title}
              meta={content.meta ?? {}}
              contentHtml={content.content}
              sourceUrl={content.url}
              currentTid={tid}
              progress={progress}
              actions={
```

- [ ] **Step 5: BookPage 同样处理**

修改 `apps/web/src/pages/BookPage.tsx`。

1. 找到（`:27-31`）：
```tsx
  useReadingProgress("book", cid, {
    ready: loadedCid === cid,
    stateReady: state !== null && state.id === cid,
    restore: state?.id === cid ? state.read_progress : undefined,
  })
```
改为：
```tsx
  const { progress } = useReadingProgress("book", cid, {
    ready: loadedCid === cid,
    stateReady: state !== null && state.id === cid,
    restore: state?.id === cid ? state.read_progress : undefined,
  })
```

2. `<ArticleView>` 加 `progress` prop。找到：
```tsx
            <ArticleView
              title={book.title}
              meta={{ author: book.meta?.author }}
              contentHtml={book.content}
              sourceUrl={book.url}
              actions={
```
改为（在 `sourceUrl={book.url}` 后插入一行）：
```tsx
            <ArticleView
              title={book.title}
              meta={{ author: book.meta?.author }}
              contentHtml={book.content}
              sourceUrl={book.url}
              progress={progress}
              actions={
```

- [ ] **Step 6: typecheck**

Run: `bun run typecheck`
Expected: PASS。重点确认：`useReadingProgress` 返回类型变更后，`ReadPage`/`BookPage` 解构无类型错误。

- [ ] **Step 7: build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 8: 手动验收**

启动 `bun run dev`，打开任意帖子/书库正文：
- 底部出现细条，滚动时填充随之变化（无 transition 滞后）
- 打开**已有进度**的文章（历史里读过一篇）：进度条初始宽度 ≈ 已读比例（无需先滚动）
- 不足一屏的短文：进度条为空（0），不误显示满条
- 进度条贯穿视口底部全宽

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/hooks/use-reading-progress.ts \
        apps/web/src/components/reading-progress.tsx \
        apps/web/src/components/article-view.tsx \
        apps/web/src/pages/ReadPage.tsx \
        apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): add bottom reading progress bar"
```

---

## Task 5: 改写 ReadingSettingsPanel（用原语，去外壳）

**Files:**
- Rewrite: `apps/web/src/components/reading-settings-panel.tsx`

**Interfaces:**
- Consumes: `useReadingSettings()`（`reading-settings.tsx`，已存在）；`SegmentedControl`（Task 1）；`.reading-range` CSS（Task 3）；`DEFAULT_READING_SETTINGS`（`reading-settings.tsx:20`，已 export）
- Produces: `ReadingSettingsPanel()` —— 无 props，读 `useReadingSettings`，渲染偏好那几行（**无外壳**，由外层 Popover 提供容器）

- [ ] **Step 1: 重写 reading-settings-panel.tsx**

整个文件替换为：

```tsx
import { Type, Settings2, AlignLeft, Maximize2, RotateCcw } from "lucide-react"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  useReadingSettings,
  DEFAULT_READING_SETTINGS,
  type ReadingFont,
  type ReadingMaxWidth,
} from "@/components/reading-settings"

const FONTS: { value: ReadingFont; label: string }[] = [
  { value: "serif", label: "衬线" },
  { value: "sans", label: "无衬线" },
  { value: "mono", label: "等宽" },
]

const WIDTHS: { value: ReadingMaxWidth; label: string }[] = [
  { value: "normal", label: "标准" },
  { value: "wide", label: "宽屏" },
]

export function ReadingSettingsPanel() {
  const { settings, update } = useReadingSettings()
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium text-muted-foreground">阅读偏好</div>

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Type className="size-3.5" /> 字体
        </span>
        <SegmentedControl
          aria-label="字体"
          options={FONTS}
          value={settings.font}
          onChange={(font) => update({ font })}
        />
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Settings2 className="size-3.5" /> 字号
          <span className="tabular-nums text-foreground">{settings.fontSize}px</span>
        </span>
        <input
          type="range"
          className="reading-range"
          min={14}
          max={22}
          step={1}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <AlignLeft className="size-3.5" /> 行高
          <span className="tabular-nums text-foreground">
            {settings.lineHeight.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          className="reading-range"
          min={1.4}
          max={2.2}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => update({ lineHeight: Number(e.target.value) })}
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Maximize2 className="size-3.5" /> 栏宽
        </span>
        <SegmentedControl
          aria-label="栏宽"
          options={WIDTHS}
          value={settings.maxWidth}
          onChange={(maxWidth) => update({ maxWidth })}
        />
      </div>

      <button
        type="button"
        onClick={() => update(DEFAULT_READING_SETTINGS)}
        className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1">
          <RotateCcw className="size-3" /> 恢复默认
        </span>
      </button>
    </div>
  )
}
```

要点（spec §3.4 + review Issue 9 + 12）：
- **无外壳**：去掉原 `rounded-xl border bg-card p-3`（外层 Popover 提供），仅 `flex flex-col gap-3`
- 字号/行高数值用 `tabular-nums`，放在标签行内
- 字体/栏宽用 `SegmentedControl`，字号/行高用定制 `range`
- 「恢复默认」调 `update(DEFAULT_READING_SETTINGS)`（整体替换，非 spread）

注意：`ReadingSettingsPanel` 此时仍被 `item-actions.tsx` 的旧代码 import（`w-full` 展开方式）。本步只改面板本身，Task 6 改 `item-actions` 的接入方式。本步后面板在新旧两种接入下都能渲染（旧接入 `w-full` 时面板无外壳会贴边，视觉略素但功能正常，Task 6 覆盖）。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS。确认 `DEFAULT_READING_SETTINGS` 已在 `reading-settings.tsx:20` export（探索确认是）。

- [ ] **Step 3: build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: 手动验收（旧入口仍可用）**

此时阅读页齿轮仍走旧逻辑（Task 6 才改）。打开阅读页点齿轮：
- 面板展开，字体/栏宽变成分段控件，字号/行高滑块用新样式
- 恢复默认按钮可点
- 视觉无外壳（Task 6 收进 Popover 后会完整）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/reading-settings-panel.tsx
git commit -m "refactor(web): rewrite ReadingSettingsPanel with primitives (no shell)"
```

---

## Task 6: ItemActions 收敛进统一浮层

**Files:**
- Rewrite: `apps/web/src/components/item-actions.tsx`

**Interfaces:**
- Consumes: `Popover`（Task 2）；`ReadingSettingsPanel`（Task 5）；`TagChips`（已存在）；现有业务逻辑（`toggleFavorite`/`onRefresh`/`saveTags`/`removeTag`）；lucide `Settings2`/`Star`；`IconRefreshCw`（`icons.tsx`）
- Produces: `ItemActions(props)` —— props 不变（`kind`/`id`/`state`/`reload`/`onRefresh`/`refreshing`），外部调用方（ReadPage/BookPage）无需改

业务逻辑（`toggleFavorite`/`saveTags`/`removeTag`/`useItemState`）原样保留，只改触发它们的 UI 形态。

- [ ] **Step 1: 重写 item-actions.tsx**

整个文件替换为。注意保留所有现有业务逻辑函数（`useItemState`/`toggleFavorite`/`saveTags`/`removeTag`/`TagEditor`），只重构 `ItemActions` 的 render 部分 + trigger 形态：

```tsx
import { useCallback, useEffect, useState } from "react"
import { Settings2, Star, Tag } from "lucide-react"
import { IconRefreshCw, IconStar } from "@/components/icons"
import { Popover } from "@/components/ui/popover"
import { ReadingSettingsPanel } from "@/components/reading-settings-panel"
import { TagChips } from "@/components/tag-chips"
import { api } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export interface ItemState {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
  read_progress: number | null
}

/** 打开页面时回填 /api/me/state */
export function useItemState(kind: "post" | "book", id: string) {
  const [state, setState] = useState<ItemState | null>(null)
  const reload = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(
        `${api.meState}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      if (!res.ok) return
      const json = (await res.json()) as ItemState
      setState(json)
    } catch {
      // 状态读取失败静默，不影响正文展示
    }
  }, [kind, id])
  useEffect(() => {
    void reload()
  }, [reload])
  return { state, reload }
}

export function ItemActions({
  kind,
  id,
  state,
  reload,
  onRefresh,
  refreshing,
}: {
  kind: "post" | "book"
  id: string
  state: ItemState | null
  reload: () => Promise<void>
  onRefresh: () => void
  refreshing: boolean
}) {
  const [busy, setBusy] = useState(false)

  const toggleFavorite = async () => {
    if (state?.favorited) {
      const title = state.title?.trim() || "该条目"
      if (!window.confirm(`取消收藏「${title}」？`)) return
      // confirm 期间不关 Popover：confirm 是系统模态，返回后浮层保持 open
    }
    setBusy(true)
    try {
      const method = state?.favorited ? "DELETE" : "PUT"
      const res = await fetch(
        `${api.meFavorites}?kind=${kind}&id=${encodeURIComponent(id)}`,
        { method }
      )
      if (res.ok) await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveTags = async (tags: string[]) => {
    const res = await fetch(api.meTags, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, tags }),
    })
    if (res.ok) await reload()
    return res.ok
  }

  const [removing, setRemoving] = useState<string | null>(null)
  const removeTag = async (tag: string) => {
    const current = state?.tags ?? []
    setRemoving(tag)
    try {
      await saveTags(current.filter((t) => t !== tag))
    } finally {
      setRemoving(null)
    }
  }

  const favorited = state?.favorited ?? false
  const hasTags = (state?.tags?.length ?? 0) > 0

  return (
    <Popover
      align="end"
      triggerAriaLabel="阅读操作与偏好"
      trigger={
        <span
          className={cn(
            "relative inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            favorited
              ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
              : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Settings2 className="size-4" />
          {favorited && (
            <Star
              className="absolute -right-0.5 -top-0.5 size-2.5 fill-current"
              aria-hidden
            />
          )}
          {hasTags && (
            <Tag
              className="absolute -bottom-0.5 -right-0.5 size-2.5"
              aria-hidden
            />
          )}
        </span>
      }
    >
      <div className="flex w-72 flex-col gap-1">
        {/* 收藏 */}
        <button
          type="button"
          onClick={() => void toggleFavorite()}
          disabled={busy}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50",
            favorited
              ? "text-amber-600 hover:bg-amber-400/10 dark:text-amber-400"
              : "hover:bg-accent"
          )}
        >
          <IconStar size={14} filled={favorited} />
          {favorited ? "已收藏" : "收藏"}
        </button>

        {/* 刷新 */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <IconRefreshCw
            size={14}
            className={refreshing ? "animate-spin" : undefined}
          />
          刷新
        </button>

        {/* 标签 */}
        <TagEditor
          tags={state?.tags ?? []}
          onSave={saveTags}
          onRemove={(tag) => void removeTag(tag)}
          removing={removing}
        />

        <div className="my-2 border-t border-border" />

        {/* 阅读偏好 */}
        <ReadingSettingsPanel />
      </div>
    </Popover>
  )
}

function formatTagsInput(tags: string[]): string {
  return tags.join(", ")
}

function TagEditor({
  tags,
  onSave,
  onRemove,
  removing,
}: {
  tags: string[]
  onSave: (tags: string[]) => Promise<boolean>
  onRemove?: (tag: string) => void
  removing?: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const open = () => {
    setValue(formatTagsInput(tags))
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setValue(formatTagsInput(tags))
  }

  const submit = async () => {
    setBusy(true)
    const next = value
      .split(/[，,]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const ok = await onSave(next)
    setBusy(false)
    if (ok) {
      setValue("")
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
              if (e.key === "Escape") {
                e.stopPropagation() // 双保险：Popover 对可编辑 target 已直接 return，此处再 stopPropagation
                cancel()
              }
            }}
            placeholder="多个标签用逗号分隔"
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-lg bg-muted/70 px-2.5 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">标签</span>
        <button
          type="button"
          onClick={open}
          className="rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          编辑
        </button>
      </div>
      {tags.length > 0 ? (
        <TagChips tags={tags} onRemove={onRemove} removing={removing} />
      ) : (
        <span className="text-xs text-muted-foreground/60">无标签</span>
      )}
    </div>
  )
}
```

关键变更点（对照 spec §3）：

1. **trigger 形态**（§3.1）：从圆形 `rounded-full border` 改为方形 `size-8 rounded-lg bg-muted/70`；`favorited` 时 amber 高亮 + 右上 `Star` 角标；`hasTags` 时右下 `Tag` 角标。trigger 的 `aria-expanded`/`aria-haspopup` 由 `Popover` 的 `<button>` 外壳提供。
2. **全宽行式操作**（§3.3）：收藏/刷新/标签从胶囊按钮改为 `w-full rounded-lg px-3 py-2 hover:bg-accent` 行布局
3. **收藏 confirm**（§3.3）：保留 `window.confirm`，注释说明 confirm 期间不关 Popover
4. **标签 Escape**（§2.4）：编辑态 Esc 调 `cancel()` 前 `e.stopPropagation()`，阻止冒泡到 Popover 的 Esc 关闭
5. **`TagEditor` 布局**：从行内 `inline-flex` 改为垂直 `flex-col`（适应浮层宽度），无标签时显示「无标签」占位
6. **业务逻辑保留**：`toggleFavorite`/`saveTags`/`removeTag`/`useItemState` 原样，仅 `showSettings` state 删除（Popover 内部管理开关）
7. **`IconStar` 仍用项目自建图标**（`filled` prop），trigger 角标用 lucide `Star`（`fill-current` 实心，区分主图标与角标）

注意：`Tag` 图标从 lucide-react import（`item-actions.tsx` 原本就从 lucide import `Settings2`，扩展 import 即可）。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS。重点确认：
- `Popover` 的 `trigger` prop 接受 `<span>`（ReactNode）—— 是
- `ItemActions` 的 props 签名未变 —— ReadPage/BookPage 无需改
- `cn` 已从 `@workspace/ui/lib/utils` import（`tag-chips.tsx` 等已用）

- [ ] **Step 3: build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: 手动验收（完整）**

启动 `bun run dev`，打开任意帖子/书库正文。逐项验收 spec「验证」清单：

**trigger**：
- 操作区只剩单个 trigger（⚙），无散落按钮
- 未收藏：trigger 中性灰
- 已收藏：trigger amber 高亮 + 右上 Star 角标
- 有标签：trigger 右下 Tag 角标
- 收藏 + 标签：两个角标都在

**浮层**：
- 点 trigger 打开浮层（右侧贴齐，`right-0`）
- 收藏 toggle：点「收藏」变「已收藏」+ amber；再点弹 confirm，取消收藏后 trigger 失去 amber；confirm 返回后浮层仍 open
- 刷新：点「刷新」图标 spin，正文更新
- 标签：点「编辑」展开 input；输入 + Enter 保存，chip 出现；点 chip 的 × 删标签
- 标签编辑中按 Esc：input 收起（取消编辑），浮层**保持 open**；再按 Esc 关浮层
- 偏好：字体/栏宽分段控件、字号/行高滑块（新样式）、恢复默认按钮全部可用
- 浮层无双重边框（偏好子组件无外壳）

**关闭**：
- 点浮层外任意处：浮层关闭
- 按 Esc（非编辑态）：浮层关闭，焦点回到 trigger
- 再点 trigger：浮层 toggle

**a11y**（用浏览器 DevTools 或读屏）：
- trigger `aria-expanded` 随开关变化、`aria-haspopup="dialog"`
- SegmentedControl 选中项 `aria-pressed="true"`

**小屏**（DevTools 切 iPhone SE 375×667）：
- 浮层内容超出时内部滚动（max-h + overflow-y-auto），不裁切到不可用

**进度条**（Task 4，回归确认）：
- 底部进度条仍正常，滚到浮层操作时进度条不被遮挡（z-30 < z-50）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/item-actions.tsx
git commit -m "feat(web): unify ItemActions into single Popover (actions + reading prefs)"
```

---

## Self-Review

### Plan review 修订（2026-08-06）

plan review 的 7 个 issue 已全部处理：

| Issue | 处理 | 位置 |
| --- | --- | --- |
| 1 (bug) 外点关闭不回焦 | 抽统一 `close()`，三路（外点/Esc/toggle 关）共用 + 回焦 | Task 2 |
| 2 (bug) Esc 契约靠 stopPropagation 不稳 | Popover 对可编辑 target（input/textarea/contenteditable）直接 return；TagEditor stopPropagation 降级为双保险 | Task 2 + Task 6 |
| 3 (suggestion) button 缺焦点样式 | 外层 button 加 `inline-flex p-0 focus-visible:ring` | Task 2 |
| 4 (suggestion) restore 时 max≤0 仍 setProgress | max>0 才 setProgress(target)，else setProgress(0) | Task 4 Step 1 |
| 5 (nit) aria-controls 缺 | trigger 加 `aria-controls={open ? panelId : undefined}` | Task 2 |
| 6 (nit) RefAttributes 无用 import | 删除，只 import `ReactNode` | Task 2 |
| 7 (nit) Task 5 中间态无外壳 | 接受不改（Task 6 覆盖前 intermediate commit 视觉略素，可接受） | — |

### Spec coverage

| spec 章节 | 对应 Task |
| --- | --- |
| §1 整体架构 / 文件落点 | Task 1-6 文件结构表 |
| §2.1 SegmentedControl | Task 1 |
| §2.2 定制滑块 CSS | Task 3 |
| §2.3 Popover（含高度约束/z-50/不做 portal） | Task 2 |
| §2.4 Escape 优先级契约 | Task 2（Popover）+ Task 6（TagEditor stopPropagation） |
| §2.5 a11y 最小集 | Task 1（aria-pressed/role=group）+ Task 2（aria-expanded/haspopup/回焦/声明不 trap） |
| §3.1 trigger（amber + Star + Tag 角标） | Task 6 |
| §3.2 浮层内部结构 | Task 6 |
| §3.3 操作行（全宽 + confirm 不关 + 标签 Esc） | Task 6 |
| §3.4 偏好子组件（无外壳 + 恢复默认） | Task 5 |
| §3.5 ItemActions 改造后形态 | Task 6 |
| §4.1 数据来源（含 restore/id 同步） | Task 4 Step 1 |
| §4.2 ReadingProgress（全宽 + safe-area + 无 transition） | Task 4 Step 2 |
| §4.3 挂载点（ArticleView 条件渲染） | Task 4 Step 3 |
| §5 推进策略（§2→§4→§3 分步 commit） | Task 顺序 1→2→3→4→5→6 |

全部覆盖，无遗漏。

### Placeholder scan

无 TBD/TODO。每个 Step 含具体代码或精确改动点（找到 X 改为 Y）。CSS、组件、接入点均有完整代码块。

### Type consistency

- `SegmentedControl<T>` 泛型，Task 5 用 `<ReadingFont>`/`<ReadingMaxWidth>`（从 `reading-settings.tsx` import，已 export）✓
- `Popover` 的 `trigger: ReactNode` —— Task 6 传 `<span>` ✓
- `useReadingProgress` 返回 `{ progress: number }` —— Task 4 解构 + Task 4 Step 3 `ArticleView` prop `progress?: number` 一致 ✓
- `ReadingProgress({ progress: number })` —— Task 4 Step 2 定义，Step 3 消费 ✓
- `ItemActions` props 签名不变 —— Task 6 保留，ReadPage/BookPage（Task 4 已动）无需再改 ✓
- `update(DEFAULT_READING_SETTINGS)` —— Task 5，`DEFAULT_READING_SETTINGS` 类型 `ReadingSettings`，`update` 接受 `Partial<ReadingSettings>`，`ReadingSettings` 可赋给 `Partial<ReadingSettings>` ✓

无类型不一致。
