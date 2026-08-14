# 分类页同时展示两站分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分类页同时展示论坛（site 1）与书库（site 2）的分类入口，移除 论坛/书库 切换 Tab。

**Architecture:** 纯前端改动，仅重写 `apps/web/src/pages/CategoriesPage.tsx`。并行两次 `useAsyncList`（`?site=1`、`?site=2`），各自驱动一个站点区块（站点小标题 + `AsyncBody` 三态 + `CategoryGrid`）。页头描述按「成功加载的站」统计，保证与可见内容一致。无需改 API、抓取器、路由表——`/api/categories?site=1|2` 已可用，且每条分类链接自带 `site=`。

**Tech Stack:** React 19、React Router 7、Tailwind CSS 4、TypeScript strict。

## Global Constraints

- TypeScript `strict`；前端 `noEmit` 类型检查。
- Prettier 风格：**无分号**、**双引号**、`printWidth: 80`、`trailingComma: "es5"`。
- 前端导入用 `@/` 别名；跨包用 `@workspace/...`。
- 样式用 Tailwind 工具类；图标优先 lucide-react。
- 验证命令：`bun run typecheck`、`bun run build`。
- **无前端单测基建**（`bun test` 只覆盖 `packages/core`），本任务以 typecheck + build + 手动验证收尾，不臆造单测。

## File Structure

- **Modify:** `apps/web/src/pages/CategoriesPage.tsx`（整页重写，约 56 → 约 75 行）
  - 移除：`PageSiteTabs`、`useSite` 的导入与使用。
  - 新增：本地 `CategorySection` 组件（站点区块）、`describeHeader` 描述计算、模块级 `pickLinks`。
  - 复用：`useAsyncList`、`AsyncBody`、`CategoryGrid`、`PageHeader`、`PageShell`，均不改。

无新建文件、无后端改动。

---

### Task 1: 重写 CategoriesPage 同时展示两站分类

**Files:**
- Modify: `apps/web/src/pages/CategoriesPage.tsx`（整文件替换）

**Interfaces:**
- Consumes（来自 `@/lib/routes`）：`api.categories: "/api/categories"`；`DEFAULT_SITE = "1"`；`SITES: Record<SiteId, { label: string }>`（`"1"→论坛`、`"2"→书库`）；`type SiteId = string`。
- Consumes（来自 `@/hooks/use-async-list`）：`useAsyncList<T>(url, pick)` 返回 `{ items: T[]; loading: boolean; error: string; reload: () => void; setItems }`。
- Consumes（来自 `@/components/ui-state`）：`AsyncBody({ loading, error, empty, onRetry?, emptyText?, children })`。
- Consumes（来自 `@/components/category-grid`）：`CategoryGrid({ items: CategoryItem[] })`、`type CategoryItem { label; url; kind: "type"|"column"|"other" }`。
- Produces：默认导出 `CategoriesPage`（路由 `App.tsx:61` 已注册，签名不变）。

- [ ] **Step 1: 用下面内容整文件替换 `apps/web/src/pages/CategoriesPage.tsx`**

```tsx
import { CategoryGrid, type CategoryItem } from "@/components/category-grid"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { api, DEFAULT_SITE, SITES, type SiteId } from "@/lib/routes"

function normalize(raw: CategoryItem): CategoryItem {
  if (raw.kind) return raw
  try {
    const u = new URL(raw.url, "http://local")
    if (u.searchParams.get("type")) return { ...raw, kind: "type" }
    if (u.searchParams.get("q")) return { ...raw, kind: "column" }
  } catch {
    /* ignore */
  }
  return { ...raw, kind: "other" }
}

const pickLinks = (json: Record<string, unknown>): CategoryItem[] =>
  ((json.links as CategoryItem[]) ?? []).map(normalize)

type AsyncCategoryState = {
  items: CategoryItem[]
  loading: boolean
  error: string
  reload: () => void
}

/** 两站分类区块：站点小标题 + 异步三态 + 网格 */
function CategorySection({
  siteId,
  items,
  loading,
  error,
  reload,
}: AsyncCategoryState & { siteId: SiteId }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">
        {SITES[siteId].label}
      </h2>
      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无分类"
      >
        <CategoryGrid items={items} />
      </AsyncBody>
    </section>
  )
}

/** 页头描述：只统计成功加载（非 loading、非 error）的站，
 *  保证文案与页面可见内容一致；题材口径含书库「有声」（kind==="type"）。 */
function describeHeader(...sites: AsyncCategoryState[]): string {
  if (sites.some((s) => s.loading)) return "书屋栏目与题材"
  const loaded = sites.filter((s) => !s.error)
  if (loaded.length === 0) return "书屋栏目与题材"
  const items = loaded.flatMap((s) => s.items)
  const typeCount = items.filter((i) => i.kind === "type").length
  if (typeCount > 0) return `共 ${typeCount} 个题材`
  if (items.length > 0) return `共 ${items.length} 个入口`
  return "书屋栏目与题材"
}

export default function CategoriesPage() {
  const forum = useAsyncList(`${api.categories}?site=${DEFAULT_SITE}`, pickLinks)
  const library = useAsyncList(`${api.categories}?site=2`, pickLinks)

  return (
    <PageShell>
      <PageHeader title="分类" description={describeHeader(forum, library)} />
      <div className="flex flex-col gap-8">
        <CategorySection siteId={DEFAULT_SITE} {...forum} />
        <CategorySection siteId="2" {...library} />
      </div>
    </PageShell>
  )
}
```

要点说明（实现者必读）：
- `PageSiteTabs` / `useSite` 不再导入；页面不再读写地址栏 `?site=`（残留值被忽略）。
- 两次 `useAsyncList` 必须在组件顶层、固定顺序调用（hooks 规则）。
- `<CategorySection {...forum} />` 展开含 `setItems`，TS 对变量展开不做多余属性检查，不会报错。
- 站点小标题样式与 `CategoryGrid` 内部 `题材`/`其它` h2 完全一致（`mb-3 text-xs font-semibold tracking-wide text-muted-foreground`）。
- `PageHeader` 自带 `mb-6 sm:mb-8`，移除 `PageSiteTabs` 后无需补顶部间距。

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 全仓类型检查通过，无错误（重点确认 `CategoriesPage.tsx` 的展开 props、`SITES[siteId].label` 索引）。

- [ ] **Step 3: 运行构建**

Run: `bun run build`
Expected: Turbo 构建通过（`apps/web` Vite 构建成功）。

- [ ] **Step 4: Prettier 格式校验**

Run: `bun run format`（或 `bunx prettier --check apps/web/src/pages/CategoriesPage.tsx`）
Expected: 无格式差异（无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/CategoriesPage.tsx
git commit -m "feat(web): show both sites' categories without tab"
```

- [ ] **Step 6: 手动验证（dev 环境）**

启动 `bun run dev`，访问 `http://localhost:3000/categories`，逐项确认：

1. 页面同时显示 **论坛** 与 **书库** 两个区块，无 论坛/书库 切换 Tab；顺序为 论坛 → 书库。
2. 页头描述：两站加载完后显示 `共 N 个题材`（N 含书库「有声」），符合可见卡片数。
3. 点论坛题材 → 跳 `/browse?type=...`（site 1，无 `site=` 参数）。
4. 点书库题材 → 跳 `/browse?type=...&site=2`。
5. 残留参数：访问 `/categories?site=2`，两区块照常展示，无 Tab、无错位。
6. 跨站导航：从 `/browse?site=2` 进分类页，再点论坛分类，落到 site 1 的 browse。
7. 单站失败（断网/上游不可达模拟）：失败区块显示错误框 + 重试，另一站照常；页头按成功站统计（如论坛成功显示 `共 N 个题材`，不回退静态文案）。
8. 两站均失败：页头静态 `书屋栏目与题材` + 两个错误框各自可重试。

如某项不符，回到 Step 1 修正后再跑 Step 2–3。

---

## Self-Review（已执行）

- **Spec coverage**：移除 Tab ✓、两站并行 `useAsyncList` ✓、分区堆叠 + 站点小标题 ✓、页头描述按成功站统计（含 P1 判定顺序）✓、标题用 `SITES[id].label`（P3）✓、残留 `?site=` 忽略 ✓、边界（单站失败/均失败）✓。P2（题材含有声）在 `describeHeader` 注释中注明 ✓。P4（重复 h2）按 spec 列入「不做」✓。
- **Placeholder scan**：无 TBD/TODO；代码步骤均给出完整可粘贴代码。
- **Type consistency**：`AsyncCategoryState` 在 `CategorySection` 与 `describeHeader` 间字段一致（`items/loading/error/reload`）；`CategoryItem`、`SiteId`、`SITES`、`DEFAULT_SITE` 名称与 `@/lib/routes`、`@/components/category-grid` 一致。
