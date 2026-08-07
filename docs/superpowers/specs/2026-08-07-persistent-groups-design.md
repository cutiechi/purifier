# 持久化分组 · 搜索相似 · 收藏分组 设计

- 日期：2026-08-07
- 状态：待评审（v2，已据 review 修订）
- 范围：`packages/core`（存储）+ `apps/api`（接口）+ `apps/web`（前端）

## 1. 背景与问题

上一轮「同书章节折叠」（`book-groups.ts`）实现的是**纯前端启发式分组**：`parseListTitle(raw).title` 归一化后精确同名 ≥2 条 → 折成 `CollapsibleBookGroup`。它有两个天然局限：

1. **分组不全**：标题写法有差异（错别字、续作、第二部等）的书，章节各自成为 single，折叠识别不出来，用户无法手动补全。
2. **分组不持久**：折叠组是渲染期临时产物，刷新/换页即消失；没有任何"用户维护的分组集合"概念。

用户需求：

- **搜索相似**：根据（折叠组的 / 单条帖子的）书名调用现有搜索能力，找到相似帖子，把它们加进分组。
- **收藏分组**：分组本身成为可收藏的独立实体，收藏页能看到已收藏的分组并展开查看成员。

决策（经与用户确认）：

- 分组**持久化**到 SQLite（新表），不沿用"纯前端临时组"。
- 新增「分组」页面（导航项）作为持久化分组的集中管理入口。
- **分组作为独立收藏实体**：收藏的是分组本身，不逐条收藏成员。
- 分组只收录**论坛帖子**（`kind=post, site=1`）。
- 「搜索相似」入口放在：分组页每个分组上 + **各处自动折叠组与单条帖子上**，点击后**原地展开搜索结果**，不跳转分组页。

## 2. 目标与非目标

### 目标

- 持久化分组：用户可创建、增删成员、删除分组。
- 搜索相似：按书名关键词搜上游（复用 `GET /api/browse?q=`），逐条「加入本组」；折叠组加成员时自动把现有折叠成员并入新组。
- 收藏分组：分组可收藏/取消收藏，收藏页展示已收藏分组（展开看成员、可取消收藏）。
- 覆盖折叠组出现的所有页面（Home / Browse / Search / Featured / Picks PostList 路径 / Trending / Comments / 历史 / 收藏 / 标签），以及单条帖子。

### 非目标（YAGNI）

- 不做模糊标题合并 / 系列识别；组 key 仍来自前端同一套 `normalizeTitleKey(parseListTitle(title).title)`。
- 分组不支持标签、进度、重命名、成员排序（成员按 `added_at` 升序）。
- 不把组 key 的归一化逻辑搬到服务端（保持前端单点，服务端只认不透明 key）。
- 搜索相似 v1 只展示第一页搜索结果。
- xbookcn（`site=2`）不参与分组与搜索相似。
- 不清空历史时级联删除分组（历史删除只清理 `items/favorites/tags`，与分组无关）。

## 3. 数据模型（SQLite）

`packages/core/src/storage/db.ts` 的 `DDL` 追加（`CREATE TABLE IF NOT EXISTS`，无需重建迁移）：

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,      -- 书名归一化键（前端 normalizeTitleKey 算好随请求传入）
  title TEXT NOT NULL,           -- 显示书名（去章节标记）
  author TEXT,                   -- 组内首个非空作者快照（客户端算好传入）
  genre TEXT,
  favorited INTEGER NOT NULL DEFAULT 0,   -- 分组作为独立收藏实体
  favorited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_items (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  tid TEXT NOT NULL,             -- 论坛帖 tid（仅 site=1 的 post）
  title TEXT NOT NULL,           -- 加入时的标题快照（离线可渲染）
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, tid)    -- 天然去重
);
```

要点：

- **key 由前端计算传入**（`normalizeTitleKey(parseListTitle(title).title)`），服务端当不透明唯一标识；`UNIQUE` 约束保证同名书只有一组。**不修改服务端，后端不做标题解析**（`parseListTitle` 是 150+ 行正则，避免双份维护）。
- `author` / `genre` 是展示快照：客户端在创建时用 `pickHeaderMeta` 同款逻辑（组内首个非空）算好随 `PUT` 传入；服务端仅在组为新建或对应字段为空时写入。
- 收藏状态在 `groups` 表上（`favorited` 列），与逐条 `favorites` 表无关。
- 清空历史（`DELETE /api/me/history?all=1`）**不触碰** `groups` / `group_items`。
- **外键级联**：`openDatabase` 每次连接执行 `PRAGMA foreign_keys = ON`（当前只开了 WAL；SQLite 默认关 FK，不开则 `ON DELETE CASCADE` 不生效，删 `groups` 会留孤儿 `group_items`）。同时 `deleteGroup` 与「空组自动删」在 store 层事务内**显式** `DELETE FROM group_items WHERE group_id=?` 再删 `groups` 行，行为不依赖 FK；单测锁死「删组后 `group_items` 为空」。
- **有意不设 site 列**：v1 分组只收录 cool18 论坛帖（`site=1` 的 post），表结构硬编码该语义；未来扩站需迁移（YAGNI）。

## 4. API

### 新接口（全部走 `/api/me/*` 惯例，`NO_STORE_HEADERS`）

| 方法 / 路径 | 行为 |
| --- | --- |
| `GET /api/me/groups?q=` | `{ groups: Group[] }`，按 `updated_at DESC`；`q` 按 `title` LIKE 过滤；每个 group 内嵌 `items`（按 `added_at` 升序） |
| `PUT /api/me/groups` | body `{ key, title, items: [{ tid, title }], author?, genre? }` → 按 key upsert，`INSERT OR IGNORE` 并入成员 → `{ ok, group }` |
| `DELETE /api/me/groups/:id` | 删除分组（级联成员）→ `{ ok }`；id 不存在返回 `{ ok: true }`（幂等） |
| `DELETE /api/me/groups/:id/items` | body `{ items: [{ tid }] }` → 移除成员；若组变空自动删组 → `{ ok, deleted: boolean }` |
| `PUT /api/me/groups/:id/favorite` | 收藏整个分组（置 `favorited=1`, `favorited_at=now`）→ `{ ok }`；组不存在 404 |
| `DELETE /api/me/groups/:id/favorite` | 取消收藏（置 `favorited=0`）→ `{ ok }`；组不存在 404 |

### 类型

```ts
interface GroupMember { tid: string; title: string }

interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}
```

### PUT 语义（upsert，事务内）

```sql
BEGIN;
INSERT INTO groups (key, title, author, genre, favorited, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
ON CONFLICT(key) DO UPDATE SET
  title      = excluded.title,
  author     = COALESCE(groups.author, excluded.author),
  genre      = COALESCE(groups.genre,  excluded.genre),
  updated_at = excluded.updated_at;
INSERT OR IGNORE INTO group_items (group_id, tid, title, added_at) VALUES (...);
COMMIT;
```

- 同 key 并发两次 `INSERT` 由 `UNIQUE(key)` + `ON CONFLICT(key) DO UPDATE` 收敛为同一组（单连接串行、事务内安全）。
- `title` 随每次 upsert 刷新（客户端每次算出的展示书名一致，覆盖无害）；**已存在成员不更新** `title` / `added_at`（`INSERT OR IGNORE` 保持首次快照）。
- `items` 至少 1 条，否则 400（不允许建空组）。
- `updated_at` 在成员增删（`PUT /api/me/groups`、`DELETE .../items`）时更新；纯收藏切换只写 `favorited` / `favorited_at`，不动 `updated_at`。

### 校验

- `PUT /api/me/groups`：`key` / `title` 为非空 string（`key` ≤ 128，`title` ≤ 512）；`items` 为 `{ tid, title }[]` 且非空；`tid` 非空且 `/^[A-Za-z0-9]+$/`、≤ 64（对齐现有 `meIdParam`）；`title` ≤ 512；不合规 400。
- `:id` 为纯数字；`DELETE .../items` body `{ items:[{tid}] }`，每项校验同上。
- 取消收藏（`DELETE .../favorite`）：`favorited = 0` **且** `favorited_at = NULL`（不留脏时间戳；收藏时两者一起写）。
- 错误体沿用 `{ "error": "..." }`；未知错误 500。

### 路由算法

API 现为 `switch (pathname)` 精确匹配。分组子资源放在 `switch` **之前**独立前缀分支：

1. `pathname === "/api/me/groups"` → GET 列表 / PUT upsert（其余方法 405）；
2. 否则匹配 `^/api/me/groups/(\d+)(?:/items|/favorite)?$` → 对应删除 / 收藏切换；方法不符 405；
3. 未匹配 → 落入现有 404 分支（`/api/*` 已在 API 层，不与 SPA fallback 混淆）。

### 容量假设

个人分组量小，v1 全量返回（预期组数 ≪ 100、每组成员 ≪ 200），不设分页；未来超限再加 `LIMIT` / 分页，不改前端协议。

### 不改

- `GET /api/me/favorites` 响应**不变**。收藏页"已收藏分组"由前端单独拉 `GET /api/me/groups` 后按 `favorited` 过滤渲染（组量少、独立实体，混入分页 items 会带来分页语义混乱，故用独立区块）。

## 5. 前端设计

### 5.1 共享类型与 helper（`apps/web/src/lib/groups.ts`）

```ts
export interface GroupMember { tid: string; title: string }
export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}

/** 组 key 与折叠分组同源；复用 book-groups 的 normalizeTitleKey（已导出） */
export function groupKeyFromTitle(rawTitle: string): string {
  return normalizeTitleKey(parseListTitle(rawTitle).title)
}

/** 展示作者/题材：别名复用 book-groups 导出的 pickHeaderMeta（组内首个非空） */
export const pickGroupMeta = pickHeaderMeta
```

要点：

- **复用而非复制**：`normalizeTitleKey`（已导出）、`stripTrailingChapterMarker` 与 `pickHeaderMeta`（后两者现为模块私有）从 `book-groups.ts` **导出**，`groups.ts` 只做一行组合，避免归一化逻辑分叉。展示用 `title` 也走 `stripTrailingChapterMarker`，与折叠组头一致。
- **API 常量只放 `routes.ts`**（`api.meGroups = "/api/me/groups"`），不在 `lib/groups.ts` 重复导出，避免漂移。
- **类型策略**：core 不导出 `Group` 类型；前端自持 `Group` / `GroupMember`，与 core 序列化结果结构兼容即可（个人项目，接受轻微重复）。

### 5.2 共享组件 `SimilarSearchPanel`（`apps/web/src/components/similar-search-panel.tsx`）

职责：`搜索相似` 触发按钮 + 展开后的搜索结果 + 逐条「加入本组」。

```ts
function SimilarSearchPanel({
  title,          // 展示书名（已 strip 章节标记），作为搜索关键词；不用 raw 整行
  groupKey,       // 分组 key（注意：不能用 React 保留 prop 名 `key`）
  seedItems,      // 创建分组时的初始成员（折叠组现有成员 / 单条自身 / 分组页现有成员）
  knownTids,      // 判定「已加入」的 tid 集合（数据流见下）
  onChanged,      // 加入成功后回调（刷新分组列表等）
}: { title: string; groupKey: string; seedItems: GroupMember[]; knownTids: Set<string>; onChanged?: () => void })
```

行为：

- 点击触发 → 首次展开时 `GET /api/browse?q=<title>&site=1`（page 1）；loading / error / 空态齐全。**搜索词 = 展示书名**（`g.title` / `parseListTitle(raw).title` 再 strip 章节标记），带章节号/作者尾巴的 raw 会降低命中，不传。
- 结果行复用 `ListPostCard` 视觉（`parseListTitle` 拆主/副标题），行尾按钮：未加入 →「加入本组」；`knownTids` 命中 →「已加入」禁用。
- 点「加入本组」→ `PUT /api/me/groups`，body 为 `{ key: groupKey, title, items: [...seedItems, { tid, title }] }`（幂等：重复并入被 PK 去重）。成功后该 tid 本地标记「已加入」，用响应 `group.items` 刷新缓存，并触发 `onChanged`。

**`knownTids` 数据流（核心，避免假阴性）**：判定「已加入」以**服务端持久组为准**，不能只靠当前页折叠成员。组件维护 `Map<groupKey, Set<tid>>` 缓存：

1. 展开面板时若该 key 无缓存，`GET /api/me/groups` 全量拉一次，按 key 取该组 `items` 建缓存；
2. `knownTids = 缓存[key] ∪ seedItems.tids`（seedItems 覆盖当前页折叠成员）；
3. 首次成功 `PUT` 后用响应 `group.items` 合并更新缓存；
4. 收藏页 / 分组页的增删也会经 `onChanged` 刷新缓存。

> 折叠组场景：`seedItems` = 折叠组当前可见成员（首次加入时自动把原有章节并入新组，实现"补全"）。

### 5.3 分组页 `/groups`（新增 `apps/web/src/pages/GroupPage.tsx`）

- 导航新增「分组」（`NAV_ITEMS`，`sites: ["1"]`，放在「搜索」之后）；`routes.groups = "/groups"`（**复数**，与 `/api/me/groups` 对称）。
- `App.tsx` 与现有页面一致**同步 import** 注册 `<Route path="/groups" ...>`，不引入 React.lazy / 路由级懒加载（全仓无此模式，避免夹带无关改动）；注册位置在 catch-all `path="*"`（现指向 `HomePage`）之前，保持"具体路径在前"。
- 加载 `GET /api/me/groups`，渲染 `GroupCard` 列表：
  - 头部（复用 `CollapsibleBookGroup` 视觉）：书图标 + 书名 + 作者/题材 + `共 N 章` + ⭐收藏切换 + 展开箭头。
  - 展开区：成员行（`parseListTitle` 拆章节/作者副标题，链接 `/read/:tid`，行尾「移除」）→ `SimilarSearchPanel`（`seedItems`= 现有成员，`knownTids`= 现有成员 tid）→ 「删除分组」（confirm）。
  - 移除成员：`DELETE /api/me/groups/:id/items`；返回 `deleted: true` 则整组从列表移除。
  - 收藏切换：`PUT/DELETE /api/me/groups/:id/favorite`。
- 空态：「还没有分组，去列表页点『搜索相似』创建」。

### 5.4 各处接线「搜索相似」（原地展开，不跳转）

**折叠组**：`CollapsibleBookGroup` 增加可选 `similar?: { title, groupKey, seedItems, knownTids?, onChanged? }`。头部按钮下方渲染一行常驻副操作「搜索相似」（**兄弟节点**，头部是 `<button>`，避免按钮嵌套）。展开联动：副操作点击 → 内部 `showSimilar` state 置真，若 `!isExpanded` 则调用 `onToggle()` 展开；`SimilarSearchPanel` 渲染在**展开内容区内**（`showSimilar && isExpanded` 才可见），不放在 `isExpanded` 之外，避免布局分叉。

**单条**：新增包装组件 `SimilarPostCard`（包 `ListPostCard`）与 `SimilarMeItemCard`（包 `MeItemCard`），卡片下方渲染「搜索相似」行 + 面板。仅在 `site === "1"`（Me 路径再加 `kind === "post"`）渲染；空 key（无法成组）不渲染。

**涉及页面**（逐页机械接入，每个页面模式一致）：

| 页面 | 文件 | 分组 similar 来源 | 单条包装 |
| --- | --- | --- | --- |
| 首页 | `pages/HomePage.tsx` | `g.title` / `g.key` / 成员 | `SimilarPostCard` |
| 分类浏览 | `pages/BrowsePage.tsx` | 同上 | `SimilarPostCard` |
| 搜索 | `pages/SearchPage.tsx` | 同上 | `SimilarPostCard` |
| 精华 | `pages/FeaturedPage.tsx` | 同上 | `SimilarPostCard` |
| 扫文 | `components/picks-sections.tsx`（PostList 路径） | 同上 | `SimilarPostCard` |
| 人气榜 | `pages/TrendingPage.tsx` | 同上 | `SimilarPostCard` |
| 评论榜 | `pages/CommentsPage.tsx` | 同上 | `SimilarPostCard` |
| 历史/收藏/标签 | `components/me-list-page.tsx` | 同上（`MeItemCard` 子卡） | `SimilarMeItemCard` |

> `picks-sections.tsx` 的 chip 路径与折叠一致，不接入。`MeListPage` 只对 `kind === "post" && site === "1"` 的项加 similar。

### 5.5 收藏页「已收藏分组」区块（`pages/FavoritesPage.tsx`）

- **插入点**：`MeListPage` 已有 `toolbar` 插槽（kind 筛选与列表之间、`AsyncBody` **之外**），FavoritesPage 用它在满足 `q` 为空、`kind` 为空、`page === 1` 时渲染「已收藏的分组」区块——收藏列表为空时区块仍可见，不会被 `AsyncBody` 空态盖住。FavoritesPage 当前不读 searchParams，需补 `useSearchParams` 读 `q` / `kind` / `page`。
- **数据**：条件满足时额外拉 `GET /api/me/groups`，过滤 `favorited`；分组拉取失败显示独立 error，**不影响收藏列表主流程**（loading / 错误态与 `MeListPage` 解耦）。
- 每组一张 `FavoritedGroupCard`：头部（书图标 + 书名 + 共 N 章 + 取消收藏按钮），可展开成员（链接 `/read/:tid`）。展开态用组件本地 state。
- 取消收藏 → `DELETE /api/me/groups/:id/favorite` → 重新拉分组，区块即时更新。
- `MeListItem` 类型**不变**（分组不进 `items`，避免改 `MeListPage` 的分组折叠逻辑）。

## 6. 边界情况

1. 重复加入同一 tid → `INSERT OR IGNORE`（PK `(group_id, tid)`）去重，`added_at` 保持首次。
2. 移除最后一个成员 → 自动删组，返回 `{ ok, deleted: true }`，前端整组移除。
3. 删除已收藏的分组 → `favorited` 随行删除，收藏页区块同步消失。
4. 同名书多次「搜索相似 / 加入」→ 同一个 key → 合并进同一持久化分组。
5. `knownTids` = 服务端持久组成员 ∪ 当前页可见成员（见 §5.2 数据流）；已存在持久化成员不在当前页时 UI 已显示「已加入」，不会出现假阴性。
6. 搜索相似 v1 只展示第一页结果（`nextPage` 忽略）。
7. `normalizeTitleKey` 为空串的单条不渲染「搜索相似」（无法成组）。
8. 清空历史不删分组（分组独立于 `items/favorites/tags`）。
9. 并发/重复点击「加入本组」：`INSERT OR IGNORE` + `UNIQUE(key)` + `ON CONFLICT` 保证不重复建组、不重复成员。
10. 已存在成员不更新 `title` / `added_at`（`INSERT OR IGNORE` 保持首次快照；见 §4）。
11. 取消收藏后 `favorited_at` 置 NULL，不留脏时间戳（见 §4）。

## 7. 测试与验证

### 单测

`packages/core/src/storage/groups.test.ts`（`bun test`，沿用 `store.test.ts` 的 db 工厂；分组方法并入 `Store`）：

- `upsertGroup` 新建组含成员；同 key 二次 upsert 并入新成员、不重复（含 `ON CONFLICT(key)` 路径）；同 key 连续两次只落一组；
- 空 `items` 不建组（core 层不落库；API 层 400）；
- `removeGroupItems` 移除成员；移除最后成员自动删组并返回 `deleted: true`；
- `deleteGroup` 后 `group_items` 为空（锁死级联/FK 行为）；
- `setGroupFavorite` 置位/复位并持久化，取消收藏后 `favorited_at` 为 NULL；
- `listGroups` 返回 `favorited` 标志、内嵌成员、`q` 过滤、`updated_at DESC` 排序。

前端 `apps/web/src/lib/groups.test.ts`：

- `groupKeyFromTitle` 与折叠分组同源（`【X】`/`《X》`/`X` 同 key）；
- `groupKeyFromTitle` 与 `groupBooks` 对**同一 raw 列表**产出的 key 完全一致（黄金对照样例复用 `book-groups.test.ts`，含书名号/章节标记变体）；
- `pickGroupMeta` 取首个非空作者/题材。

### 验证命令

```bash
bun run test
bun run typecheck
bun run build
```

### 手动验证清单

- 首页折叠组「搜索相似」→ 原地展开结果 → 加入 → 分组页出现该组（含原折叠成员 + 新加入）；
- 单条帖子「搜索相似」→ 加入 → 新建分组；
- 分组页：展开成员 / 移除成员（移除最后一个整组消失）/ 删除分组（confirm）；
- 分组页星标收藏 → 收藏页出现「已收藏的分组」区块 → 取消收藏消失；
- 历史/收藏/标签页单条与折叠组的「搜索相似」入口；
- xbookcn（site=2）不出现「搜索相似」；
- 刷新后持久化分组与收藏状态保留。

## 8. 改动清单

### 新增

- `packages/core/src/storage/groups.test.ts` — 分组存储单测（分组方法并入 `Store`，测试沿用 `store.test.ts` 的 db 工厂）
- `apps/web/src/lib/groups.ts` — 类型 + `groupKeyFromTitle` / `pickGroupMeta`（复用 book-groups）
- `apps/web/src/lib/groups.test.ts` — 单测
- `apps/web/src/components/similar-search-panel.tsx` — 搜索相似面板
- `apps/web/src/components/similar-post-card.tsx` — 单条帖子包装
- `apps/web/src/components/similar-me-item-card.tsx` — Me 单条包装
- `apps/web/src/components/favorited-group-card.tsx` — 收藏页分组卡
- `apps/web/src/pages/GroupPage.tsx` — `/groups` 页（含 GroupCard 渲染）

### 修改

- `packages/core/src/storage/db.ts` — DDL 追加 `groups` / `group_items`；`openDatabase` 增加 `PRAGMA foreign_keys = ON`
- `packages/core/src/storage/store.ts` — `Store` 增加分组方法：`listGroups` / `upsertGroup` / `deleteGroup` / `removeGroupItems` / `setGroupFavorite`（与 history/favorites/tags 同一实例与 db 工厂）
- `apps/api/src/index.ts` — `/api/me/groups` 路由 + `^/api/me/groups/(\d+)(?:/items|/favorite)?$` 前缀匹配（放在 `switch` 前独立分支）
- `apps/web/src/lib/book-groups.ts` — 导出 `pickHeaderMeta` / `stripTrailingChapterMarker`（供 `groups.ts` 复用）
- `apps/web/src/lib/routes.ts` — `api.meGroups`、`routes.groups`、`NAV_ITEMS` 加「分组」
- `apps/web/src/App.tsx` — 同步注册 `/groups`（catch-all `*` 之前）
- `apps/web/src/components/collapsible-book-group.tsx` — 可选 `similar` prop + 副操作行 + `showSimilar` / `onToggle` 展开联动
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/BrowsePage.tsx`
- `apps/web/src/pages/SearchPage.tsx`
- `apps/web/src/pages/FeaturedPage.tsx`
- `apps/web/src/components/picks-sections.tsx`
- `apps/web/src/pages/TrendingPage.tsx`
- `apps/web/src/pages/CommentsPage.tsx`
- `apps/web/src/components/me-list-page.tsx`
- `apps/web/src/pages/FavoritesPage.tsx`（`toolbar` 区块 + `useSearchParams`）

> History / Tags 经由 `me-list-page.tsx` 接入，无需独立改文件。

### 不改

- `GET /api/me/favorites` 响应结构、extractor、`groupMeListItems`、`MeListItem` 类型、标题解析逻辑。
