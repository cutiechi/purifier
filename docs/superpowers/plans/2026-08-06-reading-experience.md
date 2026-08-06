# Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<pre font-mono>` reading view with a settings-driven serif reading experience (typography settings, scroll-progress memory, chapter navigation).

**Architecture:** Frontend `ReadingSettingsProvider` (localStorage) drives CSS variables consumed by a rewritten `ContentBody`. Per-article reading progress persists to SQLite (`items.read_progress`) via a new `PUT /api/me/progress` endpoint, read back through the existing `/api/me/state`. Chapter navigation derives from `content.links` (posts) and a new extractor method (books). Five sequential phases, each independently testable.

**Tech Stack:** Bun (API + test runner), React 19, React Router 7, Tailwind CSS 4, `bun:sqlite`, Cheerio (extractor).

**Spec:** `docs/superpowers/specs/2026-08-06-reading-experience-design.md`

## Global Constraints

- TypeScript `strict`, `noEmit`. Prettier: no semicolons, double quotes, `printWidth: 80`, `trailingComma: "es5"`.
- API uses only `Bun.serve` (no HTTP framework). Upstream parsing stays in `packages/core` `Extractor` interface — never parse HTML in API/web.
- Content sanitization contract (`extractPreHtml`) is **read-only** for phases 1–4: frontend converts literal `\n` to `<br>`; never re-`innerHTML`-parse user content. Only phase 5 (§4b) touches the extractor, with fixture tests.
- Verification after every phase: `bun run test && bun run typecheck && bun run build`.
- Web imports use `@/` alias; cross-package uses `@workspace/...`. Icons from `lucide-react`.
- Commits: conventional-commit messages, one logical change per commit. Currently on branch `feat/reading-experience`.
- Existing duplicate `ItemState` lives in both `packages/core/src/storage/types.ts:22-32` (canonical) and `apps/web/src/components/item-actions.tsx:6-16` (redeclared). Phase 3 adds `read_progress` to **both**.

---

## Phase 1: Reading Settings System (frontend-only)

Provider + localStorage + serif default wired into `ContentBody`. No backend changes. Verify by opening any post and seeing serif + 17px.

### Task 1.1: Add `--font-serif` token to design system

**Files:**
- Modify: `packages/ui/src/styles/globals.css:50-61`

**Interfaces:**
- Produces: Tailwind `font-serif` utility class (via `@theme inline` registration) + `--font-serif` CSS var on `:root`, available app-wide.

- [ ] **Step 1: Add the CSS variable and Tailwind token**

Edit `packages/ui/src/styles/globals.css`. Inside the `@theme inline` block, after line 51 (`--font-mono: var(--font-mono);`), add:

```css
  --font-serif: var(--font-serif);
```

Then in the `:root` block, after the `--font-mono` stack (currently ending at line 61), add:

```css
  --font-serif:
    "Noto Serif SC", "Source Han Serif SC", "Songti SC", "PingFang SC", serif;
```

- [ ] **Step 2: Verify build picks up the token**

Run: `bun run build:web`
Expected: build succeeds; `font-serif` utility is now available to consume.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles/globals.css
git commit -m "feat(ui): add --font-serif token and font-serif utility"
```

---

### Task 1.2: Create `ReadingSettingsProvider` + `useReadingSettings` hook

**Files:**
- Create: `apps/web/src/components/reading-settings.tsx`

**Interfaces:**
- Produces:
  - type `ReadingSettings = { font: "serif" | "sans" | "mono"; fontSize: number; lineHeight: number; maxWidth: "normal" | "wide" }`
  - type `ReadingSettingsContextValue = { settings: ReadingSettings; update: (patch: Partial<ReadingSettings>) => void }`
  - component `<ReadingSettingsProvider>{children}</ReadingSettingsProvider>`
  - hook `useReadingSettings(): ReadingSettingsContextValue`
- Storage key: `purifier:reading`. Default: `{ font: "serif", fontSize: 17, lineHeight: 1.8, maxWidth: "normal" }`.
- `font` values `"serif" | "sans" | "mono"` map to CSS `var(--font-serif) | var(--font-sans) | var(--font-mono)`.

- [ ] **Step 1: Write the provider + hook**

Create `apps/web/src/components/reading-settings.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

export type ReadingFont = "serif" | "sans" | "mono"
export type ReadingMaxWidth = "normal" | "wide"

export interface ReadingSettings {
  font: ReadingFont
  fontSize: number
  lineHeight: number
  maxWidth: ReadingMaxWidth
}

export interface ReadingSettingsContextValue {
  settings: ReadingSettings
  update: (patch: Partial<ReadingSettings>) => void
}

const STORAGE_KEY = "purifier:reading"
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  font: "serif",
  fontSize: 17,
  lineHeight: 1.8,
  maxWidth: "normal",
}

const ReadingSettingsContext = createContext<ReadingSettingsContextValue | null>(
  null
)

const FONT_VALUES: ReadingFont[] = ["serif", "sans", "mono"]
const MAXWIDTH_VALUES: ReadingMaxWidth[] = ["normal", "wide"]

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fallback
}

function loadSettings(): ReadingSettings {
  if (typeof localStorage === "undefined") return DEFAULT_READING_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_READING_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ReadingSettings>
    return {
      font: FONT_VALUES.includes(parsed.font as ReadingFont)
        ? (parsed.font as ReadingFont)
        : DEFAULT_READING_SETTINGS.font,
      fontSize: clampNumber(parsed.fontSize, 14, 22, DEFAULT_READING_SETTINGS.fontSize),
      lineHeight: clampNumber(parsed.lineHeight, 1.4, 2.2, DEFAULT_READING_SETTINGS.lineHeight),
      maxWidth: MAXWIDTH_VALUES.includes(parsed.maxWidth as ReadingMaxWidth)
        ? (parsed.maxWidth as ReadingMaxWidth)
        : DEFAULT_READING_SETTINGS.maxWidth,
    }
  } catch {
    return DEFAULT_READING_SETTINGS
  }
}

const FONT_VAR: Record<ReadingFont, string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
}

const MAXWIDTH_CLASS: Record<ReadingMaxWidth, string> = {
  normal: "max-w-3xl",
  wide: "max-w-4xl",
}

export function ReadingSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ReadingSettings>(loadSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // 存储失败（隐私模式/配额）静默：内存值仍生效
    }
  }, [settings])

  // 将设置映射成 CSS 变量挂到 <html>，供 .reading-body 消费
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--reading-font", FONT_VAR[settings.font])
    root.style.setProperty(
      "--reading-font-size",
      `${settings.fontSize}px`
    )
    root.style.setProperty(
      "--reading-line-height",
      String(settings.lineHeight)
    )
    root.dataset.readingMaxWidth = settings.maxWidth
  }, [settings])

  const value = useMemo<ReadingSettingsContextValue>(
    () => ({
      settings,
      update: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    }),
    [settings]
  )

  return (
    <ReadingSettingsContext.Provider value={value}>
      {children}
    </ReadingSettingsContext.Provider>
  )
}

export function useReadingSettings(): ReadingSettingsContextValue {
  const ctx = useContext(ReadingSettingsContext)
  if (!ctx) {
    throw new Error("useReadingSettings must be used within ReadingSettingsProvider")
  }
  return ctx
}

// 供 PageShell / SiteHeader 对齐栏宽用（Phase 2 Task 2.1）
export function readingMaxWidthClass(maxWidth: ReadingMaxWidth): string {
  return MAXWIDTH_CLASS[maxWidth]
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/web && bun run typecheck` (or `bun run typecheck` from root for the whole monorepo)
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/reading-settings.tsx
git commit -m "feat(web): add ReadingSettingsProvider and useReadingSettings hook"
```

---

### Task 1.3: Wire `ReadingSettingsProvider` into app root

**Files:**
- Modify: `apps/web/src/main.tsx:8-15`

**Interfaces:**
- Consumes: `<ReadingSettingsProvider>` from Task 1.2.

- [ ] **Step 1: Wrap the app**

In `apps/web/src/main.tsx`, add the import and nest `ReadingSettingsProvider` inside `<ThemeProvider>` and outside `<BrowserRouter>` (settings persist across routes; provider sits inside ThemeProvider only for ordering stability). Replace the `<StrictMode>` block:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ReadingSettingsProvider } from "@/components/reading-settings"
import { App } from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ReadingSettingsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ReadingSettingsProvider>
    </ThemeProvider>
  </StrictMode>
)
```

- [ ] **Step 2: Verify typecheck + build**

Run: `bun run typecheck && bun run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/main.tsx
git commit -m "feat(web): wrap app in ReadingSettingsProvider"
```

---

### Task 1.4: Rewrite `ContentBody` to consume settings (serif default)

This is the user-visible payoff of Phase 1: replace `<pre font-mono>` with a settings-driven `<div class="reading-body">`.

**Files:**
- Modify: `apps/web/src/components/article-view.tsx:8-32`
- Modify: `packages/ui/src/styles/globals.css` (add `.reading-body` rule)

**Interfaces:**
- Consumes: `useReadingSettings()` from Task 1.2; CSS vars `--reading-font`, `--reading-font-size`, `--reading-line-height` set by the provider on `<html>`.
- Produces: `ContentBody` now renders serif by default; keeps the same `html` prop and the same click-interception behavior for `/read/` and `/book/` links.

- [ ] **Step 1: Add `.reading-body` CSS**

Append to `packages/ui/src/styles/globals.css` (the file already imports via `apps/web/src/index.css` → `@import globals.css`; adding the rule there makes it global):

```css
.reading-body {
  font-family: var(--reading-font, var(--font-serif));
  font-size: var(--reading-font-size, 17px);
  line-height: var(--reading-line-height, 1.8);
  word-break: break-word;
  overflow-wrap: anywhere;
}
.reading-body a {
  color: oklch(0.62 0.17 252);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dark .reading-body a {
  color: oklch(0.74 0.15 232);
}
```

- [ ] **Step 2: Rewrite `ContentBody`**

Replace the `ContentBody` component in `apps/web/src/components/article-view.tsx:8-32`. The **current implementation in the repo** (verbatim — preserve its `useCallback` + `instanceof Element` guard):

```tsx
// CURRENT (article-view.tsx:8-32, to be replaced):
export function ContentBody({ html }: { html: string }) {
  const navigate = useNavigate()

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const a = target.closest("a")
      if (!a) return
      const href = a.getAttribute("href")
      if (!href?.startsWith("/read/") && !href?.startsWith("/book/")) return
      e.preventDefault()
      navigate(href)
    },
    [navigate]
  )

  return (
    <pre
      className="content-body font-mono text-[14px] leading-[1.85] whitespace-pre-wrap text-foreground/85 sm:text-[15px] sm:leading-[1.9] [&_a]:text-sky-600 [&_a]:underline [&_a]:decoration-sky-600/35 [&_a]:underline-offset-2 hover:[&_a]:decoration-sky-600 dark:[&_a]:text-sky-400 dark:[&_a]:decoration-sky-400/40"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onClick}
    />
  )
}
```

Keep the `useCallback` + `instanceof Element` guard in the new version (only the wrapper element and classes change).

Replace with (note: literal `\n` in sanitized HTML → `<p>` paragraphs; single `\n` → `<br>` soft wrap):

```tsx
function withParagraphs(html: string): string {
  // 内容已由 extractPreHtml 清洗：仅转义文本 + 站内 /read|/book 锚点。
  // 这里只处理字面 \n，不做二次 innerHTML 解析。
  return html
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("")
}

export function ContentBody({ html }: { html: string }) {
  const navigate = useNavigate()

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const a = target.closest("a")
      if (!a) return
      const href = a.getAttribute("href")
      if (!href?.startsWith("/read/") && !href?.startsWith("/book/")) return
      e.preventDefault()
      navigate(href)
    },
    [navigate]
  )

  return (
    <div
      className="reading-body text-foreground/85"
      dangerouslySetInnerHTML={{ __html: withParagraphs(html) }}
      onClick={onClick}
    />
  )
}
```

Also add paragraph spacing to the `.reading-body` block in `globals.css`:

```css
.reading-body p {
  margin: 0 0 1em;
}
.reading-body p:last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 3: Verify typecheck + build**

Run: `bun run typecheck && bun run build:web`
Expected: PASS. (No frontend test framework exists; manual visual check happens at phase end.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/article-view.tsx packages/ui/src/styles/globals.css
git commit -m "feat(web): ContentBody uses serif reading-body, drop pre/font-mono"
```

---

### Task 1.5: Add `<ReadingSettingsPanel>` and an action-row button to open it

**Files:**
- Create: `apps/web/src/components/reading-settings-panel.tsx`
- Modify: `apps/web/src/components/item-actions.tsx` (add a settings button in the action row)

**Interfaces:**
- Consumes: `useReadingSettings()` from Task 1.2, `DEFAULT_READING_SETTINGS` for range bounds.
- Produces: `<ReadingSettingsPanel />` (self-contained popover with font/size/lineHeight/maxWidth controls); an `IconSettings` button in `ItemActions` that toggles it.

- [ ] **Step 1: Write the panel component**

Create `apps/web/src/components/reading-settings-panel.tsx`:

```tsx
import { Settings2, Type, AlignLeft, Maximize2 } from "lucide-react"
import { useReadingSettings } from "@/components/reading-settings"
import type { ReadingFont, ReadingMaxWidth } from "@/components/reading-settings"

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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Type className="size-3.5" /> 字体
        </span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1"
          value={settings.font}
          onChange={(e) => update({ font: e.target.value as ReadingFont })}
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Settings2 className="size-3.5" /> 字号 {settings.fontSize}px
        </span>
        <input
          type="range"
          min={14}
          max={22}
          step={1}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <AlignLeft className="size-3.5" /> 行高 {settings.lineHeight.toFixed(1)}
        </span>
        <input
          type="range"
          min={1.4}
          max={2.2}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => update({ lineHeight: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Maximize2 className="size-3.5" /> 栏宽
        </span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1"
          value={settings.maxWidth}
          onChange={(e) =>
            update({ maxWidth: e.target.value as ReadingMaxWidth })
          }
        >
          {WIDTHS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Add the toggle button to `ItemActions`**

In `apps/web/src/components/item-actions.tsx`, add imports at the top:

```tsx
import { Settings2 } from "lucide-react"
import { useState } from "react"
import { ReadingSettingsPanel } from "@/components/reading-settings-panel"
```

Then inside the `ItemActions` component, near the top of its body (before the return), add local state:

```tsx
const [showSettings, setShowSettings] = useState(false)
```

In the action row `<div className="flex flex-wrap items-center gap-2">` (the row that holds favorite/refresh/tag buttons), add this button as a new sibling (e.g. at the end):

```tsx
<button
  type="button"
  onClick={() => setShowSettings((v) => !v)}
  aria-label="阅读设置"
  className={`inline-flex size-8 items-center justify-center rounded-full border transition ${
    showSettings
      ? "border-foreground/40 bg-foreground/10"
      : "border-border hover:bg-muted"
  }`}
>
  <Settings2 className="size-4" />
</button>
{showSettings && (
  <div className="w-full">
    <ReadingSettingsPanel />
  </div>
)}
```

- [ ] **Step 3: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual: `bun run dev`, open `/read/<some-tid>`, click the gear icon → change font/size/line-height → confirm body updates live; reload page → confirm settings persist (localStorage `purifier:reading`); confirm `maxWidth` select changes **nothing visible yet** (that wiring lands in Phase 2 Task 2.1–2.2).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/reading-settings-panel.tsx apps/web/src/components/item-actions.tsx
git commit -m "feat(web): reading settings panel with font/size/lineHeight controls"
```

---

### Phase 1 verification gate

- [ ] **Step 1: Full check**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all PASS.

- [ ] **Step 2: Manual reading check**

Open a post and a book. Confirm: serif font, ~17px, 1.8 line height, comfortable line length. Confirm in-body `/read/` and `/book/` links still navigate client-side. Confirm dark mode still toggles with `d`.

---

## Phase 2: maxWidth plumbing + visual verify

> Phase 1 already rewrote `ContentBody` (paragraphs + serif). This phase only makes the `maxWidth` setting actually take effect on reading routes, keeping non-reading pages untouched.

### Task 2.1: Thread `maxWidth` through `PageShell` → `SiteHeader`

**Files:**
- Modify: `apps/web/src/components/page-shell.tsx` (props + `<main>` + `<SiteHeader>`)
- Modify: `apps/web/src/components/site-header.tsx` (accept `maxWidth` prop)
- Modify: `apps/web/src/pages/ReadPage.tsx` and `apps/web/src/pages/BookPage.tsx` (pass `maxWidth`)

**Interfaces:**
- Consumes: `useReadingSettings().settings.maxWidth` from Task 1.2, `readingMaxWidthClass()`.
- Produces: `PageShell` accepts an optional `maxWidth?: "normal" | "wide"` prop; it drives `<main>` width AND is forwarded to `<SiteHeader>` so the header aligns **only on pages that pass the prop**. List/category/home pages don't pass it → stay `max-w-3xl` header + body (no leak).

> Review Issue #2 / #13: the previous plan had `SiteHeader` read settings globally (misaligning non-reading pages) and kept a redundant `wide` prop. Fixed: width flows **down as a prop from each page**, and the legacy `wide` prop is dropped entirely (no existing call site passes it, so no alias is needed).

- [ ] **Step 1: `PageShell` — add `maxWidth` prop, forward to header**

The current `PageShell` (lines 5-31) has props `{ children, showBack?, className?, wide? }` and switches `<main>` class via `wide ? "max-w-4xl" : "max-w-3xl"`; it renders `<SiteHeader showBack={showBack} />` at line 24. Replace the `wide` prop with `maxWidth` entirely (no existing call site passes `wide`, so no alias is needed). New props:

```tsx
export function PageShell({
  children,
  showBack,
  className,
  maxWidth,
}: {
  children: ReactNode
  showBack?: boolean
  className?: string
  maxWidth?: "normal" | "wide"
}) {
  const widthClass = maxWidth
    ? readingMaxWidthClass(maxWidth)
    : "max-w-3xl"
```

Add the import:

```tsx
import { readingMaxWidthClass } from "@/components/reading-settings"
```

In the `<main>` `cn(...)`, use `widthClass` in place of the old `wide ? "max-w-4xl" : "max-w-3xl"`. Update the header call to forward the prop:

```tsx
<SiteHeader showBack={showBack} maxWidth={maxWidth} />
```

(If any non-reading page currently passes `wide`, replace those call sites with `maxWidth="wide"`. Grep `grep -rn "wide=" apps/web/src/pages apps/web/src/components` to find them; the exploration found none on pages, so this is likely a no-op beyond the prop rename.)

- [ ] **Step 2: `SiteHeader` — accept `maxWidth` prop (do NOT read settings)**

The current header (`site-header.tsx:14`) is `{ showBack }: { showBack?: boolean }` with an inner container `max-w-3xl ... lg:max-w-4xl` at line 28. Change it to accept `maxWidth`:

```tsx
export function SiteHeader({
  showBack,
  maxWidth,
}: {
  showBack?: boolean
  maxWidth?: "normal" | "wide"
}) {
  const widthClass = readingMaxWidthClass(maxWidth ?? "normal")
```

Add the import:

```tsx
import { readingMaxWidthClass } from "@/components/reading-settings"
```

Replace `max-w-3xl ... lg:max-w-4xl` in the inner container (line 28) with `{widthClass}`. The mobile drawer nav (line 91) also uses `max-w-3xl`; replace it with `{widthClass}` too for consistency. **Do not call `useReadingSettings()` here** — the value comes from the prop, so non-reading pages stay narrow.

- [ ] **Step 3: Pass `maxWidth` from ReadPage and BookPage**

In `apps/web/src/pages/ReadPage.tsx`, add the hook + pass the prop:

```tsx
import { useReadingSettings } from "@/components/reading-settings"
// ... inside the component:
const { settings } = useReadingSettings()
// ... in JSX, the <PageShell showBack> line (around line 60):
<PageShell showBack maxWidth={settings.maxWidth}>
```

Do the identical change in `apps/web/src/pages/BookPage.tsx` (its `<PageShell showBack>` is around line 56).

- [ ] **Step 4: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual:
- Open a reading page → settings → 栏宽 wide → confirm **header and article card widen together** and stay aligned. Toggle 标准 → both narrow.
- Open Home / History / a category page → confirm the **header stays at the default width** regardless of the reading `maxWidth` setting (no leak).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page-shell.tsx apps/web/src/components/site-header.tsx apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): thread reading maxWidth through PageShell and SiteHeader"
```

---

### Task 2.2: Verify paragraph spacing in real content

No code change; validation only.

- [ ] **Step 1: Manual paragraph check**

Open a long post with multiple paragraphs. Confirm:
- Single `\n` in source → soft line break (no big gap)
- Blank-line-separated paragraphs (`\n\n`) → `<p>` paragraph with bottom margin (the `.reading-body p` rule from Task 1.4)
- No leftover monospace look; long CJK lines wrap cleanly (no horizontal scroll)

If paragraph gaps look too small/large, tune `.reading-body p { margin-bottom }` in `globals.css` (0.75em–1.25em is the reasonable range). Commit any tuning.

---

### Phase 2 verification gate

- [ ] **Step 1:** `bun run test && bun run typecheck && bun run build` all PASS.
- [ ] **Step 2:** Manual: maxWidth widens header+body **only on reading routes**; paragraph spacing reads well.

---

## Phase 3: Reading progress memory (backend + frontend)

### Task 3.1: Add `read_progress` column with idempotent migration

**Files:**
- Modify: `packages/core/src/storage/db.ts:38-44` (`openDatabase`)

**Interfaces:**
- Produces: `items.read_progress REAL` column (NULL = never recorded, 0.0–1.0 = progress) on all databases, new and existing.

- [ ] **Step 1: Write failing tests for the migration**

Append to `packages/core/src/storage/store.test.ts`. Two tests: (a) a **pre-migration** DB (old schema without the column) gets migrated and keeps its data; (b) idempotency — reopening a DB that already has the column does not error. The pre-migration test is the load-bearing one: it builds a real "old" DB file by hand, then runs `openDatabase` against it.

```ts
import { openDatabase } from "./db"
import { Database } from "bun:sqlite"
import { join } from "node:path"

// 模拟旧库：用不含 read_progress 的 DDL 建库并写入一行
function makeOldDatabase(dir: string): void {
  const db = new Database(join(dir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_visited_at INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS favorites (kind TEXT NOT NULL, id TEXT NOT NULL, favorited_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
    CREATE TABLE IF NOT EXISTS tags (kind TEXT NOT NULL, id TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id, tag));
  `)
  db.query(
    "INSERT INTO items (kind, id, title, url, first_seen_at, last_visited_at, visit_count) VALUES ('post', 't1', 'old', '/read/t1', 1, 1, 3)"
  ).run()
  db.close()
}

test("openDatabase migrates old DB: adds read_progress, preserves data", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-migrate-old-"))
  try {
    makeOldDatabase(dir)
    // 确认旧库确实没有 read_progress
    const before = new Database(join(dir, "purifier.db"))
    const colsBefore = before.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(colsBefore.map((c) => c.name)).not.toContain("read_progress")
    before.close()

    // 重新打开会触发迁移
    const db = openDatabase(dir)
    const cols = db.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(cols.map((c) => c.name)).toContain("read_progress")
    // 旧行数据保留
    const row = db
      .query("SELECT title, visit_count, read_progress FROM items WHERE id = 't1'")
      .get() as { title: string; visit_count: number; read_progress: number | null }
    expect(row.title).toBe("old")
    expect(row.visit_count).toBe(3)
    expect(row.read_progress).toBeNull() // 新列默认 NULL
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("openDatabase is idempotent when read_progress already exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-migrate-idem-"))
  try {
    const db1 = openDatabase(dir)
    db1.close()
    // 第二次打开同一库：PRAGMA 检测到列已存在，不再 ALTER，不报错
    const db2 = openDatabase(dir)
    const cols = db2.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(cols.filter((c) => c.name === "read_progress")).toHaveLength(1)
    db2.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test src/storage/store.test.ts -t "read_progress"`
Expected: FAIL — migration test: column not added (openDatabase has no ALTER yet); idempotency test: column not found.

- [ ] **Step 3: Implement the migration**

In `packages/core/src/storage/db.ts`, extend `openDatabase`. After `db.exec(DDL)` (line 42), add an idempotent `ALTER`:

```ts
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(DDL)
  // 幂等迁移：为旧库补 read_progress 列（CREATE TABLE IF NOT EXISTS 不会添加新列）
  const cols = db.query("PRAGMA table_info(items)").all() as { name: string }[]
  if (!cols.some((c) => c.name === "read_progress")) {
    db.exec("ALTER TABLE items ADD COLUMN read_progress REAL")
  }
  return db
}
```

Also add `read_progress REAL` to the `items` table DDL (the `CREATE TABLE IF NOT EXISTS items (...)` block, lines 6-15) so that **new** databases get the column directly and the migration only runs for existing DBs:

```sql
CREATE TABLE IF NOT EXISTS items (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  read_progress REAL,
  PRIMARY KEY (kind, id)
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/storage/store.test.ts -t "read_progress"`
Expected: PASS — both the migration test and the idempotency test green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add items.read_progress column with idempotent migration"
```

---

### Task 3.2: Add `read_progress` to types

**Files:**
- Modify: `packages/core/src/storage/types.ts:4-14` (`ListItem`)
- Modify: `packages/core/src/storage/types.ts:22-32` (`ItemState`)
- Modify: `apps/web/src/components/item-actions.tsx:6-16` (duplicate `ItemState`)

**Interfaces:**
- Produces: `ListItem.read_progress?: number | null`; `ItemState.read_progress: number | null` (use `null` for never-recorded, matching the column's NULL).

- [ ] **Step 1: Update core `ListItem`**

In `packages/core/src/storage/types.ts`, add to the `ListItem` interface:

```ts
export interface ListItem {
  kind: ItemKind
  id: string
  title: string
  url: string
  visit_count: number
  favorited: boolean
  tags: string[]
  last_visited_at?: number
  favorited_at?: number
  read_progress?: number | null
}
```

- [ ] **Step 2: Update core `ItemState`**

In the same file, add `read_progress` to `ItemState`:

```ts
export interface ItemState {
  kind: ItemKind
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
```

- [ ] **Step 3: Update the web duplicate**

In `apps/web/src/components/item-actions.tsx:6-16`, add `read_progress: number | null` to the locally-redeclared `ItemState` interface (keep field names identical to core).

- [ ] **Step 4: Verify typecheck (expect downstream errors — fixed in 3.3/3.4)**

Run: `bun run typecheck`
Expected: **errors** in `store.ts` (getState/list mappers not setting the field) and `apps/api/src/index.ts` (the `empty` `ItemState` literal missing `read_progress`). These are fixed in Task 3.3 and 3.5. Do not commit yet.

---

### Task 3.3: Return `read_progress` from Store (`getState` + list mappers)

**Files:**
- Modify: `packages/core/src/storage/store.ts:67-101` (`getState`), `:213-287` (`listHistory`/`listFavorites`/`listByTag` SELECTs), `:289-318` (`runList` mapper)

**Interfaces:**
- Consumes: the `read_progress` column from Task 3.1.
- Produces: `getState().read_progress` and `ListItem.read_progress` populated.

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/storage/store.test.ts`:

```ts
test("setProgress / getState round-trip read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("post", "t1", "title", "/read/t1")
    expect(store.getState("post", "t1")?.read_progress).toBeNull()

    store.setProgress("post", "t1", 0.42)
    expect(store.getState("post", "t1")?.read_progress).toBeCloseTo(0.42)

    // clamp 上界
    store.setProgress("post", "t1", 5)
    expect(store.getState("post", "t1")?.read_progress).toBe(1)

    // clamp 下界
    store.setProgress("post", "t1", -3)
    expect(store.getState("post", "t1")?.read_progress).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setProgress returns false for missing item", () => {
  const { store, dir } = makeStore()
  try {
    expect(store.setProgress("post", "nope", 0.5)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("listHistory includes read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("post", "t1", "title", "/read/t1")
    store.setProgress("post", "t1", 0.3)
    const items = store.listHistory({ page: 1 }).items
    expect(items[0].read_progress).toBeCloseTo(0.3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("recordVisit does not reset read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("post", "t1", "title", "/read/t1")
    store.setProgress("post", "t1", 0.5)
    store.recordVisit("post", "t1", "title2", "/read/t1") // 再访问
    expect(store.getState("post", "t1")?.read_progress).toBeCloseTo(0.5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: FAIL — `setProgress` is not a function; `read_progress` undefined.

- [ ] **Step 3: Implement `setProgress` and update `getState`**

In `packages/core/src/storage/store.ts`, add a `setProgress` method (place it near `recordVisit`, ~line 65). It returns `false` if the item doesn't exist (so the API can 404), `true` on success:

```ts
setProgress(kind: ItemKind, id: string, progress: number): boolean {
  const clamped = Math.max(0, Math.min(1, progress))
  const res = this.db
    .query(
      "UPDATE items SET read_progress = ?3 WHERE kind = ?1 AND id = ?2"
    )
    .run(kind, id, clamped)
  return res.changes > 0
}
```

Update `getState` (lines 67-101) to SELECT and return `read_progress`. Change the SELECT to include the column and add it to the returned object:

```ts
getState(kind: ItemKind, id: string): ItemState | null {
  const row = this.db
    .query(
      `SELECT title, url, first_seen_at, last_visited_at, visit_count, read_progress
       FROM items WHERE kind = ?1 AND id = ?2`
    )
    .get(kind, id) as
    | {
        title: string
        url: string
        first_seen_at: number
        last_visited_at: number
        visit_count: number
        read_progress: number | null
      }
    | null
  if (!row) return null
  const fav = this.db
    .query("SELECT 1 FROM favorites WHERE kind = ?1 AND id = ?2")
    .get(kind, id)
  const tagRows = this.db
    .query("SELECT tag FROM tags WHERE kind = ?1 AND id = ?2 ORDER BY created_at, rowid")
    .all(kind, id) as { tag: string }[]
  return {
    kind,
    id,
    title: row.title,
    url: row.url,
    first_seen_at: row.first_seen_at,
    last_visited_at: row.last_visited_at,
    visit_count: row.visit_count,
    favorited: !!fav,
    tags: tagRows.map((r) => r.tag),
    read_progress: row.read_progress,
  }
}
```

- [ ] **Step 4: Update the three list SELECTs + `runList` mapper**

In `listHistory` (~line 213-231), `listFavorites` (~235-253), and `listByTag` (~268-287), add `i.read_progress` to each SELECT projection (after `i.visit_count`). Then in `runList` (~289-318), set `read_progress` on each mapped `ListItem` from the row. The existing mapper pattern sets optional fields conditionally — add unconditionally since the column is always selected (it will be `null` for never-recorded):

```ts
// inside runList's map callback, alongside the other field assignments:
read_progress: (row as { read_progress?: number | null }).read_progress ?? null,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: PASS — all four new tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): Store.setProgress and read_progress in getState/lists"
```

---

### Task 3.4: Add `DELETE /api/me/history` progress-clear regression coverage

Per spec, deletes clear `read_progress` automatically (whole-row delete in `purgeItem`). Add a test to lock that behavior so a future refactor can't silently break it.

**Files:**
- Modify: `packages/core/src/storage/store.test.ts`

- [ ] **Step 1: Write the regression test**

Append to `packages/core/src/storage/store.test.ts`:

```ts
test("deleteItem clears read_progress with the row", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("post", "t1", "title", "/read/t1")
    store.setProgress("post", "t1", 0.5)
    store.deleteItem("post", "t1")
    // 重新创建同 id：read_progress 必须是新行的 NULL，不是旧值
    store.recordVisit("post", "t1", "title", "/read/t1")
    expect(store.getState("post", "t1")?.read_progress).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("clearHistory clears read_progress for all rows", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("post", "t1", "title", "/read/t1")
    store.setProgress("post", "t1", 0.9)
    store.clearHistory()
    store.recordVisit("post", "t1", "title", "/read/t1")
    expect(store.getState("post", "t1")?.read_progress).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: PASS (the existing delete paths already do whole-row deletes, so these should pass immediately — they're guards against future regressions).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/storage/store.test.ts
git commit -m "test(core): lock read_progress cleared by delete/clearHistory"
```

---

### Task 3.5: Add `PUT /api/me/progress` endpoint + `read_progress` in `/api/me/state`

**Files:**
- Modify: `apps/web/src/lib/routes.ts:35-51` (add `meProgress`)
- Modify: `apps/api/src/index.ts` — `handleMeState` empty literal (~line 370-388); add `handleProgressWrite` (mirror `handleTagsWrite` ~406-426); register route (~line 530)

**Interfaces:**
- Consumes: `store.setProgress()` (returns boolean), `meKindParam`/`meIdParam` helpers.
- Produces: `PUT /api/me/progress` body `{ kind, id, progress }` → `{ ok: true }` or 404; `GET /api/me/state` now includes `read_progress` in every response.

- [ ] **Step 1: Add the API constant**

In `apps/web/src/lib/routes.ts`, add to the `api` object (after `meState`, line 48):

```ts
  meProgress: "/api/me/progress",
```

- [ ] **Step 2: Update `handleMeState` empty literal**

In `apps/api/src/index.ts`, the `empty` `ItemState` literal (~line 370-388) must now include `read_progress: null` (TypeScript will error otherwise):

```ts
const empty: ItemState = {
  kind,
  id,
  title: "",
  url: "",
  first_seen_at: 0,
  last_visited_at: 0,
  visit_count: 0,
  favorited: false,
  tags: [],
  read_progress: null,
}
```

- [ ] **Step 3: Add `handleProgressWrite`**

In `apps/api/src/index.ts`, add a new handler near `handleTagsWrite` (mirror its body-validation pattern exactly — JSON body, validate `kind`/`id`, call store, map falsy → 404):

```ts
async function handleProgressWrite(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("invalid json body", 400)
  }
  const b = (body ?? {}) as {
    kind?: unknown
    id?: unknown
    progress?: unknown
  }
  if (b.kind !== "post" && b.kind !== "book") {
    return jsonError("invalid kind", 400)
  }
  if (typeof b.id !== "string" || !/^[A-Za-z0-9]+$/.test(b.id)) {
    return jsonError("invalid id", 400)
  }
  if (typeof b.progress !== "number" || !Number.isFinite(b.progress)) {
    return jsonError("progress must be a finite number", 400)
  }
  const ok = store.setProgress(b.kind, b.id, b.progress)
  if (!ok) return jsonError("item not found", 404)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}
```

- [ ] **Step 4: Register the route**

In the route `switch` (near line 530 where `/api/me/state` is registered), add a new case among the other `/api/me/*` cases. The codebase pattern is one `case` per path with method checks inside (see `/api/me/favorites` at lines 510-516). Add:

```ts
case "/api/me/progress":
  if (req.method === "PUT") return await handleProgressWrite(req)
  throw new ExtractorError("method not allowed", 405)
```

Confirm `ExtractorError` is imported (it is, per existing usage).

- [ ] **Step 5: Verify typecheck + build + core tests**

Run: `bun run typecheck && bun run test && bun run build`
Expected: all PASS. (API has no HTTP-level test runner in this repo; correctness is covered by Store unit tests in 3.3. If a smoke test is wanted, `curl -X PUT localhost:3001/api/me/progress -d '{"kind":"post","id":"x","progress":0.3}'` should 404 for an unknown id.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts apps/web/src/lib/routes.ts
git commit -m "feat(api): PUT /api/me/progress + read_progress in /api/me/state"
```

---

### Task 3.6: Frontend `useReadingProgress` hook (sample + persist + restore)

**Files:**
- Create: `apps/web/src/hooks/use-reading-progress.ts`
- Modify: `apps/web/src/components/item-actions.tsx` (accept `state`/`reload` as props instead of calling `useItemState` internally)
- Modify: `apps/web/src/pages/ReadPage.tsx` and `apps/web/src/pages/BookPage.tsx` (call `useItemState` + `useReadingProgress`)

**Interfaces:**
- Consumes: `useItemState().state.read_progress` (restore value), `api.meProgress`.
- Produces: `useReadingProgress(kind, id, { ready, stateReady, restore })` — attaches scroll listener (only when `ready`), debounced-writes progress to `/api/me/progress`, flushes on cleanup, and restores scroll **once both content and state are loaded**.

> Review Issue #1 (restore race) + #11 (step order): the previous version's restore could silently no-op because `opts.restore` was `undefined` until the state GET resolved, and it marked itself "done" on the first run. Fixed here by (a) requiring `stateReady` before attempting restore, (b) lifting `useItemState` into the page **first** (Step 1) so the flow compiles top-to-bottom, and (c) keying the restore effect off `id` so it re-runs for a new article if the hook instance is reused.

- [ ] **Step 1: Lift `useItemState` into ReadPage/BookPage; pass `state`/`reload` to `ItemActions`**

`useItemState` currently lives inside `ItemActions` (`apps/web/src/components/item-actions.tsx:19-38`), which only mounts **after** `{content && ...}`. To give the progress hook the restore value (and preserve the "state fetched after recordVisit" ordering), lift the hook into each page. In `apps/web/src/components/item-actions.tsx`:

- Change the `ItemActions` signature from `({ kind, id, onRefresh, refreshing })` to accept the already-loaded state:

```tsx
import type { ItemState } from "@/components/item-actions" // (local type, updated in Task 3.2)

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
  // ... remove the internal `const { state, reload } = useItemState(...)` call;
  //     the rest of the component already destructures `state`/`reload`.
```

Remove the `useItemState` call and its `useState`/`useEffect`/`useCallback` imports if now unused inside `ItemActions` (keep `useState` for `showSettings` from Task 1.5). Export `useItemState` itself from this module unchanged (the pages will import it).

- [ ] **Step 2: Call `useItemState` in ReadPage, pass down, and call `useReadingProgress`**

In `apps/web/src/pages/ReadPage.tsx`, add at the top of the component (so the state GET starts in parallel with content fetch):

```tsx
import { useItemState } from "@/components/item-actions"
import { useReadingProgress } from "@/hooks/use-reading-progress"

// inside ReadPage(), above the fetch logic:
const { state, reload } = useItemState("post", tid)
useReadingProgress("post", tid, {
  ready: !!content,            // 内容已挂载
  stateReady: state !== null,  // state GET 已完成（区分 null-progress 与 未加载）
  restore: state?.read_progress,
})
```

Pass `state`/`reload` to `<ItemActions>`:

```tsx
<ItemActions
  kind="post"
  id={tid}
  state={state}
  reload={reload}
  onRefresh={() => void fetchContent({ refresh: true })}
  refreshing={refreshing}
/>
```

- [ ] **Step 3: Same changes in BookPage**

Mirror Step 2 in `apps/web/src/pages/BookPage.tsx` with `kind="book"`, `id={cid}`.

- [ ] **Step 4: Write the `useReadingProgress` hook**

Create `apps/web/src/hooks/use-reading-progress.ts`. The restore effect waits for `ready && stateReady` before running, only restores for `restore > 0.05`, and re-keys on `id`:

```tsx
import { useEffect, useRef } from "react"
import { api } from "@/lib/routes"

const WRITE_DEBOUNCE_MS = 1500

function computeProgress(): number | null {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return null // 内容不足一屏：不写入
  return Math.max(0, Math.min(1, window.scrollY / max))
}

export function useReadingProgress(
  kind: "post" | "book",
  id: string,
  opts: {
    ready: boolean
    stateReady: boolean
    restore: number | null | undefined
  }
) {
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgress = useRef<number | null>(null)
  const lastSent = useRef<number | null>(null)

  // 恢复滚动位置：内容与 state 都就绪后执行一次；按 id 重新挂载
  useEffect(() => {
    if (!opts.ready || !opts.stateReady) return
    if (typeof opts.restore !== "number" || opts.restore <= 0.05) return
    const target = opts.restore
    // 双 rAF：等 serif 字体与正文布局稳定后再定位
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max > 0) window.scrollTo(0, Math.round(target * max))
      })
    )
    return () => cancelAnimationFrame(raf2)
    // 依赖里只放能触发"重新恢复"的信号；ready/stateReady/id 变才重跑
  }, [opts.ready, opts.stateReady, opts.restore, id])

  // 写入：滚动时把采样值存进 ref，离开页面 flush 发送 ref（绝不实时重测 scrollY）。
  // 原因：章节导航的 scrollTo(0,0) 与路由切换会在旧页面的 effect cleanup 之前把
  // scrollY 归零；若 flush 实时重测，会把上一篇文章的进度覆盖成 0（review Must-fix）。
  useEffect(() => {
    if (!opts.ready) return
    // id 变化时（同组件实例复用）重置采样，避免串用上一篇的进度
    lastProgress.current = null
    lastSent.current = null

    const flush = async () => {
      const p = lastProgress.current
      if (p === null) return // 尚未采样过（例如内容刚就绪、用户未滚动）
      if (lastSent.current !== null && Math.abs(p - lastSent.current) < 0.01) {
        return
      }
      lastSent.current = p
      try {
        await fetch(api.meProgress, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, id, progress: p }),
        })
      } catch {
        // 写入失败静默：不影响阅读
      }
    }

    const onScroll = () => {
      const p = computeProgress()
      if (p !== null) lastProgress.current = p
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (writeTimer.current) clearTimeout(writeTimer.current)
      void flush()
    }
  }, [opts.ready, kind, id])
}
```

> Review Must-fix (unmount flush): the original `flush()` called `computeProgress()` live on unmount. Combined with `ChapterNav`'s synchronous `scrollTo(0,0)` on chapter change, that wrote `progress: 0` for the article the user just left. Fixed by sampling into `lastProgressRef` on every scroll and flushing the **ref** (never a live remeasure) — so a navigation-induced scroll-to-top can't wipe the saved progress. `lastProgressRef`/`lastSent` reset when `id` changes.
>
> Note on Strict Mode: React 18/19 dev double-invokes effects. The restore effect is idempotent (`scrollTo` to the same target twice is harmless); the write effect resets refs at attach and flushes the ref on cleanup, so a double-mount won't double-write or zero progress.

- [ ] **Step 5: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual:
- Open a long post, scroll to ~50%, wait 2s (debounce), navigate away and back → confirm it restores to ~50%.
- **Chapter-jump regression (review Must-fix):** open a serial post, scroll to ~60%, immediately click 下一章 (or press `→`) **without waiting for the debounce** → land on chapter B. Go back to chapter A → confirm A's saved progress is still ~60% (NOT zeroed by the unmount flush). Devtools network during the jump should show the `PUT` for A carrying ~0.6, not 0.
- Devtools network → confirm a `PUT /api/me/progress` fires after scrolling stops; confirm `GET /api/me/state` runs in parallel with content fetch.
- Open a never-read post → starts at top (no restore, `restore` is `null`).
- Open a short post (content shorter than viewport) → no `PUT` fires (short-content skip).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/use-reading-progress.ts apps/web/src/components/item-actions.tsx apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): reading progress memory with scroll restore"
```

---

### Task 3.7: Reading-progress markers on `/api/me/*` list cards

**Files:**
- Modify: `apps/web/src/components/me-item-card.tsx:12-22` (the `MeListItem` interface) and the card body

**Interfaces:**
- Consumes: `ListItem.read_progress` from the API (Task 3.3).
- Produces: `MeListItem.read_progress?: number | null`; the card shows a muted progress readout when `read_progress` is a number > 0.

> Review Issue #4: the card uses the local **`MeListItem`** interface (`me-item-card.tsx:12`), not core's `ListItem`. Add the field there explicitly, or `item.read_progress` fails typecheck. Also: on `/history` every row already has `visit_count ≥ 1`, so an always-on `· 已读` is vacuous — show **progress %** instead (e.g. `已读 42%`), only when `read_progress` is a positive number.

- [ ] **Step 1: Add `read_progress` to `MeListItem`**

In `apps/web/src/components/me-item-card.tsx`, extend the interface (currently lines 12-22):

```tsx
export interface MeListItem {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: boolean
  tags: string[]
  read_progress?: number | null
}
```

- [ ] **Step 2: Render a muted progress marker**

In the `MeItemCard` body, next to the title (or in the meta row), add a marker only when there is meaningful progress. Keep it visually muted:

```tsx
{typeof item.read_progress === "number" && item.read_progress > 0 && (
  <span className="ml-1.5 text-xs text-muted-foreground/70">
    · 已读 {Math.round(item.read_progress * 100)}%
  </span>
)}
```

(Place it in the existing meta region — read `me-item-card.tsx` to find where `visit_count`/`favorited` are rendered and put this beside them. Do not add an unconditional `· 已读`; only the progress-percent form above.)

- [ ] **Step 3: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual: visit a post, scroll partway (wait for the debounced `PUT`), open `/history` → confirm `已读 N%` shows next to that item. Open an unread item in history (e.g. just opened, no scroll) → no marker.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/<card-file>.tsx
git commit -m "feat(web): show 已读 marker on me-list cards"
```

---

### Phase 3 verification gate

- [ ] **Step 1:** `bun run test && bun run typecheck && bun run build` all PASS.
- [ ] **Step 2:** Manual: scroll a post, leave, return → position restored. `/history` shows 已读 markers. `DELETE /api/me/history?all=1` clears progress (re-open a cleared post → starts at top, no restore).

---

## Phase 4: Read page chapter navigation (§4a)

### Task 4.1: Probe `content.links` shape with real tids

**Files:**
- No code changes; produces a documented finding for Task 4.2.

- [ ] **Step 1: Fetch 2–3 real连载 tids and inspect `content.links`**

Run the API against real Cool18 content (ensure `HTTPS_PROXY` is set if upstream is unreachable):

```bash
curl "localhost:3001/api/posts?tid=<a-known-serial-tid>" | jq '.links, .meta.rootTid'
```

Document: does `links` contain the current tid? What is the `index` ordering — tid-numeric or source order? Are unrelated "扩展" posts mixed in?

- [ ] **Step 2: Record the finding**

Write the conclusion (1–3 sentences) into the plan's Task 4.2 implementation note below as a comment, so the implementer knows the real shape. If `links` is unreliable for prev/next (mixed unrelated posts), **downgrade §4a** to: only show the bottom RelatedLinks list (already exists), skip prev/next — and note that decision in the commit. Otherwise proceed to 4.2.

---

### Task 4.2: Chapter nav bar + prev/next from `content.links`

> **STATUS: SKIPPED by §4a downgrade (Task 4.1 probe finding, 2026-08-06):** scanned 63 real posts (3 featured + 60 across 都市/玄幻/校园) — zero had non-empty `content.links`; two raw upstream thread-page checks confirm cool18 carries no chapter-nav links outside the `<pre>` body (serials are single aggregated posts like 「1-87」). `content.links` is empty in practice → per plan fallback, prev/next is skipped; the existing bottom RelatedLinks list ships unchanged. ChapterNav's empty-guard would render nothing for all current content — dead UI (YAGNI).

**Files:**
- Create: `apps/web/src/components/chapter-nav.tsx`
- Modify: `apps/web/src/components/article-view.tsx` (render `ChapterNav` above `RelatedLinks` in the footer)
- Modify: `apps/web/src/pages/ReadPage.tsx` (pass `currentTid` + `links` to the footer)

**Interfaces:**
- Consumes: the `links` array from `ContentData` in `ReadPage.tsx` (each item `{ index, title, tid }`), plus the current `tid`.
- Produces: `<ChapterNav links currentTid />` — renders prev/next buttons (one or both) using numeric-tid neighbor lookup; renders nothing when `links` is empty or tids aren't numeric.

> Review Issue #3: `apps/web` does **not** depend on `@workspace/core` (only `@workspace/ui`) — importing `ChapterLink` from it would break. `ReadPage.tsx` already defines a local `ChapterLink`-shaped type inline; mirror that here with a **local type**. Issue #6: the non-numeric guard must reject a non-numeric `currentTid` even when `links` are numeric (otherwise `Number(currentTid)` is `NaN` and the sort/neighbors break).

- [ ] **Step 1: Write the `ChapterNav` component**

Create `apps/web/src/components/chapter-nav.tsx`:

```tsx
import { useCallback } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useNavigate } from "react-router-dom"

// 本地类型：与 ReadPage.tsx 的 ContentData.links 形状一致；不从 @workspace/core 导入（web 不依赖它）
interface NavLink {
  index: number
  title: string
  tid: string
}

interface Neighbor {
  tid: string
  title: string
}

function findNeighbors(
  links: NavLink[],
  currentTid: string
): { prev: Neighbor | null; next: Neighbor | null } {
  // 当前 tid 与 links 都必须是纯数字；否则整条导航条不渲染（避免 NaN 排序）
  if (!/^\d+$/.test(currentTid)) return { prev: null, next: null }
  const numeric = links.filter((l) => /^\d+$/.test(l.tid))
  if (numeric.length === 0) return { prev: null, next: null }

  const all = [
    ...numeric.map((l) => ({ tid: l.tid, title: l.title })),
    { tid: currentTid, title: "" },
  ]
    .filter((x, i, arr) => arr.findIndex((y) => y.tid === x.tid) === i) // 去重
    .sort((a, b) => Number(a.tid) - Number(b.tid))
  const idx = all.findIndex((x) => x.tid === currentTid)
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: idx > 0 ? { tid: all[idx - 1].tid, title: all[idx - 1].title } : null,
    next:
      idx < all.length - 1
        ? { tid: all[idx + 1].tid, title: all[idx + 1].title }
        : null,
  }
}

export function ChapterNav({
  links,
  currentTid,
}: {
  links: NavLink[]
  currentTid: string
}) {
  const navigate = useNavigate()
  const { prev, next } = findNeighbors(links, currentTid)
  const go = useCallback(
    (tid: string) => {
      // 这里的 scrollTo(0,0) 不会误清上一章进度：useReadingProgress 的 unmount flush
      // 发送的是 lastProgressRef（采样值），不会实时重测已被归零的 scrollY。
      void navigate(`/read/${tid}`)
      window.scrollTo(0, 0)
    },
    [navigate]
  )
  if (!prev && !next) return null

  return (
    <nav className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
      {prev ? (
        <button
          type="button"
          onClick={() => go(prev.tid)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
          <span className="max-w-[40vw] truncate">上一章</span>
        </button>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-foreground/70">相关章节</span>
      {next ? (
        <button
          type="button"
          onClick={() => go(next.tid)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
        >
          <span className="max-w-[40vw] truncate">下一章</span>
          <ChevronRight className="size-4" />
        </button>
      ) : (
        <span />
      )}
    </nav>
  )
}
```

- [ ] **Step 2: Render `ChapterNav` in the ReadPage footer**

In `apps/web/src/components/article-view.tsx`, the `ArticleView` footer slot receives arbitrary ReactNode. The cleaner path: in `apps/web/src/pages/ReadPage.tsx`, the `footer` prop currently is `<><RelatedLinks /><ReplyList/></>`. Add `<ChapterNav links={content.links} currentTid={tid} />` as the first element:

```tsx
import { ChapterNav } from "@/components/chapter-nav"
// ... in JSX, the footer prop:
footer={
  <>
    <ChapterNav links={content.links} currentTid={tid} />
    <RelatedLinks links={content.links} />
    <ReplyList replies={content.replies} />
  </>
}
```

- [ ] **Step 3: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual: open a post that has `content.links` → confirm the nav bar appears at the bottom with prev/next (whichever exist); click next → navigates and scrolls to top. Open a post with no links → confirm no nav bar renders.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chapter-nav.tsx apps/web/src/pages/ReadPage.tsx
git commit -m "feat(web): chapter prev/next nav on read page"
```

---

### Task 4.3: Arrow-key chapter navigation (`←` / `→`)

**Files:**
- Modify: `apps/web/src/components/chapter-nav.tsx` (add a hotkey effect) OR create `apps/web/src/components/reading-hotkeys.tsx`. Reuse `isTypingTarget` from `theme-provider.tsx:22-33`.

**Interfaces:**
- Consumes: the same neighbor lookup from Task 4.2; `isTypingTarget` (export it from `theme-provider.tsx`).

- [ ] **Step 1: Export `isTypingTarget` from theme-provider**

In `apps/web/src/components/theme-provider.tsx`, change `function isTypingTarget` to `export function isTypingTarget`. It's currently module-private (lines 22-33).

- [ ] **Step 2: Add the hotkey effect inside `ChapterNav`**

In `apps/web/src/components/chapter-nav.tsx`, add a `useEffect` that listens for arrow keys and navigates. Mirror the four guards from `theme-provider.tsx` (defaultPrevented/repeat, modifier keys, key match, typing target):

```tsx
import { useEffect } from "react"
import { isTypingTarget } from "@/components/theme-provider"

// inside ChapterNav, after computing prev/next:
useEffect(() => {
  if (!prev && !next) return
  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    if (isTypingTarget(event.target)) return
    if (event.key === "ArrowLeft" && prev) {
      event.preventDefault()
      void navigate(`/read/${prev.tid}`)
      window.scrollTo(0, 0)
    } else if (event.key === "ArrowRight" && next) {
      event.preventDefault()
      void navigate(`/read/${next.tid}`)
      window.scrollTo(0, 0)
    }
  }
  window.addEventListener("keydown", onKeyDown)
  return () => window.removeEventListener("keydown", onKeyDown)
}, [prev, next, navigate])
```

- [ ] **Step 3: Verify typecheck + build + manual**

Run: `bun run typecheck && bun run build`
Expected: PASS.

Manual: on a reading page with prev/next, press `→` → goes to next chapter (and doesn't also scroll); press `←` → prev. Focus an input (e.g. the tag editor) → confirm arrow keys do **not** navigate. Confirm `d` still toggles theme.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/theme-provider.tsx apps/web/src/components/chapter-nav.tsx
git commit -m "feat(web): arrow-key chapter navigation"
```

---

### Phase 4 verification gate

- [ ] **Step 1:** `bun run test && bun run typecheck && bun run build` all PASS.
- [ ] **Step 2:** Manual: prev/next bar + `←`/`→` work on a serial; no nav on standalone posts; arrow keys ignored while typing.

---

## Phase 5: Book page chapter list (§4b) — conditional on upstream probe

> **This phase is gated on Task 5.1's probe.** If the book TOC HTML is too unstable/complex, **skip the phase** (commit only Task 5.1's finding) and leave §4b for a future iteration. ReadPage nav (Phase 4) ships regardless.

### Task 5.1: Probe book TOC HTML structure

**Files:**
- No code changes; produces a fixture + a go/no-go decision.

- [ ] **Step 1: Fetch a real book page and inspect**

```bash
curl "localhost:3001/api/books?cid=<a-real-cid>" | jq '.title, .meta'
curl --proxy "$HTTPS_PROXY" "<upstream-book-index-url>" -o /tmp/book-toc.html
```

Inspect `/tmp/book-toc.html`: is there a chapter list section? What selector selects chapter links and their cids/titles? Are chapters paginated?

- [ ] **Step 2: Save a fixture and decide**

If a usable TOC exists: save a trimmed fixture to `packages/core/src/extractor/__fixtures__/book-toc.html` (just the TOC fragment). Proceed to Task 5.2.
If not: **stop Phase 5 here**. Commit a short note and skip 5.2–5.4:

```bash
git commit --allow-empty -m "chore(extractor): book TOC probe — no stable structure, deferring §4b"
```

---

### Task 5.2: Add `BookChapterLink` type

**Files:**
- Modify: `packages/core/src/extractor/types.ts` (add `BookChapterLink`; extend `BookContentResponse`)

**Interfaces:**
- Produces: `BookChapterLink = { index: number; title: string; cid: string }`; `BookContentResponse.chapters?: BookChapterLink[]`.

- [ ] **Step 1: Add the types**

In `packages/core/src/extractor/types.ts`, add:

```ts
export interface BookChapterLink {
  index: number
  title: string
  cid: string
}
```

Extend `BookContentResponse`:

```ts
export interface BookContentResponse {
  title: string
  content: string
  meta: BookMeta
  chapters?: BookChapterLink[]
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS (additive change).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/extractor/types.ts
git commit -m "feat(core): BookChapterLink type and chapters field"
```

---

### Task 5.3: Implement `extractBookChapters` in the extractor (TDD with fixture)

**Files:**
- Modify: `packages/core/src/extractor/extractor.ts` (add `extractBookChapters`)
- Modify: `packages/core/src/extractor/extractor.test.ts` (add fixture-based test)
- Modify: `apps/api/src/index.ts` (`handleBooks` attaches `chapters` to the response)

**Interfaces:**
- Consumes: the fixture from Task 5.1.
- Produces: `Cool18Extractor.extractBookChapters(html)` returning `BookChapterLink[]`; `GET /api/books?cid=` includes `chapters` when the extractor found a TOC.

> Review Issue #9 / #14: the previous plan left API wiring as "wire into the existing book handler" and named the method `fetchBookChapters` (it takes HTML, doesn't fetch). Renamed to `extractBookChapters` to match `extractBookContent`/`extractLinksFromDom`; API file named explicitly.

- [ ] **Step 1: Write the failing test**

In `packages/core/src/extractor/extractor.test.ts`, add a test that loads the fixture and asserts parsed chapters (adapt selectors to the real structure recorded in Task 5.1):

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("extractBookChapters parses TOC from fixture", () => {
  const html = readFileSync(
    join(__dirname, "__fixtures__/book-toc.html"),
    "utf8"
  )
  const ext = new Cool18Extractor()
  const chapters = ext.extractBookChapters(html)
  expect(chapters.length).toBeGreaterThan(0)
  expect(chapters[0]).toMatchObject({
    index: expect.any(Number),
    title: expect.any(String),
    cid: expect.any(String),
  })
  // index 单调递增
  const indexes = chapters.map((c) => c.index)
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/extractor/extractor.test.ts -t "extractBookChapters"`
Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Implement the parser**

In `packages/core/src/extractor/extractor.ts`, add `extractBookChapters(html: string): BookChapterLink[]` using Cheerio with the selectors identified in Task 5.1. Follow the existing extractor method patterns (load once with `cheerio.load`, query, map, dedupe). The signature takes already-fetched HTML (mirrors `extractLinksFromDom`, which also takes parsed input).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/extractor/extractor.test.ts`
Expected: PASS — new test green, no existing book test broken.

- [ ] **Step 5: Attach `chapters` to the `GET /api/books` response**

In `apps/api/src/index.ts`, the `handleBooks` handler calls the extractor for book content. After building the `BookContentResponse`, call `extractBookChapters` on the upstream HTML the handler already fetched (do **not** fetch a second time — reuse the HTML the content was extracted from), and attach it: `bookResponse.chapters = chapters` when the array is non-empty. Return the enriched object via `jsonOk(bookResponse, ...)` as before. (If the extractor's book method already has the raw HTML internally, expose it or have the method return chapters itself — pick whichever fits the existing structure with the smallest diff.)

- [ ] **Step 6: Verify typecheck + full tests + build**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/extractor/extractor.ts packages/core/src/extractor/extractor.test.ts packages/core/src/extractor/__fixtures__/ apps/api/src/index.ts
git commit -m "feat(core): extract book chapter list; expose via /api/books"
```

---

### Task 5.4: Render book chapter list + prev/next on BookPage

**Files:**
- Modify: `apps/web/src/pages/BookPage.tsx` (extend `BookData` type; render chapters)

**Interfaces:**
- Consumes: `book.chapters` from the API response.
- Produces: a TOC section + prev/next using React Router navigation.

> Review Issue #3 / #10: don't import `BookChapterLink` from `@workspace/core` (web doesn't depend on it) — define a local type. Use React Router `Link` (or `bookPath` + `navigate`), not raw `<a>`, so book TOC navigation matches the rest of the SPA.

- [ ] **Step 1: Extend `BookData` and render with `Link`**

In `apps/web/src/pages/BookPage.tsx`, add a local `BookChapter` type and extend the local `BookData` interface:

```tsx
import { Link } from "react-router-dom"
import { bookPath } from "@/lib/routes"

// 与 packages/core 的 BookChapterLink 形状一致；本地声明，web 不依赖 core
interface BookChapter {
  index: number
  title: string
  cid: string
}

// 扩展现有 BookData：
//   chapters?: BookChapter[]
```

Render a TOC at the bottom using `Link` (not `<a>`), so navigation stays client-side:

```tsx
{book.chapters && book.chapters.length > 0 && (
  <section className="mt-6 rounded-2xl border border-border p-4 sm:rounded-3xl sm:p-6">
    <h2 className="mb-3 text-sm font-medium text-muted-foreground">目录</h2>
    <ol className="space-y-1.5 text-sm">
      {book.chapters.map((c) => (
        <li key={c.cid}>
          <Link
            to={bookPath(c.cid)}
            className="text-foreground/80 hover:text-foreground hover:underline"
          >
            {c.title}
          </Link>
        </li>
      ))}
    </ol>
  </section>
)}
```

Confirm `bookPath(cid)` exists in `apps/web/src/lib/routes.ts` (it's used by `me-item-card.tsx` already, so it should). Add prev/next between chapters using `cid` neighbor lookup if cids are numeric; otherwise just the list (mirror `ChapterNav` logic parametrized for `cid`).

- [ ] **Step 2: Verify typecheck + build + manual**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all PASS.

Manual: open a book → confirm chapter list renders; click a chapter → client-side navigates to that book page (no full reload).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): book chapter list on book page"
```

---

### Phase 5 verification gate (only if not deferred)

- [ ] **Step 1:** `bun run test && bun run typecheck && bun run build` all PASS.
- [ ] **Step 2:** Manual: book page shows TOC; navigation works; existing book fetch tests still green.

---

## Final integration verification

- [ ] **Step 1: Full suite**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all PASS.

- [ ] **Step 2: End-to-end manual walkthrough**

1. Open a post → serif, 17px, comfortable. Open settings → bump font size → live update.
2. Toggle 栏宽 wide → header + body widen together **on reading pages only**; Home/History stay narrow.
3. Scroll to 60%, leave, return → position restored.
4. Open `/history` → `已读 N%` shows for items with progress.
5. On a serial post → 上一章/下一章 bar + `←`/`→` keys work.
6. On a book (if Phase 5 shipped) → chapter list renders, client-side nav.
7. `d` toggles theme; arrow keys don't fire while typing in tag editor.

- [ ] **Step 3: Commit any final polish**

If tuning (spacing, colors, copy) is needed from the walkthrough, commit it:

```bash
git commit -am "polish(web): reading experience tuning"
```

---

## Open implementation notes (from spec查证清单)

- **§4a `content.links` reliability**: Task 4.1 probes this before 4.2. If `links` mixes unrelated "扩展" posts with real serial chapters, the numeric-neighbor lookup may produce wrong prev/next. The probe determines whether to ship prev/next or only the existing `RelatedLinks` list. Decision recorded in Task 4.1 Step 2.
- **§4b book TOC**: Task 5.1 is a hard gate. Unstable upstream HTML → defer the phase (commit the finding, skip 5.2–5.4). Phase 4 ships independently.
- **`useItemState` lifted into pages**: Resolved in Task 3.6 (Step 1 lifts it; Step 2–3 wire it through). The restore-race fix depends on this ordering — `stateReady` requires the hook at the page level so the GET starts in parallel with content and resolves before restore attempts.
