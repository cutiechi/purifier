# 同书章节折叠（Book Folding）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 cool18（site=1）列表里"书名"相同的多个章节帖子默认折叠成一组，点击头部展开看各章。

**Architecture:** 纯前端。纯函数 `groupBooks` 按 `parseListTitle(rawTitle).title` 归一化分组（渲染层 `useMemo`），可复用组件 `<CollapsibleBookGroup>` 负责折叠 UI，页面层单例 hook `useExpandedBooks` 经 props 传展开状态（持久化到 localStorage，按页面 scope 隔离）。不改 API / extractor / DB。

**Tech Stack:** React 19、TypeScript strict、Tailwind CSS 4、Bun test。

**对照 spec：** `docs/superpowers/specs/2026-08-07-book-folding-design.md`

## Global Constraints

- 代码风格：Prettier（无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`）——改动文件均按此风格。
- 跨包导入用 `@workspace/...`，前端页面导入用 `@/` 别名。
- TypeScript `strict`；`noEmit` 类型检查在 `apps/web` 内运行。
- 图标优先用本地 `@/components/icons.tsx`，列表卡片复用 `ListPostCard` / `MeItemCard` 现有风格（`rounded-2xl border border-border/80 bg-card/80`）。
- 上游解析统一走 `packages/core` 的 `Extractor`——本计划不碰上游，只用前端已有的 `parseListTitle`（`@/lib/title-parse`）。
- 只对 `site === "1"` 且（Me 场景）`kind === "post"` 的项分组；xbookcn（site=2）与 `kind === "book"` 一律 single。
- 分页页（Browse/Search/历史/收藏/标签）跨页不合并；首页无限滚动累积数组内合并。
- 验证三件套：`bun run test`、`bun run typecheck`、`bun run build`。

## File Structure

**新增（4 个文件）：**
- `apps/web/src/lib/book-groups.ts` — 纯函数 `normalizeTitleKey` / `groupBooks` / `GroupedItem` 类型 / `groupMeListItems`。单一职责：标题归一化 + 分组逻辑，不依赖 React。
- `apps/web/src/lib/book-groups.test.ts` — Bun test 单测，覆盖纯函数。
- `apps/web/src/components/collapsible-book-group.tsx` — `<CollapsibleBookGroup>` 组件。单一职责：折叠 UI + a11y，展开状态经 props 传入，不读写 localStorage。
- `apps/web/src/hooks/use-expanded-books.ts` — `useExpandedBooks(scope)` hook。单一职责：localStorage 读写 + React state，按 scope 隔离。

**修改（13 个文件）：**
- `apps/web/package.json` — 加 `"test": "bun test"`。
- `apps/web/src/components/icons.tsx` — 补 `IconChevronDown`。
- `apps/web/src/components/me-item-card.tsx` — 加可选 `titleOverride`/`subtitleOverride` props。
- `apps/web/src/components/me-list-page.tsx` — 加 `bookGroupScope` prop + 分组接入。
- `apps/web/src/components/picks-sections.tsx` — 仅非 chip 的 PostList 路径分组。
- `apps/web/src/pages/HomePage.tsx`、`BrowsePage.tsx`、`SearchPage.tsx`、`FeaturedPage.tsx`、`TrendingPage.tsx`、`CommentsPage.tsx` — 接入分组。
- `apps/web/src/pages/HistoryPage.tsx`、`FavoritesPage.tsx`、`TagsPage.tsx` — 传 `bookGroupScope`。

---

## Task 1: 分组纯函数 + 单测（TDD）

**Files:**
- Create: `apps/web/src/lib/book-groups.ts`
- Test: `apps/web/src/lib/book-groups.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `parseListTitle` from `@/lib/title-parse`（已存在，返回 `{ title, chapters, author, ... }`）
- Produces: `GroupedItem<T>`、`normalizeTitleKey`、`groupBooks`、`groupMeListItems`——后续所有 Task 依赖。

**注意类型签名（后续 Task 会精确引用这些名字）：**

```ts
export type GroupedItem<T> =
  | { type: "single"; item: T }
  | {
      type: "group"
      key: string
      title: string
      items: T[]
      author: string | null   // 组内首个解析出 author 的项（无则 null）
      genre: string | null    // 组内首个解析出 genre 的项（无则 null）
    }

export function normalizeTitleKey(title: string): string
export function groupBooks<T>(
  items: T[],
  getTitle: (item: T) => string,
): GroupedItem<T>[]
export function groupMeListItems(
  items: MeListItem[],
): GroupedItem<MeListItem>[]
```

`group` 项的 `author`/`genre` 在 `groupBooks` 内部从组内各项的 `parseListTitle` 结果聚合：取第一个非空的 `author`、第一个非空的 `genre`。各页面据此渲染 `summary`/`trailing`（见 Task 4+ 各接入 Task）。

`groupMeListItems` 的语义：仅 `kind === "post" && site === "1"` 的项参与分组（其余项一律直通 single）；所有**符合条件的 post 项**（无论是否被 book 项隔开）共同进入同一套书名桶，再按原始数组顺序 walk 去重发射——即同名 post 被 book 隔开仍合成一组。`MeListItem` 从 `@/components/me-item-card` 导入。

> **禁止**实现成"按连续 post 段分段 groupBooks"——那会让被 book 隔开的同名 post 拆成两段、各自单条，与 interleave 语义冲突。必须用"全局 post 桶 + 原序 walk"。

- [ ] **Step 1: 给 `apps/web` 加测试入口**

编辑 `apps/web/package.json`，在 `scripts` 里加一行（紧挨 `typecheck`）：

```json
"typecheck": "tsc --noEmit",
"test": "bun test"
```

- [ ] **Step 2: 写失败测试**

创建 `apps/web/src/lib/book-groups.test.ts`：

```ts
import { test, expect } from "bun:test"
import {
  groupBooks,
  groupMeListItems,
  normalizeTitleKey,
} from "@/lib/book-groups"
import type { MeListItem } from "@/components/me-item-card"

test("normalizeTitleKey 去书名号包裹并小写", () => {
  expect(normalizeTitleKey("《马屌少年》")).toBe("马屌少年")
  expect(normalizeTitleKey("【马屌少年】")).toBe("马屌少年")
  expect(normalizeTitleKey("［马屌少年］")).toBe("马屌少年")
  expect(normalizeTitleKey("[马屌少年]")).toBe("马屌少年")
  expect(normalizeTitleKey("马屌少年")).toBe("马屌少年")
  expect(normalizeTitleKey("  马屌少年  ")).toBe("马屌少年")
})

test("normalizeTitleKey 空串保持空", () => {
  expect(normalizeTitleKey("")).toBe("")
  expect(normalizeTitleKey("【】")).toBe("")
})

test("同名多章合并为一组，单条为 single", () => {
  const items = [
    { tid: "1", title: "【马屌少年】（1）作者：小明" },
    { tid: "2", title: "马屌少年（2）作者：小明" },
    { tid: "3", title: "【独立短篇】" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(2)
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].key).toBe("马屌少年")
    expect(result[0].title).toBe("马屌少年")
    expect(result[0].items).toHaveLength(2)
  }
  expect(result[1].type).toBe("single")
})

test("空标题项一律 single，不并组", () => {
  const items = [
    { tid: "1", title: "" },
    { tid: "2", title: "【】" },
    { tid: "3", title: "正常书（1）" },
    { tid: "4", title: "正常书（2）" },
  ]
  const result = groupBooks(items, (it) => it.title)
  // 两个空标题各 single + 正常书一组 = 3 项
  expect(result).toHaveLength(3)
  expect(result.filter((g) => g.type === "single")).toHaveLength(2)
})

test("group 按首次出现位置排序，组内保持原始相对序", () => {
  const items = [
    { tid: "a", title: "B书（1）" },
    { tid: "b", title: "A书（1）" },
    { tid: "c", title: "B书（2）" },
    { tid: "d", title: "A书（2）" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(2)
  // B书先出现（tid=a 在 index 0），A书后出现（tid=b 在 index 1）
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].title).toBe("B书")
    expect(result[0].items.map((i) => i.tid)).toEqual(["a", "c"])
  }
  if (result[1].type === "group") {
    expect(result[1].title).toBe("A书")
    expect(result[1].items.map((i) => i.tid)).toEqual(["b", "d"])
  }
})

test("多个不同 group 混排互不串扰", () => {
  const items = [
    { tid: "1", title: "X（1）" },
    { tid: "2", title: "Y（1）" },
    { tid: "3", title: "X（2）" },
    { tid: "4", title: "孤狼" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(3)
  expect(result.filter((g) => g.type === "group")).toHaveLength(2)
  expect(result.filter((g) => g.type === "single")).toHaveLength(1)
})

test("groupMeListItems: book 项直通 single，post 项按 title 分组并保持原序", () => {
  const post = (id: string, title: string, site = "1"): MeListItem => ({
    kind: "post",
    id,
    title,
    url: "",
    site,
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  const book = (id: string, title: string): MeListItem => ({
    kind: "book",
    id,
    title,
    url: "",
    site: "2",
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  // 同名 post 被 book 隔开，仍应合成一组（全局 post 桶，非连续段）
  const items = [
    post("p1", "故事（1）"),
    book("b1", "某本 xbookcn 书"),
    post("p2", "故事（2）"),
  ]
  const result = groupMeListItems(items)
  expect(result).toHaveLength(2)
  // post 两章合成一组，位置在 index 0（首次出现处）
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].items.map((i) => i.id)).toEqual(["p1", "p2"])
  }
  // book 项保持原位（index 1）作为 single
  expect(result[1].type).toBe("single")
  if (result[1].type === "single") {
    expect(result[1].item.id).toBe("b1")
  }
})

test("groupMeListItems: site !== '1' 的 post 直通 single，不参与分组", () => {
  const post = (id: string, title: string, site: string): MeListItem => ({
    kind: "post",
    id,
    title,
    url: "",
    site,
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  // 两章同名，但 site=2，应各自 single
  const items = [
    post("p1", "故事（1）", "2"),
    post("p2", "故事（2）", "2"),
  ]
  const result = groupMeListItems(items)
  expect(result).toHaveLength(2)
  expect(result.every((g) => g.type === "single")).toBe(true)
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd apps/web && bun test src/lib/book-groups.test.ts`
Expected: FAIL（模块不存在 / import 报错）。

- [ ] **Step 4: 实现 `book-groups.ts`**

创建 `apps/web/src/lib/book-groups.ts`：

```ts
import { parseListTitle } from "@/lib/title-parse"
import type { MeListItem } from "@/components/me-item-card"

export type GroupedItem<T> =
  | { type: "single"; item: T }
  | {
      type: "group"
      key: string
      title: string
      items: T[]
      author: string | null
      genre: string | null
    }

export function normalizeTitleKey(title: string): string {
  return title
    .replace(/^[《【［[]+|[》】］\]]+$/g, "")
    .trim()
    .toLowerCase()
}

/** 从一组项里取首个非空 author / genre（用于组头展示） */
function pickHeaderMeta<T>(
  items: T[],
  getTitle: (item: T) => string,
): { author: string | null; genre: string | null } {
  let author: string | null = null
  let genre: string | null = null
  for (const it of items) {
    const p = parseListTitle(getTitle(it))
    if (!author && p.author) author = p.author
    if (!genre && p.genre) genre = p.genre
    if (author && genre) break
  }
  return { author, genre }
}

/**
 * 按 parseListTitle 拆出的书名归一化分组。同名 ≥2 条合成一组，
 * 单条为 single；空标题一律 single。保留首次出现顺序，组内保持原序。
 * group 项附带 author/genre（组内首个非空值）。
 */
export function groupBooks<T>(
  items: T[],
  getTitle: (item: T) => string,
): GroupedItem<T>[] {
  const displayTitle = new Map<string, string>()
  const buckets = new Map<string, T[]>()
  const singles: Set<number> = new Set()

  items.forEach((item, idx) => {
    const parsed = parseListTitle(getTitle(item))
    const key = normalizeTitleKey(parsed.title)
    if (!key) {
      singles.add(idx)
      return
    }
    if (!buckets.has(key)) {
      displayTitle.set(key, parsed.title || getTitle(item))
      buckets.set(key, [])
    }
    buckets.get(key)!.push(item)
  })

  const result: GroupedItem<T>[] = []
  const emitted = new Set<string>()
  items.forEach((item, idx) => {
    if (singles.has(idx)) {
      result.push({ type: "single", item })
      return
    }
    const parsed = parseListTitle(getTitle(item))
    const key = normalizeTitleKey(parsed.title)
    if (!key) return // 防御：空 key 已在 singles 处理
    if (emitted.has(key)) return
    emitted.add(key)
    const group = buckets.get(key)!
    if (group.length >= 2) {
      const meta = pickHeaderMeta(group, getTitle)
      result.push({
        type: "group",
        key,
        title: displayTitle.get(key)!,
        items: group,
        author: meta.author,
        genre: meta.genre,
      })
    } else {
      result.push({ type: "single", item: group[0]! })
    }
  })
  return result
}

/**
 * Me 列表（历史/收藏/标签）专用分组：
 * 仅 kind === "post" && site === "1" 的项参与分组，其余直通 single。
 * 所有符合条件的 post 共享同一套书名桶（全局，非连续段），
 * 再按原始数组顺序 walk 去重发射，保持原序 interleave。
 */
export function groupMeListItems(
  items: MeListItem[],
): GroupedItem<MeListItem>[] {
  const eligible = (it: MeListItem) => it.kind === "post" && it.site === "1"

  // 第一遍：对 eligible 项建全局桶
  const buckets = new Map<string, MeListItem[]>()
  const displayTitle = new Map<string, string>()
  for (const it of items) {
    if (!eligible(it)) continue
    const parsed = parseListTitle(it.title)
    const key = normalizeTitleKey(parsed.title)
    if (!key) continue
    if (!buckets.has(key)) {
      displayTitle.set(key, parsed.title || it.title)
      buckets.set(key, [])
    }
    buckets.get(key)!.push(it)
  }

  // 第二遍：原序 walk 去重发射
  const emitted = new Set<string>()
  const result: GroupedItem<MeListItem>[] = []
  for (const it of items) {
    if (!eligible(it)) {
      result.push({ type: "single", item: it })
      continue
    }
    const key = normalizeTitleKey(parseListTitle(it.title).title)
    if (!key) {
      result.push({ type: "single", item: it })
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    const group = buckets.get(key)!
    if (group.length >= 2) {
      const meta = pickHeaderMeta(group, (it) => it.title)
      result.push({
        type: "group",
        key,
        title: displayTitle.get(key)!,
        items: group,
        author: meta.author,
        genre: meta.genre,
      })
    } else {
      result.push({ type: "single", item: group[0]! })
    }
  }
  return result
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/web && bun test src/lib/book-groups.test.ts`
Expected: 8 个 test 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/package.json apps/web/src/lib/book-groups.ts apps/web/src/lib/book-groups.test.ts
git commit -m "feat(web): add book grouping pure functions with tests

normalizeTitleKey / groupBooks / groupMeListItems，按
parseListTitle 拆出的书名归一化分组。给 apps/web 加 bun test 入口。"
```

---

## Task 2: 展开状态持久化 hook

**Files:**
- Create: `apps/web/src/hooks/use-expanded-books.ts`

**Interfaces:**
- Consumes: 无（纯浏览器 API + React）
- Produces: `useExpandedBooks(scope) → { isExpanded, toggle }`——Task 3 和各页面 Task 依赖。

**类型签名：**

```ts
export function useExpandedBooks(scope: string): {
  isExpanded: (bookKey: string) => boolean
  toggle: (bookKey: string) => void
}
```

- [ ] **Step 1: 实现 hook**

创建 `apps/web/src/hooks/use-expanded-books.ts`：

```ts
import { useCallback, useEffect, useState } from "react"

const PREFIX = "purifier:expanded-books:"

function storageKey(scope: string): string {
  return `${PREFIX}${scope}`
}

function readExpanded(scope: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set()
  } catch {
    return new Set()
  }
}

function writeExpanded(scope: string, set: Set<string>) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify([...set]))
  } catch {
    // 隐私模式/配额：静默，内存态仍可切换
  }
}

export function useExpandedBooks(scope: string): {
  isExpanded: (bookKey: string) => boolean
  toggle: (bookKey: string) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // 首屏渲染前 localStorage 未读 → 默认全折叠；mount 后 hydrate
  useEffect(() => {
    setExpanded(readExpanded(scope))
  }, [scope])

  const isExpanded = useCallback(
    (bookKey: string) => expanded.has(bookKey),
    [expanded],
  )

  const toggle = useCallback(
    (bookKey: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(bookKey)) next.delete(bookKey)
        else next.add(bookKey)
        writeExpanded(scope, next)
        return next
      })
    },
    [scope],
  )

  return { isExpanded, toggle }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: PASS（无类型错误）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/use-expanded-books.ts
git commit -m "feat(web): add useExpandedBooks hook for persisted expand state

页面层单例调用，localStorage 按 scope 隔离，读写 try/catch。"
```

---

## Task 3: 补 IconChevronDown 图标

**Files:**
- Modify: `apps/web/src/components/icons.tsx`（在 `IconChevronRight` 之后，L35 附近插入）

**Interfaces:**
- Produces: `IconChevronDown`——Task 4 的组件依赖。

- [ ] **Step 1: 添加图标**

在 `apps/web/src/components/icons.tsx` 的 `IconChevronRight` 函数（L29-35）之后插入：

```tsx
export function IconChevronDown({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/icons.tsx
git commit -m "feat(web): add IconChevronDown icon"
```

---

## Task 4: CollapsibleBookGroup 组件

**Files:**
- Create: `apps/web/src/components/collapsible-book-group.tsx`

**Interfaces:**
- Consumes: `IconChevronDown` from Task 3、`IconBookOpen` from `@/components/icons`（已有）、`cn` from `@workspace/ui/lib/utils`。
- Produces: `<CollapsibleBookGroup>`——各页面 Task（6-11）依赖。

**Props 签名（后续 Task 精确引用）：**

```ts
function CollapsibleBookGroup({
  title,       // string  书名
  summary,     // string  头部副标题（作者等）
  count,       // number  章节数
  bookKey,     // string  归一化 key（用于 isExpanded 查询 + 列表 key）
  isExpanded,  // boolean 当前组是否展开
  onToggle,    // () => void  切换展开
  trailing,    // ReactNode  可选右侧元素（题材胶囊）
  children,    // ReactNode  展开后的各章卡片
}: { ... })
```

> 注意：`isExpanded` 是布尔值（页面层用 `isExpanded(bookKey)` 算好传入），`onToggle` 无参（页面层用 `() => toggle(bookKey)` 绑好传入）。组件本身不持有 scope / bookKey 的查询逻辑。

- [ ] **Step 1: 实现组件**

创建 `apps/web/src/components/collapsible-book-group.tsx`：

```tsx
import { type ReactNode, useId } from "react"
import { IconBookOpen, IconChevronDown } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

export function CollapsibleBookGroup({
  title,
  summary,
  count,
  bookKey,
  isExpanded,
  onToggle,
  trailing,
  children,
}: {
  title: string
  summary?: string
  count: number
  bookKey: string
  isExpanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  children: ReactNode
}) {
  // bookKey 用于稳定 contentId 前缀（a11y 关联），useId 保证唯一性
  const contentId = `book-content-${useId()}`
  void bookKey // 父级用作 React key；此处保留以便未来扩展（如稳定 id）
  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left sm:gap-3.5 sm:px-4 sm:py-4"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconBookOpen size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
            {title}
          </span>
          {summary && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        {trailing}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          共 {count} 章
        </span>
        <IconChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground/50 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
        />
      </button>
      {isExpanded && (
        <div
          id={contentId}
          role="region"
          className="flex flex-col gap-2 px-3.5 pb-3.5 opacity-100 transition-opacity duration-150 sm:gap-2.5 sm:px-4 sm:pb-4"
        >
          {children}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

> 说明：展开用 `opacity-100 transition-opacity`（Tailwind 内置，不依赖 animate 插件）。无进入动画（条件渲染即出现），求稳。`bookKey` 在组件体内用 `void` 标注避免未使用告警——它真正的用途是父级 `key={\`group:${g.key}\`}`；保留 prop 以备将来用 bookKey 做 contentId 后缀（如跨实例稳定）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/collapsible-book-group.tsx
git commit -m "feat(web): add CollapsibleBookGroup component

默认折叠，点击头部展开，展开状态经 props 传入（不读写 localStorage）。
a11y: aria-expanded + aria-controls。"
```

---

## Task 5: MeItemCard 支持 titleOverride/subtitleOverride

**Files:**
- Modify: `apps/web/src/components/me-item-card.tsx`

**Interfaces:**
- Consumes: 无新依赖
- Produces: `MeItemCard` 新增可选 props——Task 8（Me 列表接入）依赖。

**背景：** `MeItemCard` 原样展示 `item.title`（完整 `【书名】（第N章）作者…`）。组内子卡若也这样显示，与组头书名重复。给组内子卡传入解析后的 `chapters`/作者做主/副标题。

- [ ] **Step 1: 加可选 props**

编辑 `apps/web/src/components/me-item-card.tsx`，把 `MeItemCard` 的 props 类型（L27-33）改为：

```tsx
export function MeItemCard({
  item,
  trailing,
  titleOverride,
  subtitleOverride,
}: {
  item: MeListItem
  trailing?: ReactNode
  /** 覆盖主标题（如组内子卡用解析后的章节信息） */
  titleOverride?: string
  /** 覆盖副标题 */
  subtitleOverride?: string
}) {
```

- [ ] **Step 2: 在渲染处使用 override**

把渲染标题的两处（L54-55 的主标题、L57-66 的副标题区域）改为：

```tsx
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {titleOverride ?? item.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {subtitleOverride != null ? (
                <>
                  {subtitleOverride}
                  {time != null && <> · {formatDateTime(time)}</>}
                  {" · "}
                  {item.visit_count} 次访问
                </>
              ) : (
                <>
                  {time != null && <>{formatDateTime(time)} · </>}
                  {item.visit_count} 次访问
                  {typeof item.read_progress === "number" &&
                    item.read_progress > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground/70">
                        · 已读 {Math.round(item.read_progress * 100)}%
                      </span>
                    )}
                </>
              )}
            </span>
          </span>
```

> 原文件 L53-66 是一个 `<span className="flex min-w-0 flex-1 flex-col gap-0.5">` 包裹的两段。用上面整段替换它（从 `<span className="flex min-w-0 flex-1 flex-col gap-0.5">` 到对应 `</span>` 闭合）。

- [ ] **Step 3: 类型检查**

Run: `cd apps/web && bun run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/me-item-card.tsx
git commit -m "feat(web): MeItemCard support titleOverride/subtitleOverride props

供同书折叠组内子卡使用解析后的章节/作者，避免与组头书名重复。"
```

---

## Task 6: 首页 HomePage 接入分组

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `groupBooks`、`GroupedItem` from Task 1；`useExpandedBooks` from Task 2；`CollapsibleBookGroup` from Task 4；`ListPostCard`（已有）。
- Produces: 首页分组渲染（无限滚动累积数组）。

**背景：** 首页是唯一无限滚动页。`links` 跨 `loadMore` 批次累积，分组在 `useMemo([links, site])` 上做。`site !== "1"` 短路为全 single。计数文案保持 `links.length`（帖数）。

- [ ] **Step 1: 加 imports + hook + useMemo**

在 `apps/web/src/pages/HomePage.tsx` 顶部 imports 加：

```tsx
import { useMemo } from "react"  // 合并到已有 react import
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
```

> `useMemo` 合并进 L1 的 `import { useCallback, useEffect, useRef, useState } from "react"`，加 `useMemo`。

在 `HomePage` 函数内（`useSite()` 之后，约 L23）加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("home")
const grouped = useMemo(() => {
  if (site !== "1") {
    return links.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(links, (l) => l.title)
}, [links, site])
```

- [ ] **Step 2: 替换列表渲染**

把 L137-150 的 `<PostList>{links.map(...)}</PostList>` 替换为：

```tsx
        <PostList>
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
              >
                {g.items.map((link) => (
                  <ListPostCard
                    key={link.tid}
                    href={readPath(link.tid, site)}
                    rawTitle={link.title}
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            ),
          )}
        </PostList>
```

> 组内各章都用 `readPath(link.tid, site)`。头部不显 rank（首页无 rank）。`summary` 传组头作者、`trailing` 传 `GenrePill` 题材胶囊（来自 `groupBooks` 聚合的 `g.author`/`g.genre`）。

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 4: 手动验证（可选但推荐）**

`bun run dev:web`，打开首页（site=1），观察同名书多章是否折成一组；点击展开各章；刷新后展开态保留；切到 site=2（书库）应全 single。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/HomePage.tsx
git commit -m "feat(web): fold same-book chapters on home timeline

首页无限滚动累积数组上 useMemo 分组，site !== '1' 短路全 single。"
```

---

## Task 7: Browse / Search 接入分组（分页页）

**Files:**
- Modify: `apps/web/src/pages/BrowsePage.tsx`
- Modify: `apps/web/src/pages/SearchPage.tsx`

**Interfaces:**
- Consumes: 同 Task 6。
- Produces: 分类/搜索页分组渲染（仅当前页）。

**背景：** Browse 和 Search 都是分页（每页替换 `links`）。分组仅在当前页数组内，跨页不合并。两者结构几乎相同（都是 `BrowseContent`/`SearchContent` 内 `links.map` → `<ListPostCard>`）。

- [ ] **Step 1: BrowsePage 接入**

在 `apps/web/src/pages/BrowsePage.tsx`：

1. L1 react import 加 `useMemo`。
2. 顶部加 imports：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
```

3. `BrowseContent` 函数内（`useSite()` 之后）加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("browse")
const grouped = useMemo(() => {
  if (site !== "1") {
    return links.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(links, (l) => l.title)
}, [links, site])
```

4. 把 L119-132 的 `<PostList>{links.map(...)}</PostList>` 替换为：

```tsx
          <PostList>
            {grouped.map((g) =>
              g.type === "single" ? (
                <ListPostCard
                  key={g.item.tid}
                  href={
                    site === "2"
                      ? bookPath(g.item.tid, { site })
                      : readPath(g.item.tid, site)
                  }
                  rawTitle={g.item.title}
                  showGenre
                />
              ) : (
                <CollapsibleBookGroup
                  key={`group:${g.key}`}
                  title={g.title}
                  summary={g.author ?? undefined}
                  count={g.items.length}
                  bookKey={g.key}
                  isExpanded={isExpanded(g.key)}
                  onToggle={() => toggle(g.key)}
                  trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                >
                  {g.items.map((link) => (
                    <ListPostCard
                      key={link.tid}
                      href={readPath(link.tid, site)}
                      rawTitle={link.title}
                      showGenre
                    />
                  ))}
                </CollapsibleBookGroup>
              ),
            )}
          </PostList>
```

- [ ] **Step 2: SearchPage 接入**

在 `apps/web/src/pages/SearchPage.tsx` 做相同模式的改动（scope 改为 `"search"`）：

1. L1 react import 加 `useMemo`。
2. 顶部加同样的 4 个 imports（含 `GenrePill`）。
3. `SearchContent` 函数内（`useSite()` 之后）加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("search")
const grouped = useMemo(() => {
  if (site !== "1") {
    return links.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(links, (l) => l.title)
}, [links, site])
```

4. 把 L143-156 的 `<PostList>{links.map(...)}</PostList>` 替换为与 Browse 完全相同的 grouped 渲染块（含 `summary`/`trailing`，scope 不同但渲染代码一致）。

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/BrowsePage.tsx apps/web/src/pages/SearchPage.tsx
git commit -m "feat(web): fold same-book chapters on browse/search pages

分页页仅当前页内分组，跨页不合并；site !== '1' 短路。"
```

---

## Task 8: MeListPage 接入分组（历史/收藏/标签共用）

**Files:**
- Modify: `apps/web/src/components/me-list-page.tsx`
- Modify: `apps/web/src/pages/HistoryPage.tsx`
- Modify: `apps/web/src/pages/FavoritesPage.tsx`
- Modify: `apps/web/src/pages/TagsPage.tsx`

**Interfaces:**
- Consumes: `groupMeListItems` from Task 1；`useExpandedBooks` from Task 2；`CollapsibleBookGroup` from Task 4；`MeItemCard` 新 props from Task 5。
- Produces: Me 三页共用分组，各自传 scope。

**背景：** 三个页面都不渲染列表，列表在 `MeListPage`（L164-172 `items.map` → `<MeItemCard>`）。`MeListPage` 加可选 `bookGroupScope` prop：传入则分组，不传保持原样。Me 列表是分页，仅当前页内分组。

**关键：组内 MeItemCard 用 `parseListTitle` 拆出的 `chapters`/作者做 titleOverride/subtitleOverride，避免与组头书名重复。组内项也要保留 `renderTrailing`（删除/取消收藏按钮）。**

- [ ] **Step 1: MeListPage 加 prop + 分组**

编辑 `apps/web/src/components/me-list-page.tsx`：

1. L1-3 的 react import 加 `useMemo`（L1 已有 `useMemo`，确认存在；若无则加）。
2. 顶部加 imports：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupMeListItems } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
```

3. `MeListPage` 的 props 类型（L16-38）加一项：

```tsx
  emptyText?: string
  /** 传入则启用同书折叠分组（值为 scope，如 'history'/'favorites'/'me-items'） */
  bookGroupScope?: string
}) {
```

并在函数签名解构里加 `bookGroupScope`（L16 的解构 `title, description, buildUrl, pick, renderTrailing, toolbar, emptyText` 末尾加 `, bookGroupScope`）。

4. 在 `reload` 等 hook 之后（约 L77 后、`update` 函数前）加：

```tsx
  const { isExpanded, toggle } = useExpandedBooks(bookGroupScope ?? "__noop__")
  const grouped = useMemo(() => {
    if (!bookGroupScope) return null
    return groupMeListItems(items)
  }, [items, bookGroupScope])
```

5. 把 L164-172 的 `<PostList>{items.map(...)}</PostList>` 替换为：

```tsx
        <PostList>
          {(grouped ?? items.map((item) => ({ type: "single" as const, item }))).map(
            (g) =>
              g.type === "single" ? (
                <MeItemCard
                  key={`${g.item.kind}:${g.item.id}`}
                  item={g.item}
                  trailing={renderTrailing?.(g.item, reload)}
                />
              ) : (
                <CollapsibleBookGroup
                  key={`group:${g.key}`}
                  title={g.title}
                  summary={g.author ?? undefined}
                  count={g.items.length}
                  bookKey={g.key}
                  isExpanded={isExpanded(g.key)}
                  onToggle={() => toggle(g.key)}
                  trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                >
                  {g.items.map((item) => {
                    const parsed = parseListTitle(item.title)
                    // 组内主标题用章节号；副标题用 formatTitleMeta（作者/题材）+
                    // 进度（保留，避免信息丢失）。时间/访问次数由组级上下文决定。
                    const sub = formatTitleMeta(parsed)
                    const subWithProgress =
                      (sub ? `${sub}` : "") +
                      (typeof item.read_progress === "number" &&
                      item.read_progress > 0
                        ? `${sub ? " · " : ""}已读 ${Math.round(item.read_progress * 100)}%`
                        : "")
                    return (
                      <MeItemCard
                        key={`${item.kind}:${item.id}`}
                        item={item}
                        trailing={renderTrailing?.(item, reload)}
                        titleOverride={parsed.chapters || undefined}
                        subtitleOverride={subWithProgress || undefined}
                      />
                    )
                  })}
                </CollapsibleBookGroup>
              ),
          )}
        </PostList>
```

> 组内 `titleOverride` 用解析后的章节号（如 "1-2"）作主标题；`subtitleOverride` 用 `formatTitleMeta`（作者/题材）拼上进度。若解析无章节，titleOverride 为 undefined → 回退显示 `item.title`。时间/访问次数在 override 模式下省略（组级上下文已足够）。

- [ ] **Step 2: HistoryPage 传 scope**

编辑 `apps/web/src/pages/HistoryPage.tsx`，在 `<MeListPage>` 调用（L126-135）里加一行 prop：

```tsx
    <MeListPage
      title="浏览历史"
      description="最近访问的贴子与书库"
      bookGroupScope="history"
      buildUrl={(q, kind, page) =>
        `${api.meHistory}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
      toolbar={toolbar}
    />
```

- [ ] **Step 3: FavoritesPage 传 scope**

编辑 `apps/web/src/pages/FavoritesPage.tsx`，在 `<MeListPage>` 调用（L46-55）里加：

```tsx
    <MeListPage
      title="收藏"
      description="收藏的贴子与书库"
      bookGroupScope="favorites"
      buildUrl={(q, kind, page) =>
        `${api.meFavorites}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
    />
```

- [ ] **Step 4: TagsPage 传 scope**

编辑 `apps/web/src/pages/TagsPage.tsx` 的 `TagItemsView`（L140-149 的 `<MeListPage>`）加：

```tsx
  return (
    <MeListPage
      title={`#${tag}`}
      description="该标签下的贴子与书库"
      bookGroupScope="me-items"
      buildUrl={(q, kind, page) => {
        const params = meListQuery({ q, kind, page })
        const query = params ? `&${params}` : ""
        return `${api.meItems}?tag=${encodeURIComponent(tag)}${query}`
      }}
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
    />
  )
```

> `TagListView`（标签云）不变，只有 `TagItemsView`（标签筛选列表）需要 scope。

- [ ] **Step 5: 类型检查 + 构建 + 测试**

Run: `cd apps/web && bun run typecheck && bun run build && bun test`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/me-list-page.tsx apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/FavoritesPage.tsx apps/web/src/pages/TagsPage.tsx
git commit -m "feat(web): fold same-book chapters in history/favorites/tags

MeListPage 加 bookGroupScope prop，三页共用分组；组内 MeItemCard
用解析后章节/作者避免与组头重复；trailing（删除/取消收藏）随组内项保留。"
```

---

## Task 9: 榜单页（Trending / Comments）接入分组

**Files:**
- Modify: `apps/web/src/pages/TrendingPage.tsx`
- Modify: `apps/web/src/pages/CommentsPage.tsx`

**Interfaces:**
- Consumes: 同 Task 6。
- Produces: 榜单页分组渲染。

**背景：** 榜单页是单次拉取（`useAsyncList`）。**Trending 的 `sites: ["1","2"]`，href 是 `site === "2" ? bookPath : readPath` 分支**——必须保留，否则 site=2 链接退回帖子路径（回归）。Comments 导航仅 `sites:["1"]`，href 无 site 分支。两者都加 `site !== "1"` 短路（防 site=2 数据被误折）。组内各帖保留各自 `rank`；折叠头部**不显示单个 rank**。

- [ ] **Step 1: TrendingPage 接入**

编辑 `apps/web/src/pages/TrendingPage.tsx`：

1. L1 react import 加 `useMemo`。
2. 顶部加 imports：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
```

> `useSite` 与 `site` 原文件 L7/L19 已有（用于 `useAsyncList` URL），直接复用，无需新 import。

3. `TrendingPage` 函数内（`useAsyncList` 之后）加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("trending")
const grouped = useMemo(() => {
  if (site !== "1") {
    return items.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(items, (p) => p.title)
}, [items, site])
```

4. 把 L43-59 的 `<PostList>{items.map(...)}</PostList>` 替换为（**保留 site 分支 href**）：

```tsx
        <PostList>
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                rank={g.item.rank}
                statValue={formatCount(g.item.reads)}
                statUnit="读"
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
              >
                {g.items.map((post) => (
                  <ListPostCard
                    key={post.tid}
                    href={
                      site === "2"
                        ? bookPath(post.tid, { site })
                        : readPath(post.tid, site)
                    }
                    rawTitle={post.title}
                    rank={post.rank}
                    statValue={formatCount(post.reads)}
                    statUnit="读"
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            ),
          )}
        </PostList>
```

- [ ] **Step 2: CommentsPage 接入**

编辑 `apps/web/src/pages/CommentsPage.tsx`，同模式（scope `"comments"`，字段是 `comments`/`"评"`）：

1. L1 react import 加 `useMemo`。
2. 顶部加 imports（Comments 原本无 `useSite`，需补）：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
```

3. `CommentsPage` 函数内（原 L17 `useAsyncList` 之前）加 `const site = useSite()`，之后加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("comments")
const grouped = useMemo(() => {
  if (site !== "1") {
    return items.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(items, (p) => p.title)
}, [items, site])
```

4. 把 L41-53 的 `<PostList>{items.map(...)}</PostList>` 替换为（Comments 原本 `readPath(post.tid)` 无 site，保持原样无 site 分支）：

```tsx
        <PostList>
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
                rank={g.item.rank}
                statValue={formatCount(g.item.comments)}
                statUnit="评"
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
              >
                {g.items.map((post) => (
                  <ListPostCard
                    key={post.tid}
                    href={readPath(post.tid)}
                    rawTitle={post.title}
                    rank={post.rank}
                    statValue={formatCount(post.comments)}
                    statUnit="评"
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            ),
          )}
        </PostList>
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/TrendingPage.tsx apps/web/src/pages/CommentsPage.tsx
git commit -m "feat(web): fold same-book chapters on trending/comments

榜单组内保留各自 rank；折叠头部不显单个 rank；site !== '1' 短路。"
```

---

## Task 10: Featured 接入分组

**Files:**
- Modify: `apps/web/src/pages/FeaturedPage.tsx`

**Interfaces:**
- Consumes: 同 Task 6。
- Produces: 精华页分组渲染。

**背景：** Featured 是单次拉取（`useAsyncList`），用 `index` prop。`readPath(link.tid)` 不传 site，精华页 NAV `sites: ["1"]`，是 cool18 专属，无需 site 短路（但为统一仍可加——featured 数据只来自 cool18，加不加都行；为简洁不加短路，因为 `api.featured` 无 site 参数）。

- [ ] **Step 1: 接入**

编辑 `apps/web/src/pages/FeaturedPage.tsx`：

1. L1 react import 加 `useMemo`（原 L1 无 react import——原文件 L1 直接是 `import { PageHeader }`。需新加 `import { useMemo } from "react"`）。
2. 顶部加 imports：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
```

3. `FeaturedPage` 函数内（`useAsyncList` 之后）加：

```tsx
const { isExpanded, toggle } = useExpandedBooks("featured")
const grouped = useMemo(() => groupBooks(items, (l) => l.title), [items])
// 原始 items 下标查找（用于 single 项的 index 兜底，避免 grouped 下标跳变）
const indexOfItem = useMemo(() => {
  const m = new Map<string, number>()
  items.forEach((it, i) => m.set(it.tid, i + 1))
  return m
}, [items])
```

4. 把 L39-49 的 `<PostList>{items.map(...)}</PostList>` 替换为：

```tsx
        <PostList>
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
                index={g.item.index || indexOfItem.get(g.item.tid) || 1}
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
              >
                {g.items.map((link) => (
                  <ListPostCard
                    key={link.tid}
                    href={readPath(link.tid)}
                    rawTitle={link.title}
                    index={link.index}
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            ),
          )}
        </PostList>
```

> single 项用 `g.item.index || indexOfItem.get(tid) || 1`（原始 items 下标兜底，**不用 grouped 下标** `gi`——折叠后序号会跳变）。组内项用各自的 `link.index`（可能为 0/undefined，组内不强制）。

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/FeaturedPage.tsx
git commit -m "feat(web): fold same-book chapters on featured page"
```

---

## Task 11: PicksSections 接入分组（仅非 chip 路径）

**Files:**
- Modify: `apps/web/src/components/picks-sections.tsx`

**Interfaces:**
- Consumes: 同 Task 6。
- Produces: 扫文推荐分组渲染。

**背景：** `PicksSections` 对每个 `PickSection` 有两条路径：`sectionUsesChips` 为真 → chip 网格（保持原样）；否则 → `PostList` 路径用 `PostCard`（**注意：原 PostList 路径用的是 `PostCard`，不是 `ListPostCard`，见 L111-118**）。仅在 PostList 路径做分组。Picks 的 `readPath(link.tid)` 无 site，默认按 cool18 处理。

**关键差异：Picks 的 PostList 路径原本用 `PostCard`（不解析标题、无副标题）。分组后，组头仍可展示书名（来自 `parseListTitle`），但组内子卡若继续用 `PostCard` 会显示完整原始标题（信息冗余但可接受，与 Me 路径处理不同——这里为最小改动，组内仍用 `PostCard` 显示原始标题）。**

- [ ] **Step 1: 接入**

编辑 `apps/web/src/components/picks-sections.tsx`：

1. L1-4 react/router import 区加 `useMemo`（原 L1 是 `import { Link } from "react-router-dom"`；在文件顶部新加 `import { useMemo } from "react"`）。
2. 顶部加 imports：

```tsx
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
```

3. `PicksSections` 函数签名（L73）改为：

```tsx
export function PicksSections({ sections }: { sections: PickSection[] }) {
  const { isExpanded, toggle } = useExpandedBooks("picks")
  return (
```

4. 把 L110-119 的 PostList 分支（else 分支）替换为：

```tsx
            ) : (
              <PostList>
                {(() => {
                  const grouped = groupBooks(section.links, (l) => l.title)
                  return grouped.map((g) =>
                    g.type === "single" ? (
                      <PostCard
                        key={g.item.tid}
                        href={readPath(g.item.tid)}
                        title={g.item.title}
                      />
                    ) : (
                      <CollapsibleBookGroup
                        key={`group:${g.key}`}
                        title={g.title}
                        summary={g.author ?? undefined}
                        count={g.items.length}
                        bookKey={g.key}
                        isExpanded={isExpanded(g.key)}
                        onToggle={() => toggle(g.key)}
                        trailing={
                          g.genre ? <GenrePill genre={g.genre} /> : undefined
                        }
                      >
                        {g.items.map((link) => (
                          <PostCard
                            key={link.tid}
                            href={readPath(link.tid)}
                            title={link.title}
                          />
                        ))}
                      </CollapsibleBookGroup>
                    ),
                  )
                })()}
              </PostList>
            )}
```

> 组内仍用 `PostCard` 显示完整原始标题（与 Me 路径的 titleOverride 不对称，YAGNI 可接受——Picks 原本就是 `PostCard` 不解析标题）。用 IIFE 是因为要在 JSX 分支内调 `groupBooks`。

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd apps/web && bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/picks-sections.tsx
git commit -m "feat(web): fold same-book chapters in Picks (PostList path only)

chip 路径保持原样；仅非 chip 的 PostList 路径分组。"
```

---

## Task 12: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 全仓类型检查 + 构建 + 测试**

Run: `bun run typecheck && bun run build && bun run test`
Expected: 全部 PASS，无类型错误，无构建失败，6+ 个单测通过。

- [ ] **Step 2: Prettier 格式化检查**

Run: `bun run format`（或 `npx prettier --check "apps/web/src/**/*.{ts,tsx}"`）
Expected: 无格式错误。若有，运行 `bun run format` 修复后重新提交。

- [ ] **Step 3: 手动验证清单（开发服务器）**

`bun run dev`，逐项核对：

- [ ] 首页（site=1）：同名书两章分属不同加载批次 → 折成一组；点开展开各章；刷新记住展开
- [ ] 分类浏览：同书两章在同一页 → 折叠；翻页后各页独立
- [ ] 搜索：同分类浏览
- [ ] 精华：同名折叠，组内各章带 index
- [ ] 扫文推荐：非 chip 区块同名折叠；chip 区块不受影响
- [ ] 人气榜/评论榜：折叠态头部不显 rank；展开后各章带 rank
- [ ] 历史：cool18 post 同名折叠；xbookcn book 不参与；组内子卡标题不与组头重复；删除按钮随组内项保留
- [ ] 收藏：同历史
- [ ] 标签筛选：同历史
- [ ] 换站 site=2：所有列表无折叠（全 single）
- [ ] 持久化隔离：首页展开的书，切到分类页仍默认折叠

- [ ] **Step 4: 最终提交（若有格式修复）**

```bash
git add -A
git commit -m "style: prettier formatting for book folding"
```

若无格式改动，跳过此步。

---

## Self-Review 记录

写完计划后逐项核对 spec：

**Spec 覆盖：**
- §3 分组判定 → Task 1（`groupBooks`/`normalizeTitleKey` + 边界测试）✓
- §4 数据流 → Task 1 + 各页面 Task 的 `useMemo` 接入 ✓
- §5 UI 组件 → Task 4（CollapsibleBookGroup）+ Task 5（MeItemCard override）+ Task 3（Icon）✓
- §6 持久化 → Task 2（useExpandedBooks，单例 + try/catch + scope）✓
- §7 各页面 → Task 6（首页）、Task 7（Browse/Search）、Task 8（MeListPage 三页）、Task 9（榜单）、Task 10（Featured）、Task 11（Picks）✓
- §8 边界 → Task 1 测试覆盖空标题/单条/多组；各页面 site 短路；分页跨页不合并在 Task 7 注明 ✓
- §9 测试 → Task 1（单测）+ Task 12（全量验证）✓
- §10 改动清单 → 4 新增 + 13 修改，全部对应 Task ✓

**类型一致性：** `GroupedItem<T>` 在 Task 1 定义，后续所有 Task 用 `g.type === "single"` / `g.type === "group"` 判别，`g.item` / `g.{key,title,items,author,genre}` 字段名全程一致 ✓。`CollapsibleBookGroup` props（Task 4）在 Task 6-11 全部用相同签名（`title/summary/count/bookKey/isExpanded/onToggle/trailing/children`）✓。`useExpandedBooks` 返回 `{ isExpanded, toggle }`（Task 2）在所有页面 Task 一致 ✓。

**无占位符：** 所有步骤含具体代码块、具体文件路径、具体行号区间。无 TBD/TODO/"类似 Task N"。Task 11 的 IIFE 用法有完整代码示例 ✓。

**Review 修订记录（v2）：** 据计划评审 `review.md` 修订：
- Critical 1：`groupMeListItems` 从"连续 post 段分段"改为"全局 post 桶 + 原序 walk"，同名 post 被 book 隔开仍合成一组；补对应单测。
- Critical 2：`groupMeListItems` 过滤加 `site === "1"`，补 site=2 post 直通 single 单测。
- Important 3：Task 9 Trending 恢复 `site === "2" ? bookPath : readPath` href 分支，避免 site=2 链接退回帖子路径。
- Important 4：`groupBooks`/`groupMeListItems` 的 group 项聚合 `author`/`genre`，各页 CollapsibleBookGroup 接线 `summary`（作者）+ `trailing`（GenrePill 题材胶囊），与 design §5 一致。
- Suggestion 5：单测计数 6 → 8。
- Suggestion 6：`CollapsibleBookGroup` 的 `bookKey` 用 `void` 标注避免未使用告警，contentId 前缀稳定。
- Suggestion 7：Featured single 项 index 用原始 items 下标（`indexOfItem` Map），不用 grouped 下标 `gi`。
- Suggestion 8：Task 9 删除"无需 site 短路"矛盾段落，统一为加 site 短路。
- Suggestion 9：展开动画从 `animate-in fade-in` 改为 `opacity-100 transition-opacity`，不依赖 animate 插件。
- Suggestion 10：Me 组内 `subtitleOverride` 保留阅读进度。
