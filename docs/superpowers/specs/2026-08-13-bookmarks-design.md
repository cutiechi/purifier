# 正文选区书签

日期：2026-08-13
状态：brainstorming 已通过；已按 `review.md` 修订；计划见 docs/superpowers/plans/2026-08-13-bookmarks.md

## 背景

Purifier 已有：

- **收藏**：整篇帖/书打星，列表在「我的」。
- **阅读进度**：滚动自动写入 `items.read_progress` / `last_chapter`，每篇（书则每章）一份，再打开恢复位置。
- **人物选区浮条**：仅当选区能规范化为人名时出现，用于标记人物。

缺的是：在正文里**主动钉多个位置**，用选中的句子当锚，可选写备注，从当前篇或「我的」跳回去。自动进度与收藏语义保持不变。

## 目标

1. 选中正文后可选 **书签** 或 **人物**；书签保存摘录 + 可选备注 + 当时滚动比例。
2. 当前篇/当前章有书签列表，点击定位到句子。
3. 「我的 → 书签」跨站列表，点进对应帖/章并自动定位。
4. 摘录在现正文中找不到时：仍打开该篇/该章，滚到保存的滚动比例，并标明「原文可能已变」。

## 非目标（YAGNI）

- 正文常驻高亮 / 把书签写入内容缓存 HTML。
- 书签文件夹、排序、按站点筛选列表。
- 模糊匹配摘录（允许少量改字）。
- 段落序号 / DOM 路径锚点。
- 导入备份 UI（现状只有 `GET /api/me/export`；本次只把书签写入导出 JSON）。
- 改发现页 / 首页的站点切换。

## 方案选择

**独立 `bookmarks` 表 + 摘录 `indexOf` 定位，失败回退滚动比例。**

- 否决：改缓存 HTML 插入 `<mark>`（`refresh=1` 会冲掉标记，且与「缓存只服务正文」冲突）。
- 否决：段落序号 / DOM 路径（清洗或上游一变全错；已选择失败回退滚动比例）。

## 信息架构：「我的」功能优先

「我的」先选功能，站点是条目属性，不是导航第一维。

- 栏目：`历史 | 收藏 | 标签 | 书签`。Tab 链接**不带** `?site=`。
- 历史 / 收藏 / 标签前端已经跨站拉数；本次去掉 Tab 上残留的站点参数，与书签同一套心智。
- 书签页**不**放 `PageSiteTabs`。每条展示「论坛 / 书库」标签。
- 发现页、首页、目录等仍用页内站点切换，不动。
- 创建书签时 `site` 仍从当前文章写入（定位与跳转需要），只是列表不以站点为先。

`GET /api/me/bookmarks` 全局列表默认跨站。查询参数 `site` 过滤本次不做。

## 架构

```
ReadPage / BookPage（正文 .reading-body）
   │  选区浮条：书签 | 人物
   │  篇内书签列表
   ▼
POST/PATCH/DELETE /api/me/bookmarks
GET  /api/me/bookmarks?kind=&id=&chapter=
   ▼
Store.bookmarks  （挂 items，不改 read_progress）

Me → /bookmarks
   GET /api/me/bookmarks   （跨站，分页）
   卡片带 site 属性；点击 /read/:tid?bm= 或 /book/:cid?chapter=&bm=
```

定位只在前端：用 `quote` 在 `.reading-body` 纯文本里 `indexOf`；命中则滚到对应 Range；未命中则按 `scrollProgress` 滚并标 stale。不改清洗后的缓存 HTML。

## 数据模型

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  item_id TEXT NOT NULL,
  chapter INTEGER,
  quote TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  scroll_progress REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_item
  ON bookmarks (site, kind, item_id, chapter, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created
  ON bookmarks (created_at DESC);
```

**不建 FOREIGN KEY。** 级联删除由 store 的 `purgeItem` / `clearHistory` 显式 `DELETE` 完成，与 `favorites` / `tags` 相同。`purgeItem` 在删 `items` 之前先删该书签。

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `site`, `kind`, `item_id` | 挂到已有 `items` |
| `chapter` | 书库章号；论坛帖为 `NULL` |
| `quote` | 规范化后的选区摘录 |
| `note` | 可选短备注，空字符串表示无备注 |
| `scroll_progress` | 保存时滚动比例 `[0,1]` |
| `created_at` | 创建时间（unix ms） |

约束：

- 必须先有 `items` 行（阅读页 `recordVisit` 之后）。对象不存在 → 写接口 404。
- 同一篇/同一章允许多条；同一 `quote` 允许重复。定位时取正文**第一次**出现。用 `id` 区分条目。
- **每篇（书则每章）上限 50 条**，超出 409。
- `quote`：trim、把换行/制表符收成空格、折叠连续空白；最短 1 个可见字符，最长 200。规范化后为空 → 400。跨行选区可以保存，不套用人物名的「禁换行」规则。
- `note`：trim，最长 80；可空。
- `scroll_progress` clamp 到 `[0,1]`。
- 删历史条目 / 清空历史：在 store 里**级联删**该书签（与收藏/标签一致）。取消收藏、改标签不动书签。
- 书库创建必须带有限数字 `chapter`；论坛帖 `chapter` 省略为 `NULL`。

不向 `GET /api/me/state` 塞书签列表；阅读页用「当前篇」GET。

`GET /api/me/stats` 的 `inventory` 增加 `bookmarks`（书签行数）。有 `site` 时按站计数（表上有 `site` 列，与 `items`/`favorites` 相同）；省略 `site` 跨站。`StatsInventory`、`getStats`、统计页库存卡片一并加上。

## API

全部 `/api/me/bookmarks*`，`NO_STORE_HEADERS`。错误体 `{ "error": "..." }`。

同一个 `GET /api/me/bookmarks` 按 query **分流**，优先级写死：

1. `kind` 与 `id` **同时有值** → **当前篇**语义：返回 `{ items }`（不分页），忽略 `q` / `page`。论坛帖不要带 `chapter`；书库**必须**带有限数字 `chapter`，否则 400。无记录 `{ items: [] }`。
2. 只给了 `kind`、`id` 其中之一 → **400**。
3. 否则 → **全局跨站列表**：`q` 搜摘录/备注/文章标题；可选 `kind` 过滤帖/书；`page` 分页。每页 **20**（与 store `PAGE_SIZE` / 前端 `ME_PAGE_SIZE` 相同），不另暴露 `limit`。返回 `{ items, nextPage?, total }`，按 `created_at` 新→旧。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/me/bookmarks` | 见上方分流。 |
| `POST` | `/api/me/bookmarks` | body `{ kind, id, quote, site?, chapter?, note?, scrollProgress }`。`site` 默认 `"1"`。成功 `{ ok, bookmark }`。 |
| `PATCH` | `/api/me/bookmarks/:id` | 只改 `note`（可清空）。不存在 404。 |
| `DELETE` | `/api/me/bookmarks/:id` | `{ ok, removed }`。不存在 404。 |

列表项字段：`id, site, kind, itemId, title, chapter, quote, note, scrollProgress, createdAt`。`title` 从 `items` join。

状态码：

- 未访问过的条目：**写**接口 404。
- `quote` / `note` 非法、`scrollProgress` 非有限数字、书库缺 `chapter`、GET 只给了 `kind`/`id` 其一：400。
- 该篇/该章已满 50：409。

`GET /api/me/export` 的 JSON `version` 升到 **3**，增加 `bookmarks` 数组。`exportBackup` 返回类型字面量从 `{ version: 2, ... }` 改为 `{ version: 3, ..., bookmarks: ... }`；现有 `expect(bak.version).toBe(2)` 的测试改为 `3`。本次不新做导入端点。

`DELETE /api/me/history` 删 item 时级联删书签，无需新参数。

路由挂在 `apps/api/src/index.ts` 的 `route`；store 方法放在 `packages/core/src/storage/store.ts`。前端不解析 HTML。

## 界面

### 选区浮条

组件**改名**：`CharacterSelectionToolbar` → `ReadingSelectionToolbar`，文件 `apps/web/src/components/reading-selection-toolbar.tsx`。`ReadPage` / `BookPage` 的 import 与 JSX 同步改掉。

- 选区落在 `.reading-body` 且非折叠即出现（不再要求先通过 `normalizeCharacterName`）。
- 两个并列动作：**书签**、**人物**。
- 书签：摘录预览 + 可选备注 + 保存；保存时带上当前滚动比例（与阅读进度同一度量：`scrollY / (scrollHeight - innerHeight)`）。内容不足一屏时存 `0`。
- 人物：现有标记 / 挂靠 / 取消；选区不能当人名时**点击后再提示**，浮条不因此消失。
- Esc / 滚动 / 点空白关闭。

用于 `ReadPage` 与 `BookPage` 正文模式。

### 篇内列表

阅读页书签列表：摘录、备注、时间；可改备注、删除。点击一条按定位算法滚动。书库只列出**当前章**。

不在正文里插入常驻 mark。

### 「我的 → 书签」`/bookmarks`

- `ME_TABS` 增加「书签」；`useMeTabs` 的 `to` **不**走 `siteUrl`。
- `NAV_ITEMS` 里「我的」的 `match` 加上 `p === routes.bookmarks`，否则书签页顶栏「我的」不高亮。
- `apps/web/src/App.tsx` 注册路由。
- **不复用** `MeListPage` / `MeItemCard`：主文案是摘录，结构与历史/收藏卡片（主标题=文章标题）差太多。独立 `BookmarksPage` + 书签卡片。
- 卡片：摘录为主、次行备注 / 文章标题 / 站点 / 章号（若有）。
- 点击用现有 helper 带上 `bm`（不新增独立 path 函数）：
  - `readPath(tid, site?, bm?)` 增加可选第三参；
  - `bookPath(cid, { site?, chapter?, bm? })` 的 `opts` 增加 `bm`。
  有 `bm` 时写入 query `bm=<id>`（与 `site`/`chapter` 共存）。
- 可删除；搜索覆盖摘录、备注、标题。

### 打开定位

1. 正文 HTML 与目标书签都就绪后决策一次（按 `bm` id，换篇/换章重置）。
2. `bm` 对应当前篇/章列表中的一条才定位；id 不存在或属于别的篇/章则忽略，改走普通进度恢复。
3. 命中摘录：滚到 Range，**不**写 `items.read_progress`。
4. 未命中：`scrollTo` 保存的 `scrollProgress`，该条 UI 标「原文可能已变」；不自动删除。同样不写 `read_progress`。
5. **跳过进度恢复（页面层，方案 A）**：URL 带有效 `bm` 时，`ReadPage` / `BookPage` 把 `useReadingProgress` 的 `restore` 传 `null`，不把 `state.read_progress` 喂给 hook。hook 内不引入书签概念，也不加 `skipRestore`。
6. **进度条 UI**：程序化滚动通常不触发 `scroll`，定位结束后（命中或 stale 回退）调用 hook 新增的 `syncFromViewport()`：按当前视口重算比例，只更新进度条 state，**不** debounce 写库。无效 `bm` 时不调用，走普通进度恢复（hook 自己会 `setProgress`）。

进度条、收藏星标的**持久化**行为不变。

## 错误处理（前端）

- POST 404：提示先打开正文（正常阅读路径不会碰到）。
- 409：提示该篇/该章书签已满，需先删旧的。
- 400：展示服务端 `error`。
- 定位失败：stale 标记，书签保留。
- 写接口失败：不打断阅读；篇内列表保持乐观或回滚到上次成功 GET。

## 测试

`packages/core`（`bun test`）：

- store：创建/改备注/删除；item 不存在返回 false；每章/每篇上限 50；规范化 quote/note；论坛 `chapter NULL` vs 书库 chapter；`purgeItem` / `clearHistory` 级联；`exportBackup` version 3 含 bookmarks；`getStats().inventory.bookmarks` 计数（含 `site` 过滤）。
- API：上述 400/404/409；GET 分流（`kind`+`id` 当前篇忽略 page；只给其一 400；全局每页 20）；PATCH 清空 note。

定位若抽成纯函数：测命中第一次出现、未命中回退比例。不测浮条像素布局。

验证命令：`bun run test`、`bun run typecheck`、`bun run build`。

## 改动路径

- `packages/core/src/storage/db.ts` — 建表（无 FK）
- `packages/core/src/storage/store.ts` — CRUD、`purgeItem`/`clearHistory` 级联、`exportBackup` version 3、`getStats` inventory
- `packages/core/src/storage/types.ts` — `StatsInventory.bookmarks`
- `packages/core/src/storage/*.test.ts`
- `apps/api/src/index.ts` — `/api/me/bookmarks*`
- `apps/web/src/lib/routes.ts` — `routes.bookmarks`、`api.meBookmarks`、`ME_TABS`、`NAV_ITEMS.match`、`readPath`/`bookPath` 的 `bm`
- `apps/web/src/lib/hub-tabs.ts` — Me Tab 不带 site
- `apps/web/src/App.tsx` — 路由
- `apps/web/src/pages/BookmarksPage.tsx` — 新页（不复用 `MeListPage`）
- `apps/web/src/components/reading-selection-toolbar.tsx` — 由 `character-selection-toolbar.tsx` 改名，书签 | 人物
- `apps/web/src/hooks/use-reading-progress.ts` — `syncFromViewport()`（不感知书签）
- `apps/web/src/pages/ReadPage.tsx` / `BookPage.tsx` — 浮条、篇内列表、有效 `bm` 时 `restore=null`、定位后 sync
- `apps/web/src/pages/StatsPage.tsx` — inventory 书签卡片
- `AGENTS.md` — API 表与导航

## 已确认的产品决策

- 多位置选区书签，与自动进度、收藏分开。
- 选区后自选书签或人物。
- 摘录 + 可选备注；找不到原文则打开并按滚动比例，标 stale。
- 篇内列表 + 「我的」独立书签页。
- 论坛帖 + 书库章。
- 「我的」功能优先，站点是卡片属性。
- 全局书签列表每页 20，与历史/收藏一致。
- 有效 `bm` 时页面层跳过进度恢复；定位后只同步进度条 UI，不写库。
