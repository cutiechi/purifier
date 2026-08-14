# 分类页同时展示两站分类

## 背景

当前 `CategoriesPage` 用 `PageSiteTabs`（论坛/书库切换 Tab）配合 `useSite()`，按 URL 的 `?site=` 一次只拉一个站的分类：

```ts
const site = useSite()
const { items, ... } = useAsyncList(`${api.categories}?site=${site}`, ...)
```

用户希望去掉这个 Tab，让论坛（site 1）与书库（site 2）的分类入口同时显示。

### 现状关键事实

- 两站都有分类：site 1（Cool18）返回 栏目/题材/其它；site 2（Xbookcn）实现了 `extractCategoryLinks`，返回 题材（`/tag/{slug}`）+ 有声。
- 每条分类链接的 URL **已自带 `site=`**：论坛默认不带（即 site 1），书库带 `site=2`（如 `/browse?type=audio&site=2`）。因此无论当前地址栏的 `?site=` 是什么，点进去都能正确路由。
- `/api/categories?site=1|2` 均已可用，走 `handleHomeExtract`，带 `LIST_CACHE_HEADERS`（`s-maxage=60`）。

## 目标

分类页同时展示 论坛 + 书库 的分类入口；移除 论坛/书库 切换 Tab。

## 范围

纯前端改动，只动 `apps/web/src/pages/CategoriesPage.tsx`。无需改 API、后端、抓取器、路由表。

## 设计

### 数据获取

并行两次 `useAsyncList`，分别请求 `?site=1` 与 `?site=2`：

```ts
const forum = useAsyncList(`${api.categories}?site=1`, pick)
const library = useAsyncList(`${api.categories}?site=2`, pick)
```

`pick` 复用现有 `(json) => ((json.links as CategoryItem[]) ?? []).map(normalize)`。

- 复用现成 hook，不改 `useAsyncList`。
- 各自独立维护 loading / error / empty，互不阻塞。

### 布局

两个纵向堆叠的区块，固定顺序 **论坛 → 书库**。每块结构：

1. 小标题头—— 文案取自常量 `SITES[id].label`（`routes.ts:27-30`），不写字面量 `论坛`/`书库`；样式沿用 `CategoryGrid` 内 `题材`/`其它` 的 muted `<h2>`（`text-xs font-semibold tracking-wide text-muted-foreground`，带 `mb-3`）。
2. 一个 `AsyncBody` 包着 `CategoryGrid`（含 spinner / 错误重试 / 空态）。

两块的 `useAsyncList` 请求串用站点键：论坛 `?site=${DEFAULT_SITE}`（`"1"`）、书库 `?site=2`。区块顺序固定，不随 `?site=` 变化。

### 页头描述

合并口径，**只统计成功加载（非 loading、非 error）的站**，保证页头文案与页面实际可见内容一致（部分失败时仍能反映已展示的卡片）：

```ts
// 判定顺序（伪代码）
if (forum.loading || library.loading) return "书屋栏目与题材"
if (forum.error && library.error) return "书屋栏目与题材"
// 此后至少一站成功
const loaded = [forum, library].filter((s) => !s.error)
const typeCount = loaded.flatMap((s) => s.items).filter((i) => i.kind === "type").length
const entryCount = loaded.flatMap((s) => s.items).length
if (typeCount > 0) return `共 ${typeCount} 个题材`
if (entryCount > 0) return `共 ${entryCount} 个入口`
return "书屋栏目与题材"
```

> 说明：`useAsyncList` 失败时会 `setItems([])`（`use-async-list.ts:40-42`），故失败站对计数自然贡献 0；上面先用 `s.error` 排除，避免把「失败」误当成「加载完且为空」。

**题材口径**：`题材 = kind === "type"`，**含书库的「有声」入口**（`xbookcn.ts:330-338` 标 `kind: "type"`）。这与单站现状口径一致；合并后数字变大、语义更显眼，特此注明。

### 移除项

- `PageSiteTabs` 组件使用。
- `useSite` 导入与调用。
- 页面不再读写地址栏的 `?site=`（残留的 `?site=` 被忽略，不影响功能）。

`normalize` 函数保留不变，对两站结果分别应用。

## 边界情况

- **单站加载失败**：该区块独立显示错误 + 重试，另一站照常展示。
- **单站返回空**：该区块显示「暂无分类」空态。
- **两站均失败**：两个区块各自报错重试（独立状态，符合现有模式）。
- **`?site=` 残留**：页面忽略之；分类链接自带正确 `site=`，导航无误。

## 不做（YAGNI）

- 不合并两站分类为单一网格（用户已选分区堆叠，语义清晰）。
- 不改 API 形态（无需新增「一次返回两站」的端点；两次轻量列表请求足够）。
- 不改 `CategoryGrid` 组件（其内部按 kind 分组逻辑继续复用）。
- 不处理「两个区块各出一个 `题材` h2」的重复标题问题：这是单站现状已有的行为，真正修复需调整 `CategoryGrid` 内部 heading 层级，超出本次单文件范围；仅包 `<section>` 只属装饰、不解题。
- 不动其它页面的站点 Tab 逻辑。

## 验证

- `bun run typecheck`（前端类型检查通过）。
- `bun run build`（构建通过）。
- 手动：访问 `/categories`，确认同时显示 论坛 与 书库 两个区块，无切换 Tab；点论坛题材跳 `/browse?type=...`（site 1），点书库题材跳 `/browse?type=...&site=2`。
- 手动：断网或上游不可达时，单站区块各自报错并保留重试；此时页头按「成功加载的站」统计（如论坛成功则显示 `共 N 个题材`，不回退静态文案）。
- 手动：两站均失败 → 页头静态文案 + 两个错误框各自可重试。
- 手动：带 `?site=2` 进入 `/categories`（残留参数被忽略，两区块照常展示，无切换 Tab）。
- 手动：从 `/browse?site=2` 导航到分类页，再点论坛分类，确认落到 site 1 的 browse。
