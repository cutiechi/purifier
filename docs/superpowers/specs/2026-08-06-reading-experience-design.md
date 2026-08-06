# 阅读体验优化设计

日期：2026-08-06
状态：已通过 brainstorming + review 修订，待写实施计划

## 背景与现状

Purifier 当前的阅读体验存在几个核心问题（基于 `apps/web/src/components/article-view.tsx` 的现状）：

- **正文字体不舒适**：`ContentBody` 用 `<pre font-mono>` 渲染（等宽代码字体），中文长文阅读不适。字号硬编码 14–15px，行高 1.85–1.9。
- **无阅读设置系统**：字体、字号、行高、栏宽全部硬编码，用户无法调整。
- **无阅读进度记忆**：打开文章永远从顶部开始；`items` 表（`packages/core/src/storage/db.ts:6-15`）只有 `visit_count`，无进度字段。
- **无章节导航**：Read 页只有底部扁平"扩展链接"列表（`RelatedLinks`）；Book 页完全无章节列表（`BookContentResponse` 无 `links`/`chapters` 字段）。

已有可复用基础设施：暗色主题（`next-themes`，`d` 键切换）、`/api/me/*` + SQLite store（历史/收藏/标签）、`useItemState`（已加载文章页的 state）、服务端内容清洗（`extractPreHtml`，输出仅含转义文本 + 站内锚点）。

## 目标

改善四个方向，作为连贯的「阅读体验」改造：

1. 排版/字体——衬线为主，移除等宽
2. 阅读设置——可调字号/字体/行高/栏宽（不含站点主题）
3. 阅读进度记忆——按文章记进度，重开恢复位置
4. 章节导航——Read 页上/下一章，Book 页补全目录

## 推进策略

**方案 A：基础设施先行**。每步独立可验证、独立 commit，不返工。实施顺序（review 修订后）：

1. §1 纯前端设置系统 + 衬线默认（不含主题、不含后端）
2. §2 `ArticleView` 排版改造（移除 `<pre>`/`font-mono`，设置驱动，**真正生效的栏宽**）
3. §3 进度记忆（幂等 ALTER + store + 端点 + hook + 恢复滚动；me 列表已读）
4. §4a Read 页章节导航（防御性 prev/next + 键盘）
5. §4b Book 页目录（探查上游后决定做/降级；独立 commit，带 extractor 测试）

## §1 阅读设置系统（纯前端）

### 存储拆分

- **全局阅读设置**（字号、字体、行高、栏宽）→ **localStorage**。即时读写、刷新即生效、无需登录。`/api/me` 是单用户库无多设备登录体系，全局设置同步后端无实际价值。
- **文章级数据**（阅读进度）→ **SQLite + `/api/me/*` 同步**（§3）。列表页也要显示已读状态，存 localStorage 则列表页无法得知"哪些读过"。

### 不含站点主题（review 修订）

阅读设置**去掉 `theme` 字段**。站点 dark/light 仍由 `next-themes` + `d` 键统一管理（`theme-provider.tsx`），避免双轨持久化与行为不一致。若未来要"护眼/纸色"阅读主题，单独设计 `readingTheme: default | paper | sepia`，与站点 dark/light 正交，不复用 next-themes 的 auto/light/dark。本次不做。

### 客户端 ReadingSettingsProvider

新文件 `apps/web/src/components/reading-settings.tsx`：

- localStorage key `purifier:reading`，存 `{ font, fontSize, lineHeight, maxWidth }`（无 theme）
- `useReadingSettings()` hook
- `<ReadingSettingsProvider>` 包在 `App` 根
- `<ReadingSettingsPanel>` 设置面板（从 action row 按钮唤起）

### 默认值（衬线为主）

| 设置         | 默认值       | 可选值             |
| ------------ | ------------ | ------------------ |
| `font`       | `"serif"`    | serif / sans / mono |
| `fontSize`   | `17`（px）   | 14–22              |
| `lineHeight` | `1.8`        | 1.4–2.2            |
| `maxWidth`   | `"normal"`   | normal（768）/ wide（896） |

`maxWidth` 的两个值复用现有 tailwind class：normal → `max-w-3xl`（48rem=768），wide → `max-w-4xl`（56rem=896），与 `SiteHeader` 的 `max-w-3xl`/`lg:max-w-4xl` 一致，保证宽模式下正文与顶栏对齐（见 §2）。

### 本步交付物与验收

本步**仅前端**：Provider + localStorage + 默认衬线接入 `ContentBody` + 设置面板入口。**不含** schema 迁移与进度端点（整体挪到 §3，避免半成品 API 无调用方）。

验收（用户可见）：打开任意文章立即看到衬线、更舒适的 17px 字号、1.8 行高。

## §2 ArticleView 排版改造

### 渲染方式

`apps/web/src/components/article-view.tsx:8-32` 的 `ContentBody`：

- 从 `<pre dangerouslySetInnerHTML>` + `whitespace-pre-wrap` + `font-mono` 改为 `<div class="reading-body" dangerouslySetInnerHTML>`
- 服务端 `extractPreHtml` 已把 `<br>`/`<p>` 转成 `\n`，**不动服务端**；前端渲染前处理 `\n`（见下）
- 站内链接点击拦截逻辑（`/read/`、`/book/`，`article-view.tsx:11-23`）原样迁移到新容器
- 移除 `whitespace-pre-wrap`

### `\n` → 换行与段落间距

- 连续空行 `\n\n+` → 段落块（或 `<br><br>` + `.reading-body` 段间距），保留段落感
- 单 `\n` → 软换行
- **安全**：只处理已转义文本中的字面 `\n`，禁止二次 `innerHTML` 解析用户内容（内容已由 `extractPreHtml` 清洗只含转义文本 + 站内锚点，`\n` 之外无歧义）

### 字体栈

`packages/ui/src/styles/globals.css` 新增 `--font-serif`，与现有 `--font-sans`/`--font-mono` 策略一致（离线安全、不引 web font）。多数 macOS 落到 Songti SC：

```css
--font-serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC",
              "PingFang SC", serif;
```

### 设置驱动（CSS 变量注入）

`ReadingSettingsProvider` 把设置映射成 CSS 变量挂到包裹元素（或 `document.documentElement`；变量只被 `.reading-body` 消费，列表页不会误用大字号）。`.reading-body` 消费：

```css
.reading-body {
  font-family: var(--reading-font);       /* serif | sans | mono */
  font-size: var(--reading-font-size);    /* px */
  line-height: var(--reading-line-height);
}
```

迁移时全局搜旧 `content-body` 类，避免残留 mono 样式。

### 栏宽——真正生效（review Must fix #1）

**问题**：原设计"`ArticleView` 内层 `style={{ maxWidth }}` 覆盖，不改 `PageShell`"无效——子元素 `max-width: 1024` 撑不破父级 `PageShell` 的 `max-w-3xl`（768），`wide` 对用户不可见。

**修订**：`maxWidth` 设置同时驱动**主栏容器与顶栏对齐**，二者复用同一宽度 token：
- `PageShell` 新增可选 `maxWidth` prop（如 `"normal" | "wide"`，默认 `normal`）；`<main>` 据此用 `max-w-3xl` / `max-w-4xl`
- Read/Book 页从 `useReadingSettings().maxWidth` 取值传给 `PageShell`
- `SiteHeader` 在阅读路由上同步该宽度（沿用其 `max-w-3xl`/`lg:max-w-4xl`），保持正文卡片与顶栏视觉对齐

> 决策（review open Q2）：`wide` 模式**同步放宽顶栏**，而非仅正文卡片变宽，避免错位。

### 测试

`apps/web` 无前端测试框架，本次也不引入（与项目现状一致）。排版正确性靠手动验证 + `bun run typecheck`/`build`。`extractor.test.ts` 因不动 extractor 而不受影响。

## §3 阅读进度记忆（按文章记进度）

### Schema 迁移（review Must fix #2）

**问题**：原设计写"在 `ensureSchema` 内幂等执行加列"，但 `packages/core/src/storage/db.ts` 无 `ensureSchema` 符号，只有 `openDatabase` → `db.exec(DDL)`，DDL 是 `CREATE TABLE IF NOT EXISTS`——已有库不会重跑列定义。

**修订**：在 `openDatabase` 的 `CREATE` 之后走幂等 `ALTER`：

```ts
const cols = db.query("PRAGMA table_info(items)").all()
if (!cols.some((c) => c.name === "read_progress")) {
  db.exec("ALTER TABLE items ADD COLUMN read_progress REAL")
}
```

列约定：
- `NULL` = 从未记录进度
- `0.0`–`1.0` = 有效进度
- `PUT` 端点校验并 clamp 到 `[0, 1]`
- `getState` 与 me 列表 SELECT 补 `read_progress` 字段
- `store.test.ts` 覆盖迁移后读写与删除历史连带清进度

### 数据流

前端滚动 → 防抖采样 → 写后端 → 重开读取恢复。

### 读取进度 hook

新文件 `apps/web/src/hooks/use-reading-progress.ts`：

- 监听 `scroll`，UI 采样防抖 ~250ms，写库防抖 ~1.5s
- 进度 = `scrollY / (scrollHeight - innerHeight)`，clamp 到 `[0, 1]`
- **短内容兜底**（review nit #12）：分母为 0（内容不足一屏）→ 跳过写入（不记 0 也不记 1），避免误标
- 顶部 = 0，到底 = 1（视为读完）

### 持久化（文章级，走后端）

- 新端点 `PUT /api/me/progress` body `{ kind, id, progress }` → 写 `items.read_progress`
- 读：`/api/me/state?kind=&id=` 已存在（`item-actions.tsx:19-38` 的 `useItemState`），**补返回 `progress` 字段**即可，文章页已加载，顺带取回，无需新读端点

### 写入与行生命周期（review Should resolve #7）

- `setProgress`：item 不存在 → **404**（与 tags/favorites 一致），不 upsert 占位行
- 前端**仅在 content 加载成功后**才挂 scroll hook（保证 item 已被 `recordVisit` 创建）
- `recordVisit` 的 `ON CONFLICT` **不得重置 `read_progress`**

### 恢复位置（review Should resolve #8）

**恢复顺序写死**：settings ready → content HTML 挂载 → state.progress 就绪 → 双 rAF 或 `useLayoutEffect` 再 `window.scrollTo`，避免"先 mono 再 serif"导致的高度跳动。

- 若 `progress > 0.05`（避免刚打开就跳）才恢复
- 服务端内容纯清洗后 HTML、无图片，高度基本稳定
- **flush 机制**：以 React Router 的 cleanup / `useEffect` return 为主（SPA 内路由切换）；`beforeunload` 次要
- **Strict Mode 双 mount**：恢复逻辑不要连发两次

### "已读"标记（review Should resolve #5 + 决策 Q1）

**预查结论**：

| 响应                                       | visit_count | read_progress |
| ------------------------------------------ | ----------- | ------------- |
| `/api/me/history`、`/favorites`、`/items`  | 有          | 需补          |
| `/api/me/state`                            | 有          | 需补          |
| `/api/posts?mtid=`、browse、featured、picks | 无          | 无            |

**决策（review open Q1）**：
- **MVP**：只在 `/api/me/*` 列表（历史/收藏/按标签）与 Me 卡片上显示已读/进度；`visit_count > 0` 已成立（打开即 `recordVisit`），补 `read_progress` 后可显示进度
- **公开列表（首页/分类/搜索）不在 MVP 内加已读标记**——给共享缓存的公开列表 API 塞 per-user 字段会破坏 `LIST_CACHE_HEADERS` / 共享缓存语义
- 若后续首页也要：新增轻量批量查询 `GET /api/me/visited?ids=...`（或 `POST` body `{ kind, id }[] → { progress, visit_count }[]`），前端在 `PostCard` 层合并；**本次不做**

`PostCard` 已读标记为低调视觉（标题旁小圆点/"已读"灰字），不影响现有布局。

### 失效与清除（决策 Q4）

- `DELETE /api/me/history`（清空/删单条，`index.ts` 的 `/api/me/*` 分支）已会连带清进度——自然继承，无需额外处理
- **不加显式"标记读完/清除进度" UI**（YAGNI）；靠滚动覆盖：重新打开滚到顶部附近自然更新，滚到底设 1.0

### 后端测试（review nit #14）

必补：store 的 progress 读写、删除历史连带清进度、`getState` 字段。

## §4a Read 页章节导航（review Should resolve #6）

### 数据语义——`content.links` 不是章节 TOC

**预查结论**：`extractLinksFromDom` 只收集 `#content-section` 里 **pre 之外** 的 tid 链接，按 **tid 数值** 排序后重编号 `index`，再去重；正文内链接留在 content 中。

含义：
- 当前 tid **通常不在** `links` 里（与原 spec 防御性假设一致）
- `links` 语义是"扩展/相关帖"，非"本连载有序章节"；prev/next 用 tid 排序相邻项，对部分连载可用，对无关扩展链接会误导航
- 原 UI 文案"同类连载 · 第 N / M 章"过度承诺

### 定位算法（修订）

- `links` **不含**当前 tid 时，把**当前 tid 的数值**插入有序列表，找前后邻——而不是要求 links 含自身
- 无法解析数值、或 `links` 为空 → **整条导航条不渲染**
- 实现前用 2–3 个真实连载 tid 抓包确认 `links` 形态，把结论补进 plan

### UI 与文案（修订）

底部 `RelatedLinks` 上方加章节导航条，文案改为中性"相关章节"/"扩展导航"，**不写"第 N 章"**：

```
[ ← 上一章 ]          [ 下一章 → ]
            相关章节
```

**决策（review open Q3）**：有前或后任一邻时渲染导航条、只显示存在的那一侧按钮；完全无法定位（空/非数值）才整条隐藏。

### 键盘

`←` / `→` 切换章节。复用 `theme-provider.tsx:35-67` 的 input-guard 模式，并（review nit #13）：忽略 `meta/ctrl/alt` 与 `event.repeat`；对 prev/next `preventDefault`，避免"先滚一点再跳章"。

**导航行为**：`navigate(/read/:tid)`，走客户端路由（与现有 in-body 链接一致）。

## §4b Book 页补全目录（review Should resolve #9）

### 当前缺口

`BookContentResponse`（`types.ts:60-64`）只有 `{ title, content, meta:{author}, url }`，无章节列表。BookPage 无任何章节间导航。

### 类型——新增 `BookChapterLink`（review #9）

**不硬套 `ChapterLink`**（固定 `{ index, title, tid }`，而 Book 导航用 cid）。新增：

```ts
type BookChapterLink = { index: number; title: string; cid: string }
```

API 字段 `chapters?: BookChapterLink[]` 可选，保持向后兼容。

### 数据获取（本次唯一动 packages/core 解析逻辑的改动）

- `extractor.ts` 增加 `fetchBookChapters(cid)` 或扩展现有书籍抓取，从上游书库页解析章节列表
- **第一步为探查**：抓取真实书库页 HTML + 固化为 fixture（review 查证 #3 仍未探查）
- 探查后若结构复杂/不稳定 → **降级**：先只做 §4a，Book 目录留后续单独迭代

### API

`GET /api/books?cid=` 响应新增可选 `chapters: BookChapterLink[]` 字段（一次请求拿全）；是否拆单独端点实现时定。

### UI

- BookPage 加底部章节列表（复用 `RelatedLinks` 形态或新建 `<ChapterList>`）
- 加和 Read 页一致的 prev/next 导航条 + `←`/`→` 键盘
- 章节间用 `cid` 导航（`/book/:cid`）

### 测试影响

- `extractor.test.ts` 受影响——新增书籍目录解析**必须配测试**（用 fixture）
- 现有书籍抓取测试不能破
- 改 extractor 后必跑 `bun run test`（AGENTS.md 验证要求）
- §4b 独立 commit，失败可降级只交付 §4a

## 查证清单（review 预查结果）

| # | 问题                       | 预查结论                                   | 计划动作                              |
| - | -------------------------- | ------------------------------------------ | ------------------------------------- |
| 1 | 列表 API 是否带 visit/progress | me 列表有 visit_count、无 progress；公开列表皆无 | MVP 限 me 列表；公开列表用批量查询或放弃 |
| 2 | `content.links` 是否含当前 tid | 设计上不含（pre 外扩展链接）               | 插入排序找邻接，勿假设含 self         |
| 3 | 上游书库目录 HTML           | 未探查                                     | §4b 第一步为抓包 + fixture；失败降级  |

## 决策汇总（review open questions）

| Q | 决策 |
| - | ---- |
| 首页/分类已读标记 | MVP 只在 `/api/me/*` 列表；公开列表不加（破坏共享缓存） |
| 栏宽 wide 顶栏对齐 | 同步放宽顶栏，复用 `max-w-4xl`，与正文对齐 |
| §4a 单侧导航 | 有任一邻时渲染、显示该侧按钮；完全无法定位才整条隐藏 |
| 进度清除 UI | 不加，靠滚动覆盖（YAGNI） |

## 验证

每步完成后：

```bash
bun run test
bun run typecheck
bun run build
```

动到 extractor 时（仅 §4b）尤其要确保 `bun run test` 通过。
