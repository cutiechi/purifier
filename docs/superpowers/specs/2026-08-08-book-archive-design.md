# 书库全量目录（归档模式）

## 背景

论坛站（site=1）已有「目录」(`/archive`)：后台归档 job 把全站主帖抓进 SQLite `archive_posts` 表，前端 ArchivePage 查本地，支持搜索/排序/分页/离线。

书库站（site=2, xbookcn）目前**没有对等的目录**——ArchivePage 写死了 `site !== "1"` 重定向，书库站的「目录」顶栏项会消失。书库的列表数据全靠实时抓上游（BrowsePage 按分类），没有全站书目索引。

xbookcn 有一个「全部小说」页 `/novels`（共约 18687 部，按「最新收录」排序，每页 24 条，URL 为 `/novels/{页码}`）。`XbookcnExtractor.fetchHomeLinks(mtid)` 已经实现了对这个页面的抓取和翻页（`mtid` 即页码，`xbookcn.ts:254-275`）。

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
                                   ArchivePage（已有，解除 site 限制 + 适配）
```

关键事实（均已代码验证）：
- `archive_posts.tid` 是 `TEXT`（`db.ts:84-90`），书库 cid（base64 如 `MjI4Nzg`）可直接存
- Store 归档方法（`upsertArchivePosts` / `listArchivePosts` / `getArchiveCursor` / `getArchiveStatus` / `getArchiveMaxTid`）全部按 site 参数通用（`store.ts:911-1083`）
- `/api/me/archive`、`/api/me/archive/status` 按 site 查询、默认 "1"（`index.ts:599-622`）
- `archive_cursors` 主键是 site（`db.ts:97-103`），两站游标互不干扰
- 新 handler 注册即生效（`jobs/runner.ts:19-23`），API 层零改动
- 论坛 `ArchivePostsJob` 的 `site !== "1"` 限制（`archive_posts.ts:33-35`）不动，书库走独立 handler

## 改动清单

### 1. 新增书库归档 job

**文件**：`packages/core/src/jobs/handlers/archive_books.ts`（参照 `archive_posts.ts`）

- `type = "archive_books"`
- `fetchPage` 调 `resolveSite("2").fetchHomeLinks(页码, signal)` —— 复用已有的 `/novels/{n}` 抓取
- 游标语义：`mtid` 是页码（"1", "2", ... 递增），起始页为 **"1"**（不要从 "0" 起：`fetchHomeLinks("0")` 抓的是首页时间线，卡片语义不同）
- 每页 sleep（默认 800ms，可配 delayMs），支持 maxPages 上限
- payload：`{ site: "2", mode, delayMs?, maxPages? }`
- progress 字段 shape 与 `archive_posts` 一致（`mode/pages/inserted/updated/nextMtid`），以便 `formatJobProgress` 直接复用
- site 校验与 archive_posts 对称：`site` 非 `"2"` 抛错（payload 默认 `"2"`）

三种模式：
- **full**：从第 1 页翻到末页（nextMtid 为 null）
- **resume**：从游标保存的页码继续翻到末页
- **incremental**：见下方「增量策略」专节

游标停滞检测：`Number(page.nextMtid) >= Number(mtid)`（对页码递增语义天然成立）。

**注册**：`packages/core/src/jobs/index.ts` 加 `archive_books` → `ArchiveBooksJob`

### 2. 增量策略（incremental）

书库 `/novels` 按「最新收录」降序，第 1 页最新。incremental 从第 1 页往后扫，目标是只补新书、追上即停。

**停止条件（关键修复，见评审问题 1）**：不能单看 `inserted === 0`——那只适用于「归档从第 1 页起连续完整」。若 full 曾中途中断（已存第 1..N 页、游标 interrupted），第 1 页 24 条全部已存在 → `inserted=0` → 立即停 → 永远停留在 N 页、无法自愈。

正确条件是加一个「深度」门槛：

```
savedDepth = 本次运行前 cursor.pages（无游标则 0）
stop iff inserted === 0 && links.length > 0 && pages >= savedDepth
```

- 残缺归档（savedDepth=N，已存第1..N页）：第 1 页虽全存在但 `1 < N` → 继续扫到未归档区域（inserted>0）→ 追到末尾或越过旧深度才停
- 完整归档（savedDepth=末页）：追上新书后停在深度附近
- 首次归档（库空、savedDepth=0）：incremental 等价于 full

### 3. ArchivePage 解除 site 限制 + 适配

**文件**：`apps/web/src/pages/ArchivePage.tsx`

- 去掉 `site !== "1"` 重定向（`:150-152`）
- `PageSiteTabs` `sites={["1"]}` → `["1", "2"]`（`:168`）
- **🔴 reload 必须传 site（评审问题 2）**：当前 `:79` 的请求只带 `sort/page/q`，API 默认 site="1"。改为 `params.set("site", site)`，否则 `/archive?site=2` 拉到的是论坛数据
- **「更新目录」链接（:161）带 site**：否则书库站点击后回落 site=1，看到的是论坛任务页
- **🔴 书库条目链接走 `/book/:cid`（评审问题 3）**：当前 `:225`/`:255` 统一用 `readPath(it.tid, it.site)`，书库 cid 走 `/read/:tid` 会 404（ReadPage 请求 `/api/posts?tid=`）。按 `it.site` 分流：site=2 用 `bookPath(it.tid, { site: it.site })`，参照 `me-item-card.tsx:42-43` / `BrowsePage.tsx:164`
- **排序适配（评审问题 4，方案 A）**：书库默认 `sort=archived_at` + `order=asc`，书库站隐藏「按 tid」选项（`CAST(tid AS INTEGER)` 对 base64 cid 全为 0，排序无意义）。方向注意：full 从第 1 页（最新收录）往后扫，第 1 页先入库、archived_at 最早——**asc 才是最新收录在前**（API 对 archived_at 默认 desc，需显式传 `order=asc`；desc 会把最旧收录排最前）
- **跳过书库标题分组（评审问题 8）**：`groupBooks`（`:139-147`）按标题折叠成 CollapsibleBookGroup，论坛语义是「多章帖子聚合」。书库每条本身是一本书，同名不同 cid 会误折叠，`parseListTitle` 的「【】」解析也可能误伤。site=2 直接渲染单条列表，不做分组
- 描述 / 空态文案按站区分（论坛「本地全站主帖目录」/ 书库「本地全站书库目录」；空态同理）

### 4. SectionTabs 站点适配（书库站无分组）

**文件**：`apps/web/src/lib/routes.ts` + `apps/web/src/lib/hub-tabs.ts`

当前 `ALL_TABS` 两条目都带 `sites: ["1"]`，`useAllTabs` 不按站过滤。

- `ALL_TABS`「目录」条目 sites 扩为 `["1", "2"]`（「分组」保持 `["1"]`）
- `useAllTabs` 改为按 site 过滤（参照 `useMeTabs`/`useDiscoverTabs` 的 `t.sites.includes(site)`），并 `withSite(t.href, site)`（评审问题 5：当前 `to: t.href` 不带 site，书库站点 tab 会丢 site）

效果：论坛站显示「目录 / 分组」，书库站只显示「目录」。

### 5. JobsPage 适配书库

**文件**：`apps/web/src/pages/JobsPage.tsx`

- 解除 `site !== "1"` 重定向（`:320-322`），书库站可访问
- `onStart`（`:190`）按 site 切换 job type：论坛 `startJob("archive_posts", { site: "1", mode })`、书库 `startJob("archive_books", { site: "2", mode })`；`getArchiveStatus` 同理按当前 site 查（`:81`）
- 按钮文案按站区分：论坛「从最新帖往回全量扫描」、书库「从第 1 页（最新收录）往后扫」
- runningJob 横幅「打开归档目录」链接（`:386-388`）、「最近一次归档成功 / 查看归档」（`:400`）、头部「返回目录」（`:346`）均带 site；书库站「打开分组」不出现
- 空态文案（`:503-505`）按站区分（不再写死「全站主帖归档」）
- 状态卡 cursorHint：书库的 maxTid 是随机 cid，文案改「最新 cid xxx」或不展示 maxTid 行（评审问题 4 连带）

### 6. JobRow / JOB_TYPE_LABEL 认识新类型

- `lib/jobs.ts:22-25` `JOB_TYPE_LABEL` 补 `archive_books: "书库归档"`，否则任务行显示裸字符串
- `job-row.tsx:39` `isArchive = job.type === "archive_posts"` → 加 `|| job.type === "archive_books"`，成功后显示「查看归档」链接（链接带 site）

## 不做的事

- 不改 `archive_posts` 表 schema（tid 已是 TEXT，通用）
- 不动论坛 `ArchivePostsJob`（包括它的 site=1 限制）
- 不给书库做「自动分组」（archive_auto_group 是论坛专用）
- 不新增归档状态/规模 API（`/api/me/archive/status` 已按 site 查询，通用）
- 不做方案 B（API 层 tid 排序回退）——排序在前端按站处理即可

## 测试

`archive_books.test.ts`，mock fetchPage，参照 `archive_posts.test.ts` 的 `makeJob`/`makeCtx` 结构：

1. **full**：从第 1 页翻到末页，cursor 推进正确，结果含 pages/inserted
2. **resume**：从游标页继续到末页
3. **incremental × 完整归档**（savedDepth=末页）：追上新书后停在深度附近，不扫完全库
4. **incremental × 部分归档（回归，评审问题 1）**：先跑 2 页后模拟中断（游标 interrupted、pages=2），再跑 incremental，断言**不停在第 1 页**、最终翻到末页
5. **resume 跨站隔离**：site=1 与 site=2 游标互不覆盖（一行断言）

## 验证

```bash
bun run test
bun run typecheck
bun run build
```

浏览器（chrome-devtools）补充清单（评审问题 3、4）：
- 书库站「目录」可进入、显示书库列表（归档后）、无分组 Tab
- site=2 列表项点击进 `/book/:cid` 正常（不是 /read）
- site=2 默认排序为归档时间序（archived_at asc，最新收录在前）
- site=2 不显示「按 tid」排序选项
- 搜索/分页可用、任务页可启动书库归档
