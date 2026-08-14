# 跨站合并搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搜索页去掉论坛/书库 Tab，一个搜索框同时搜两站，结果合并成一条带来源标签、每页按标题排序的列表。

**Architecture:** 新增 `GET /api/search`，服务端按 `SITES` 注册表并行抓两站 `fetchCategoryPage({keywords}, page)`，纯函数 `mergeSearchPages` 合并排序；前端 `SearchPage` 去掉 `PageSiteTabs`，经 `toMeListItems` 映射后复用现有 `groupMeListItems` 渲染（论坛折叠组 + 书库单条 + `SourceBadge` 来源标签）。前置：把 web 完整版 `parseListTitle` 收拢进 core，保证服务端排序键与前端分组键同源。

**Tech Stack:** Bun（`Bun.serve` API + `bun test`）、Vite + React 19、Cheerio、`Intl.Collator`。

## Global Constraints

- TypeScript `strict`；代码风格 Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 跨包导入用 `@workspace/core/...`（子路径见 core `package.json` exports）；前端页面内用 `@/` 别名。
- 不新增依赖；不引入 HTTP 框架。
- 测试用 `bun test`；apps/api 无测试基建，API 逻辑靠 core 纯函数单测 + dev 手测（仓库惯例）。
- `link.title` 是上游原始标题，展示/分组/排序前必须经 `parseListTitle`。
- `docs/superpowers/specs/review.md` 是评审草稿，**永不提交**（`git add` 只加计划涉及文件）。
- 每个任务结束必须提交；提交信息按仓库现有风格（`docs:` / `feat:` / `refactor:`）。

---

### Task 1: 标题解析管线收拢到 core

把 web 完整版 `parseListTitle` 与 `normalizeTitleKey` 收进 core，使服务端排序键与前端分组键同源。

**Files:**
- Modify: `packages/core/src/title-parse.ts`（整体替换为 web 版 + 追加 normalize 函数）
- Modify: `packages/core/package.json`（exports 加 `./title-parse`）
- Modify: `apps/web/src/lib/title-parse.ts`（改为 re-export）
- Modify: `apps/web/src/lib/book-groups.ts:15-41`（删本地 normalize 定义，改从 core 导入并 re-export）
- Modify: `packages/core/src/jobs/handlers/archive_auto_group.ts:7-17`（删本地两份拷贝，改导入）
- Test: `apps/web/src/lib/title-parse.test.ts`、`apps/web/src/lib/book-groups.test.ts`、`packages/core/src/jobs/handlers/archive_auto_group.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `@workspace/core/title-parse` 导出 `parseListTitle`、`formatTitleMeta`、`parseFeaturedTitle`（deprecated）、`normalizeTitleKey`、`stripTrailingChapterMarker`、`type ParsedTitle`。web `@/lib/title-parse` 与 `@/lib/book-groups` 保持同 API 再导出。

- [ ] **Step 1: 把 web 版 parseListTitle 整段覆盖到 core**

```bash
cp apps/web/src/lib/title-parse.ts packages/core/src/title-parse.ts
```

运行：`diff apps/web/src/lib/title-parse.ts packages/core/src/title-parse.ts`
期望：无输出（文件完全一致；core 旧简版被整体丢弃，两者导出名相同：`ParsedTitle` / `parseListTitle` / `parseFeaturedTitle` / `formatTitleMeta`）。

- [ ] **Step 2: 向 core title-parse.ts 追加 normalize 函数（从 web book-groups.ts:15-40 原样移入，含 docstring）**

在 `packages/core/src/title-parse.ts` 末尾追加：

```ts
/**
 * 剥掉尾随的（…）章节/卷标记（与 title-parse 识别范围一致，≤24 字）。
 * parseListTitle 在「作者跟在章节号后」或单字书名（<2 字）时会把尾随的
 * 章节号留在 title 里（如「马屌少年（2）作者：小明」→「马屌少年（2）」、
 * 「马屌少年（完）作者：小明」→「马屌少年（完）」）。解析出的 title 里
 * 尾随（…）按构造都是章节/卷标记（作者已被拆出），这里一并剥掉：
 * key 侧保证同名不同章落入同一桶，组头侧保证显示干净书名。
 */
export function stripTrailingChapterMarker(title: string): string {
  return title.replace(/(?:[（(][^）)]{1,24}[）)]\s*)+$/, "")
}

export function normalizeTitleKey(title: string): string {
  return stripTrailingChapterMarker(
    title.replace(/^[「《【〖［[]+|[」》】〗］\]]+$/g, "")
  )
    .trim()
    .toLowerCase()
}
```

- [ ] **Step 3: core package.json 增加子路径导出**

`packages/core/package.json` 的 `exports` 对象中 `"./extractor": "./src/extractor/index.ts",` 之后加一行：

```json
    "./title-parse": "./src/title-parse.ts",
```

- [ ] **Step 4: web title-parse.ts 改为 re-export**

`apps/web/src/lib/title-parse.ts` 整个文件替换为：

```ts
export * from "@workspace/core/title-parse"
```

- [ ] **Step 5: web book-groups.ts 删本地定义、从 core 导入并 re-export**

把 `apps/web/src/lib/book-groups.ts:15-41` 的两个函数定义（`stripTrailingChapterMarker` + `normalizeTitleKey`，含 docstring）删除，文件顶部 import 改为：

```ts
import {
  normalizeTitleKey,
  parseListTitle,
  stripTrailingChapterMarker,
} from "@workspace/core/title-parse"
```

文件末尾追加 re-export（`groups.ts:1-5` 仍从 `@/lib/book-groups` 导入这两个名字）：

```ts
export { normalizeTitleKey, stripTrailingChapterMarker }
```

- [ ] **Step 6: archive_auto_group.ts 删本地拷贝、改导入**

`packages/core/src/jobs/handlers/archive_auto_group.ts:7-17` 删除两个本地函数（`stripTrailingChapterMarker` + `normalizeTitleKey`），第 3 行 import 改为：

```ts
import { normalizeTitleKey, parseListTitle } from "../../title-parse"
```

- [ ] **Step 7: 跑回归测试 + 类型检查**

```bash
cd apps/web && bun test src/lib/title-parse.test.ts src/lib/book-groups.test.ts
cd ../.. && cd packages/core && bun test src/jobs/handlers/archive_auto_group.test.ts
cd apps/web && bun run typecheck
cd packages/core && bun run typecheck
```

期望：`title-parse.test.ts`（〖〗/作_者/by/贺岁/[小小书童_原创] 全绿，测的是 core 实现）、`book-groups.test.ts`、`archive_auto_group.test.ts` 全部 PASS；两个 typecheck 无错误。
若 `archive_auto_group.test.ts` 有 fixture 因完整 parser 行为变化而失败：diff 失败断言与 `parseListTitle` 新输出，按新输出更新 fixture 期望值（对齐 web 行为），并继续跑通。

- [ ] **Step 8: Commit**

若 Step 7 因 fixture 变化更新过 `packages/core/src/jobs/handlers/archive_auto_group.test.ts`，把它一并加入 commit：

```bash
git add packages/core/src/title-parse.ts packages/core/package.json apps/web/src/lib/title-parse.ts apps/web/src/lib/book-groups.ts packages/core/src/jobs/handlers/archive_auto_group.ts
git commit -m "refactor: unify title parsing pipeline in @workspace/core/title-parse"
```

---

### Task 2: core 合并纯函数 merge-search + 单测

**Files:**
- Create: `packages/core/src/extractor/merge-search.ts`
- Create: `packages/core/src/extractor/merge-search.test.ts`
- Modify: `packages/core/src/extractor/index.ts`（export merge-search）

**Interfaces:**
- Consumes: `parseListTitle` / `normalizeTitleKey`（Task 1 产出）；`CategoryPage` / `ChapterLink`（`./types`）；`SiteId`（`./sites`）。
- Produces:
  - `SITE_KIND: Record<SiteId, "post" | "book">`（`{ "1": "post", "2": "book" }`）
  - `MergedSearchItem { site: SiteId; kind: "post" | "book"; link: ChapterLink }`
  - `MergedSearchPage { items: MergedSearchItem[]; nextPage: number | null; errors?: Record<string, string> }`
  - `searchSortKey(title: string): string`
  - `mergeSearchPages(results: Array<{ site: SiteId; page: CategoryPage | null; error?: string }>): MergedSearchPage`
  - Task 3 消费以上全部；Task 4 消费 `MergedSearchItem` 类型。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/extractor/merge-search.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mergeSearchPages, searchSortKey, SITE_KIND } from "./merge-search"
import type { CategoryPage } from "./types"

function page(
  site: "1" | "2",
  titles: Array<[title: string, tid: string]>,
  nextPage: number | null
): { site: "1" | "2"; page: CategoryPage } {
  return {
    site,
    page: {
      category: "q",
      links: titles.map(([title, tid]) => ({ index: 0, title, tid })),
      nextPage,
    },
  }
}

describe("searchSortKey", () => {
  test("剥外层装饰与作者后缀", () => {
    expect(searchSortKey("【马屌少年】（2）作者：小明『都市』")).toBe("马屌少年")
  })

  test("剥尾随章节标记（完）", () => {
    expect(searchSortKey("马屌少年（完）作者：小明")).toBe("马屌少年")
  })

  test("正文数字保留（第2部 < 第10部，Collator numeric 序）", () => {
    const a = searchSortKey("凡人修仙传第2部")
    const b = searchSortKey("凡人修仙传第10部")
    // key 是归一化字符串，numeric 序是 Collator 的职责，不能对 key 用 `<`
    expect(
      new Intl.Collator("zh", { numeric: true }).compare(a, b)
    ).toBeLessThan(0)
  })
})

describe("mergeSearchPages", () => {
  test("两站合并 + 标题排序 + 平局 site1 在前", () => {
    const r = mergeSearchPages([
      page("1", [["【乙】", "1"]], 2),
      page("2", [["甲", "a"], ["乙", "b"]], 2),
    ])
    expect(r.items.map((i) => i.link.title)).toEqual(["甲", "乙", "乙"])
    expect(r.items[1]!.site).toBe("1") // 同标题稳定序：site1 先于 site2
    expect(r.items[2]!.site).toBe("2")
    expect(r.nextPage).toBe(2)
  })

  test("nextPage 取 OR：一站耗尽另一站还有 → 仍前进", () => {
    const r = mergeSearchPages([page("1", [["A", "1"]], null), page("2", [["B", "2"]], 2)])
    expect(r.nextPage).toBe(2)
  })

  test("跨站同 tid 两条都保留，site 字段区分", () => {
    const r = mergeSearchPages([
      page("1", [["凡人", "12345"]], null),
      page("2", [["凡人", "12345"]], null),
    ])
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => `${i.site}:${i.link.tid}`)).toEqual([
      "1:12345",
      "2:12345",
    ])
  })

  test("单站失败 → errors 透传，另一站结果保留", () => {
    const r = mergeSearchPages([
      page("1", [["A", "1"]], null),
      { site: "2", page: null, error: "upstream error: 502" },
    ])
    expect(r.items).toHaveLength(1)
    expect(r.errors).toEqual({ "2": "upstream error: 502" })
  })

  test("两站全挂 → items 空、errors 两键", () => {
    const r = mergeSearchPages([
      { site: "1", page: null, error: "boom" },
      { site: "2", page: null, error: "bam" },
    ])
    expect(r.items).toEqual([])
    expect(r.errors).toEqual({ "1": "boom", "2": "bam" })
  })

  test("SITE_KIND 映射", () => {
    expect(SITE_KIND).toEqual({ "1": "post", "2": "book" })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/core && bun test src/extractor/merge-search.test.ts
```

期望：FAIL（`Cannot find module './merge-search'`）。

- [ ] **Step 3: 实现 merge-search.ts**

创建 `packages/core/src/extractor/merge-search.ts`：

```ts
import { normalizeTitleKey, parseListTitle } from "../title-parse"
import type { SiteId } from "./sites"
import type { CategoryPage, ChapterLink } from "./types"

/** 站点 → 内容类型；未来加站需补表项（SITES 键序也是排序平局顺序） */
export const SITE_KIND: Record<SiteId, "post" | "book"> = {
  "1": "post",
  "2": "book",
}

export interface MergedSearchItem {
  site: SiteId
  kind: "post" | "book"
  link: ChapterLink
}

export interface MergedSearchPage {
  items: MergedSearchItem[]
  nextPage: number | null
  errors?: Record<string, string>
}

/** 排序键 = 前端分组键同一条管线：normalizeTitleKey(parseListTitle(title).title) */
export function searchSortKey(title: string): string {
  return normalizeTitleKey(parseListTitle(title).title)
}

const collator = new Intl.Collator("zh", { numeric: true })

export function mergeSearchPages(
  results: Array<{ site: SiteId; page: CategoryPage | null; error?: string }>
): MergedSearchPage {
  const items: MergedSearchItem[] = []
  const errors: Record<string, string> = {}
  let nextPage: number | null = null

  for (const r of results) {
    if (r.page) {
      for (const link of r.page.links) {
        items.push({ site: r.site, kind: SITE_KIND[r.site] ?? "post", link })
      }
      if (r.page.nextPage !== null) nextPage = r.page.nextPage
    } else if (r.error) {
      errors[r.site] = r.error
    }
  }

  // 稳定排序：平局保持输入顺序（= SITES 键序，site1 先于 site2）
  items.sort((a, b) =>
    collator.compare(searchSortKey(a.link.title), searchSortKey(b.link.title))
  )

  const out: MergedSearchPage = { items, nextPage }
  if (Object.keys(errors).length > 0) out.errors = errors
  return out
}
```

- [ ] **Step 4: extractor/index.ts 导出 merge-search**

`packages/core/src/extractor/index.ts` 末尾加一行：

```ts
export * from "./merge-search"
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd packages/core && bun test src/extractor/merge-search.test.ts
```

期望：PASS（6 个 test 全绿）。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extractor/merge-search.ts packages/core/src/extractor/merge-search.test.ts packages/core/src/extractor/index.ts
git commit -m "feat: merge-search pure functions (sort key + cross-site merge)"
```

---

### Task 3: API 端点 /api/search

**Files:**
- Modify: `apps/api/src/index.ts`（import 加 `SITES` / `mergeSearchPages` / `type CategoryPage`；`handleBrowse` 之后加 `handleSearch`；路由表加 `case "/api/search"`）

**Interfaces:**
- Consumes: `mergeSearchPages`、`SITE_KIND`（经 `@workspace/core` 根导出，Task 2 产出）；`getListMemCache` / `setListMemCache`（`LIST_MEM_TTL_MS = 45_000` 进程内缓存）；`LIST_CACHE_HEADERS` / `NO_STORE_HEADERS`；`jsonOk` / `jsonError`；`UpstreamTimeoutError` / `ExtractorError`；`resolveSite`；`SITES`。
- Produces: `GET /api/search?q=&page=` → `MergedSearchPage`（`NO_STORE_HEADERS`）。Task 4 的 `toMeListItems` 消费响应形状。

- [ ] **Step 1: 加 import**

`apps/api/src/index.ts` 从 `@workspace/core` 的 import 列表（第 1-56 行大括号内）追加 `SITES,` 和 `mergeSearchPages,`，`type` import 追加 `type CategoryPage,`（已有 `type Extractor` 附近）。

- [ ] **Step 2: 写 handleSearch（放在 handleBrowse 函数之后，约 543 行后）**

```ts
async function handleSearch(url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? ""
  if (!q) return jsonError("missing q parameter", 400)
  if (q.length > 200) return jsonError("q too long", 400)
  const page = Math.max(
    1,
    parseInt(url.searchParams.get("page") || "1", 10) || 1
  )

  // map 返回值 → Promise.all 保序（与 Object.keys(SITES) 同序）；
  // 不要对共享数组 push，完成顺序是竞态，会破坏平局 site1 在前与首错误序
  const results = await Promise.all(
    Object.keys(SITES).map(async (site) => {
      try {
        const cacheKey = `browse:${site}::${q}:${page}`
        const hit = getListMemCache<CategoryPage>(cacheKey)
        if (hit) return { site, page: hit }
        const extractor = resolveSite(site)
        const result = await extractor.fetchCategoryPage(
          { keywords: q },
          page
        )
        setListMemCache(cacheKey, result)
        return { site, page: result }
      } catch (err) {
        return {
          site,
          page: null,
          error: err instanceof Error ? err.message : String(err),
          err,
        }
      }
    })
  )

  const settled = results.map(({ site, page, error }) => ({
    site,
    page,
    error,
  }))
  const failures = results.filter(
    (r): r is {
      site: string
      page: null
      error: string
      err: unknown
    } => !r.page
  )

  if (failures.length === Object.keys(SITES).length) {
    const first = failures[0]!.err
    const status = failures.every(
      (f) => f.err instanceof UpstreamTimeoutError
    )
      ? 504
      : first instanceof ExtractorError
        ? first.statusCode
        : 502
    return jsonError(
      first instanceof Error ? first.message : "search failed",
      status
    )
  }

  // 合并页不进任何共享缓存：半残页（errors）不被 CDN/浏览器钉住
  return jsonOk(mergeSearchPages(settled), NO_STORE_HEADERS)
}
```

- [ ] **Step 3: 注册路由**

`apps/api/src/index.ts` 路由表中 `case "/api/browse":` 块（约 1666-1668 行）之后加：

```ts
      case "/api/search":
        requireGet(req)
        return await handleSearch(url)
```

- [ ] **Step 4: 类型检查 + 编译冒烟**

```bash
cd apps/api && bun run typecheck
```

期望：无错误（`handleSearch` 中 `SITES` / `mergeSearchPages` / `CategoryPage` 均从 `@workspace/core` 解析到）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: add /api/search cross-site merged search endpoint"
```

---

### Task 4: web 合并映射 lib + groupMeListItems 泛型化

**Files:**
- Modify: `apps/web/src/lib/book-groups.ts:121`（`groupMeListItems` 泛型化入参）
- Create: `apps/web/src/lib/merge-search.ts`
- Create: `apps/web/src/lib/merge-search.test.ts`

**Interfaces:**
- Consumes: `MergedSearchItem`（`@workspace/core`，Task 2 产出）；`MeListItem`（`@/components/me-item-card`）；`groupKeyFromTitle`（`@/lib/groups`）；`searchSortKey`（`@workspace/core`）。
- Produces:
  - `groupMeListItems<T extends SearchItem>(items: T[]): GroupedItem<T>[]`（泛型，历史/收藏调用方传 `MeListItem[]` 结果类型不变）
  - `type SearchItem = Pick<MeListItem, "kind" | "site" | "id" | "title">`
  - `toMeListItems(items: MergedSearchItem[]): SearchItem[]`
  - `mergeItemKey(item: { site: string; id: string }): string`（`${site}:${id}`）
  - Task 5 消费全部。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/merge-search.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { searchSortKey } from "@workspace/core"
import { groupKeyFromTitle } from "@/lib/groups"
import { mergeItemKey, toMeListItems } from "@/lib/merge-search"

describe("toMeListItems", () => {
  test("映射 kind/site/id/title", () => {
    const items = toMeListItems([
      { site: "1", kind: "post", link: { index: 1, title: "帖子", tid: "10" } },
      { site: "2", kind: "book", link: { index: 1, title: "书", tid: "20" } },
    ])
    expect(items).toEqual([
      { kind: "post", site: "1", id: "10", title: "帖子" },
      { kind: "book", site: "2", id: "20", title: "书" },
    ])
  })
})

describe("mergeItemKey", () => {
  test("跨站同 tid 不撞", () => {
    expect(mergeItemKey({ site: "1", id: "12345" })).not.toBe(
      mergeItemKey({ site: "2", id: "12345" })
    )
  })
})

describe("searchSortKey 与分组键同源", () => {
  // fixture 与 title-parse.test.ts 的原始输入一一对应
  const fixtures = [
    "〖警花少妇白艳妮〗１－５８",
    "【白雪仙尘录】０１-３４_作者_asd223152",
    "【情动】_（０１－４２完结）_作_者：梓妃渔",
    "〖朱颜血〗（全）ｂｙ恶魔岛诸位",
    "〖短篇合集〗by黑暗",
    "_【勾引】（００１－０６８完结）作_者：微微",
    "_★《大航海时代加强版》１～４部４章",
    "[贺岁]【万圣惊魂】_(完)_顽童本色[原创]",
    "【搜神记顿丘魅物】完沉木[原创]",
    "【暗黑破坏神之少年德鲁伊】1-3[小小书童_原创]",
  ]
  test("真实论坛标题上服务端排序键 === 前端分组键", () => {
    for (const t of fixtures) {
      expect(searchSortKey(t)).toBe(groupKeyFromTitle(t))
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/web && bun test src/lib/merge-search.test.ts
```

期望：FAIL（`Cannot find module '@/lib/merge-search'`）。

- [ ] **Step 3: 实现 lib/merge-search.ts**

创建 `apps/web/src/lib/merge-search.ts`：

```ts
import type { MergedSearchItem } from "@workspace/core"
import type { MeListItem } from "@/components/me-item-card"

export type SearchItem = Pick<MeListItem, "kind" | "site" | "id" | "title">

/** MergedSearchItem → groupMeListItems 入参形状（分组逻辑复用，不新写） */
export function toMeListItems(items: MergedSearchItem[]): SearchItem[] {
  return items.map((it) => ({
    kind: it.kind,
    site: it.site,
    id: it.link.tid,
    title: it.link.title,
  }))
}

/** React 渲染 key：跨站同 tid 不撞 */
export function mergeItemKey(item: { site: string; id: string }): string {
  return `${item.site}:${item.id}`
}
```

- [ ] **Step 4: groupMeListItems 泛型化**

`apps/web/src/lib/book-groups.ts` 中 `groupMeListItems` 签名（约 121 行）改为：

```ts
export function groupMeListItems<
  T extends Pick<MeListItem, "kind" | "site" | "id" | "title">,
>(items: T[]): GroupedItem<T>[] {
```

函数体不变（`it.kind` / `it.site` / `it.title` / `it.id` 都在 Pick 内）。`group.sort((a, b) => Number(a.id) - Number(b.id))` 与 `pickHeaderMeta(group, (it) => it.title)` 均兼容。

- [ ] **Step 5: 跑测试 + 类型检查**

```bash
cd apps/web && bun test src/lib/merge-search.test.ts src/lib/book-groups.test.ts
cd apps/web && bun run typecheck
```

期望：新测试 PASS（含 10 条同源 fixture）；`book-groups.test.ts` 不回归；typecheck 无错误（History/Favorites/Tags 等 `groupMeListItems(MeListItem[])` 调用点因泛型推断类型不变）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/merge-search.ts apps/web/src/lib/merge-search.test.ts apps/web/src/lib/book-groups.ts
git commit -m "feat: search merge mapping lib + generic groupMeListItems"
```

---

### Task 5: SearchPage 改造（合并列表 + 来源标签）

**Files:**
- Modify: `apps/web/src/pages/SearchPage.tsx`（SearchContent 主体重写）
- Modify: `apps/web/src/components/similar-post-card.tsx`（加 `badge` prop）
- Modify: `apps/web/src/lib/routes.ts`（`api` 常量加 `search`）

**Interfaces:**
- Consumes: `toMeListItems` / `mergeItemKey` / `SearchItem`（Task 4）；`groupMeListItems`（Task 4 泛型）；`MergedSearchItem`（`@workspace/core`）；`api.search`（本任务 routes 改动）；`searchPath`（现状，仍带 `site`）。
- Produces: 合并搜索 UI；`SimilarPostCard` 新增可选 `badge?: ReactNode`。

- [ ] **Step 1: routes.ts 加 API 常量**

`apps/web/src/lib/routes.ts` 的 `api` 对象中 `browse: "/api/browse",` 之后加：

```ts
  search: "/api/search",
```

- [ ] **Step 2: SimilarPostCard 加 badge prop**

`apps/web/src/components/similar-post-card.tsx`：

1. props 类型加 `badge?: ReactNode`，函数签名解构加 `badge`。
2. `site !== "1" || !groupKey` 分支的 `ListPostCard` 加 `trailing={badge}`。
3. 论坛分支的 `ListPostCard` `trailing` 改为：

```tsx
trailing={
  badge ? (
    <span className="flex shrink-0 items-center gap-2">
      {badge}
      <SimilarTrigger open={open} onToggle={() => setOpen((v) => !v)} />
    </span>
  ) : (
    <SimilarTrigger open={open} onToggle={() => setOpen((v) => !v)} />
  )
}
```

（`badge` 未传时各分支渲染与现状完全一致。）

- [ ] **Step 3: 重写 SearchPage.tsx**

整体替换 `apps/web/src/pages/SearchPage.tsx`（保留 `Suspense`/`default export` 骨架与 `useExpandedBooks("search")`）：

```tsx
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { PostList } from "@/components/post-card"
import { ListPostCard, GenrePill } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { SimilarPostCard } from "@/components/similar-post-card"
import { groupMeListItems } from "@/lib/book-groups"
import { mergeItemKey, toMeListItems } from "@/lib/merge-search"
import { ListMeta, SearchForm, useScrollTop } from "@/components/form-controls"
import { formatListPagination } from "@/lib/list-meta"
import { cn } from "@workspace/ui/lib/utils"
import { useSite } from "@/hooks/use-site"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import type { MergedSearchItem } from "@workspace/core"
import {
  api,
  bookPath,
  parsePage,
  parseQuery,
  readPath,
  searchPath,
  SITES,
  type SiteId,
} from "@/lib/routes"

interface SearchResponse {
  items: MergedSearchItem[]
  nextPage: number | null
  errors?: Record<string, string>
}

/** 来源标签：论坛 = 中性，书库 = 强调 */
function SourceBadge({ site }: { site: SiteId }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        site === "2"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {SITES[site]?.label ?? site}
    </span>
  )
}

function SearchContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ?site= 只服务全站导航（顶栏上下文），不参与 /api/search 请求
  const site = useSite()
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)

  const [input, setInput] = useState(q)
  const [links, setLinks] = useState<MergedSearchItem[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const { isExpanded, toggle } = useExpandedBooks("search")
  const grouped = useMemo(() => groupMeListItems(toMeListItems(links)), [links])

  useEffect(() => {
    setInput(q)
  }, [q])

  useScrollTop([q, pageParam])

  const loadPage = useCallback(async (keyword: string, p: number) => {
    const seq = ++seqRef.current
    setLinks([])
    setLoading(true)
    setError("")
    setErrors({})
    try {
      const res = await fetch(
        `${api.search}?q=${encodeURIComponent(keyword)}&page=${p}`
      )
      const json = (await res.json()) as SearchResponse
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError((json as { error?: string }).error || "请求失败")
        return
      }
      setLinks(json.items)
      setNextPage(json.nextPage)
      setErrors(json.errors ?? {})
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!q) {
      setLinks([])
      setNextPage(null)
      setErrors({})
      setError("")
      setLoading(false)
      return
    }
    loadPage(q, pageParam)
  }, [q, pageParam, loadPage])

  function goTo(keyword: string, p: number) {
    navigate(searchPath({ q: keyword, page: p, site }))
  }

  return (
    <PageShell>
      <PageHeader
        title="搜索"
        description={
          q && !loading && links.length > 0
            ? `「${q}」· 第 ${pageParam} 页 · ${links.length} 条`
            : "同时搜索论坛与书库"
        }
      />

      <SearchForm
        value={input}
        onChange={setInput}
        placeholder="输入关键词"
        maxLength={40}
        showIcon
        buttonLabel="搜索"
        className="mb-6 sm:mb-8"
        onSubmit={(next) => {
          if (!next) return
          goTo(next, 1)
        }}
      />

      {Object.keys(errors).length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {Object.entries(errors).map(([sid, msg]) => (
            <div key={sid}>
              {SITES[sid]?.label ?? sid}搜索暂不可用：{msg}
            </div>
          ))}
        </div>
      )}

      {!q && !loading ? (
        <AsyncBody
          loading={false}
          error=""
          empty
          emptyText="输入关键词开始搜索"
        >
          {null}
        </AsyncBody>
      ) : (
        <AsyncBody
          loading={loading}
          error={error}
          empty={!!q && links.length === 0}
          onRetry={() => q && loadPage(q, pageParam)}
          emptyText={q ? `没有找到「${q}」相关内容` : "输入关键词开始搜索"}
        >
          <ListMeta>
            {formatListPagination({
              page: pageParam,
              pageCount: links.length,
              pageSize: Math.max(links.length, 1),
              hasNext: nextPage !== null,
            })}
          </ListMeta>
          <PostList>
            {grouped.map((g) =>
              g.type === "group" ? (
                <CollapsibleBookGroup
                  key={`group:${g.key}`}
                  title={g.title}
                  summary={g.author ?? undefined}
                  count={g.items.length}
                  bookKey={g.key}
                  isExpanded={isExpanded(g.key)}
                  onToggle={() => toggle(g.key)}
                  trailing={
                    <span className="flex shrink-0 items-center gap-2">
                      {g.genre ? <GenrePill genre={g.genre} /> : null}
                      <SourceBadge site="1" />
                    </span>
                  }
                  similar={{
                    title: g.title,
                    groupKey: g.key,
                    seedItems: g.items.map((m) => ({
                      tid: m.id,
                      title: m.title,
                    })),
                  }}
                >
                  {g.items.map((m) => (
                    <ListPostCard
                      key={mergeItemKey(m)}
                      href={readPath(m.id, m.site)}
                      rawTitle={m.title}
                      showGenre
                    />
                  ))}
                </CollapsibleBookGroup>
              ) : g.item.kind === "book" ? (
                <ListPostCard
                  key={mergeItemKey(g.item)}
                  href={bookPath(g.item.id, { site: g.item.site })}
                  rawTitle={g.item.title}
                  showGenre
                  trailing={<SourceBadge site={g.item.site} />}
                />
              ) : (
                <SimilarPostCard
                  key={mergeItemKey(g.item)}
                  href={readPath(g.item.id, g.item.site)}
                  rawTitle={g.item.title}
                  tid={g.item.id}
                  site={g.item.site}
                  showGenre
                  badge={<SourceBadge site="1" />}
                />
              )
            )}
          </PostList>
          <Pager
            page={pageParam}
            hasNext={nextPage !== null}
            onPrev={() => goTo(q, pageParam - 1)}
            onNext={() => nextPage !== null && goTo(q, nextPage)}
            disabled={loading}
          />
        </AsyncBody>
      )}
    </PageShell>
  )
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <Spinner />
        </PageShell>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
```

（说明：`PageSiteTabs` / `groupBooks` / `useScrollTop` 之外的旧 import 全部移除；`readPath`/`bookPath` 现在按 `m.site`/`g.item.site` 分别指向论坛帖与书库书。）

- [ ] **Step 4: 类型检查 + 构建**

```bash
cd apps/web && bun run typecheck
cd apps/web && bun run build
```

期望：typecheck 无错误；`vite build` 成功（`@workspace/core/title-parse` 与 `@workspace/core` 的 TS 源码经 Vite 正常解析，与现有 `@workspace/ui` 用法一致）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SearchPage.tsx apps/web/src/components/similar-post-card.tsx apps/web/src/lib/routes.ts
git commit -m "feat: unified cross-site search page with source badges"
```

---

### Task 6: 文档 + 全仓验证

**Files:**
- Modify: `AGENTS.md`（API 表）

- [ ] **Step 1: AGENTS.md 加 API 行**

`AGENTS.md` 的 API 表中 `GET /api/browse` 行之后加：

```markdown
|`GET /api/search`|`q`、`page`|跨站合并搜索 `{ items, nextPage, errors? }`（`NO_STORE`）|
```

- [ ] **Step 2: 全仓验证**

```bash
bun run test
bun run typecheck
bun run build
```

期望：全部 PASS / 无错误。

- [ ] **Step 3: dev 手测**

```bash
bun run dev
```

浏览器实测（或 curl API）：
1. `GET http://localhost:3001/api/search?q=<一个两站都可能有的词>` → `items` 含 `site:"1"` 与 `site:"2"` 条目、按标题排序、带 `nextPage`。
2. `GET /api/search?q=` → 400 `missing q parameter`；`?q=%20` → 400。
3. 前端 `/search?q=<词>`：无站点 Tab；列表混排；论坛折叠组头与书库单条均带来源标签；翻页正常。
4. `/search?q=<词>&site=2` 提交后 URL 仍带 `&site=2`，顶栏站点上下文不丢。
5. 单站故障：临时改 `SITES` 中某站 homeUrl 为不可达地址（手测后还原），确认返回另一站结果 + 顶部警告行，且该半残页刷新后仍能恢复（未被缓存钉住）。
6. 同 tid 场景（如 q 命中论坛 tid=12345 与书库 cid=12345）两条都渲染、key 不冲突（无 React 重复 key 警告）。

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md /api/search endpoint"
```

---

## Self-Review

**1. Spec coverage 逐节对照：**
- 标题管线收拢（parseListTitle 搬家 / exports / web re-export / normalize 收拢 / archive 对齐）→ Task 1 ✓
- merge 纯函数 + SITE_KIND + 排序 + 平局 + nextPage OR + errors → Task 2 ✓
- API（校验 / SITES 遍历 / 共享 browse 缓存键含空 type 段 / 合并页不缓存 / NO_STORE / 失败映射 504-or-statusCode）→ Task 3 ✓
- web lib 映射 + Pick 泛型 + mergeItemKey + 同键断言 fixture → Task 4 ✓
- SearchPage（去 Tab / ?site= 保留回写 / errors 警告 / maxLength 40 / key / SourceBadge / SimilarPostCard badge / 组头 shrink-0）→ Task 5 ✓
- AGENTS.md 行 → Task 6 ✓
- 测试清单（sortKey 用例、merge 用例、同键断言、回归 title-parse/book-groups/archive_auto_group、handler 手测）→ Task 2/4/6 ✓

**2. Placeholder scan：** 所有代码步骤含完整内容；无 TBD/TODO/「类似 Task N」。

**3. Type consistency：**
- `searchSortKey` / `mergeSearchPages` / `MergedSearchItem` / `SITE_KIND` 在 Task 2-5 签名一致。
- `toMeListItems` 返回 `SearchItem[]`、`mergeItemKey({site,id})` 在 Task 4-5 一致。
- `groupMeListItems<T extends Pick<...>>` 泛型：Task 4 定义，Task 5 以 `SearchItem` 调用，历史/收藏以 `MeListItem` 调用——均满足约束。
- `SimilarPostCard` `badge?: ReactNode` Task 5 内定义即使用。
- `SearchResponse` / `MergedSearchItem` 与 API 响应形状一致。
