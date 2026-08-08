# 书库全量目录（归档模式）

## 背景

论坛站（site=1）已有「目录」(`/archive`)：后台归档 job 把全站主帖抓进 SQLite `archive_posts` 表，前端 ArchivePage 查本地，支持搜索/排序/分页/离线。

书库站（site=2, xbookcn）目前**没有对等的目录**——ArchivePage 写死了 `site !== "1"` 重定向，书库站的「目录」顶栏项会消失。书库的列表数据全靠实时抓上游（BrowsePage 按分类），没有全站书目索引。

xbookcn 有一个「全部小说」页 `/novels`（共约 18687 部，按「最新收录」排序，每页 24 条，URL 为 `/novels/{页码}`）。`XbookcnExtractor.fetchHomeLinks(mtid)` 已经实现了对这个页面的抓取和翻页（`mtid` 即页码）。

## 目标

书库站也有「目录」，体验与论坛对齐：归档进本地 SQLite，支持搜索/排序/分页/离线。书库站无「分组」（分组是论坛归档的自动建组功能）。

## 架构

**归档模式，完全复用现有 archive_posts 表 / API / ArchivePage**，只新增一个书库专属归档 job。

```
archive_books job（新）          archive_posts 表（已有，加 site=2 数据）
  resolveSite("2")                 ┌──────────────────────────────┐
  .fetchHomeLinks(页码)        →   │ site="2", tid=cid, title     │
  /novels/{n}，每页 24 条          └──────────────────────────────┘
  从第 1 页往后                    ↓
                                   /api/me/archive?site=2（已有，零改动）
                                   ArchivePage（已有，解除 site 限制）
```

关键：`archive_posts.tid` 是 `TEXT` 类型，书库 cid（base64 字符串如 `MjI4Nzg`）可直接存。表 schema、Store 的 `listArchivePosts` / `upsertArchivePosts` / `getArchiveMaxTid` / archive cursor 全部通用，零改动。

## 改动清单

### 1. 新增书库归档 job

**文件**：`packages/core/src/jobs/handlers/archive_books.ts`（参照 `archive_posts.ts`）

- `type = "archive_books"`
- `fetchPage` 调 `resolveSite("2").fetchHomeLinks(页码, signal)` —— 复用已有的 `/novels/{n}` 抓取
- 游标语义：`mtid` 是页码（"1", "2", ... 递增），起始页为 "1"
- 三种模式：
  - **full**：从第 1 页翻到末页（nextMtid 为 null）
  - **resume**：从游标保存的页码继续翻到末页
  - **incremental**：从第 1 页往后扫，**某页 upsert 后 inserted=0（全部已存在）则停**——因为列表按最新收录排序，连续命中说明后面都是旧条目。这与论坛的「tid ≤ maxTid 则停」形不同但神同（都是往旧走、追上即停）
- 每页 sleep（默认 800ms，可配 delayMs），支持 maxPages 上限
- 游标停滞检测：`Number(page.nextMtid) >= Number(mtid)` —— 对页码递增语义天然成立
- 写 `archive_posts(site="2", tid=cid, title)`，复用 `store.upsertArchivePosts`
- payload：`{ site: "2", mode, delayMs?, maxPages? }`

**注册**：`packages/core/src/jobs/index.ts` 加 `archive_books` → `ArchiveBooksJob`

**不动**：`archive_posts.ts:33-34` 的 `site !== "1"` 限制保留（那是论坛专用，游标语义不同）。

### 2. ArchivePage 解除 site 限制

**文件**：`apps/web/src/pages/ArchivePage.tsx`

- 去掉 `site !== "1"` 重定向（约 ArchivePage.tsx:150-152）
- `<PageSiteTabs sites={["1"]} />` → `sites={["1", "2"]}`
- 「更新目录」按钮：论坛站启动 `archive_posts`，书库站启动 `archive_books`（按 site 切换 job type）
- 描述：论坛「本地全站主帖目录（由任务同步）」、书库「本地全站书库目录（由任务同步）」（按 site 区分文案，或用通用文案）

### 3. SectionTabs 站点适配（书库站无分组）

**文件**：`apps/web/src/lib/routes.ts` + `apps/web/src/lib/hub-tabs.ts`

当前 `ALL_TABS` = 目录 + 分组，`useAllTabs` 不按站过滤。改为：
- `ALL_TABS` 的「分组」项加 `sites: ["1"]`（已有该字段）
- `useAllTabs` 改为按当前 site 过滤（参照 `useMeTabs`/`useDiscoverTabs` 的 `t.sites.includes(site)` 模式）

效果：论坛站显示「目录 / 分组」，书库站只显示「目录」。

### 4. JobsPage 加书库归档入口

**文件**：`apps/web/src/pages/JobsPage.tsx`

JobsPage 现在固定论坛站（`site !== "1"` 重定向回 jobs，archiveSupported = site === "1"）。书库归档也需要入口：
- 解除 `site !== "1"` 限制，或让书库站也能访问 JobsPage
- 站点切换到书库时，归档按钮启动 `archive_books`（而非 archive_posts）
- 归档状态卡（cursorHint）按 site 查对应归档规模

### 5. routes.ts 顶栏 site 匹配

当前 `NAV_ITEMS` 的「目录」项 match 是 `p === routes.archive || p === routes.groups`，两站都显示（不按站过滤，沿用现状）。书库站点进去原本靠 ArchivePage 重定向兜底，解除限制后直接进目录页。

## 增量策略详解

书库 `/novels` 按「最新收录」降序，第 1 页最新。incremental 模式从第 1 页往后扫：

```
page 1: 24 条 → upsert → inserted=24（全新）→ 继续
page 2: 24 条 → upsert → inserted=5  → 继续
page 3: 24 条 → upsert → inserted=0  → 全部已存在 → 停（追上了）
```

判定：每页 upsert 后看 `inserted === 0 && links.length > 0` 则停。边界：首次归档（库空）时 incremental 等价于 full（一直翻到末页），符合预期。

## 不做的事

- 不改 `archive_posts` 表 schema（tid 已是 TEXT，通用）
- 不动论坛 `ArchivePostsJob`（包括它的 site=1 限制）
- 不给书库做「自动分组」（archive_auto_group 是论坛专用）
- 不新增归档状态/规模 API（`/api/me/archive/status` 已按 site 查询，通用）

## 测试

- `archive_books.test.ts`：mock fetchPage，测 full/resume/incremental 三模式 + 游标推进 + 停止条件
- 参照 `archive_posts.test.ts` 的测试结构

## 验证

```bash
bun run test        # 新 job 测试 + 现有测试不破坏
bun run typecheck
bun run build
```

浏览器（chrome-devtools）：书库站「目录」可进入、显示书库列表（归档后）、无分组 Tab、搜索/排序/分页可用、任务页可启动书库归档。
