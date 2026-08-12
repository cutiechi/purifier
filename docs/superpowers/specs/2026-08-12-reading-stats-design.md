# 阅读统计（时间序列）

日期：2026-08-12
状态：brainstorming 已通过；已按 `review.md` 修订（C1/C2/I1–I10）；待写实施计划

## 背景

`items` 表记录每条目的**最后一次访问**（`last_visited_at`）、首次出现（`first_seen_at`）、累计 `visit_count`、`read_progress`、`last_chapter`，但**没有逐次访问日志，也没有阅读时长**。前端只在 `MeItemCard` 逐条展示「{n} 次访问 / 已读 xx%」，`/me` 重定向到历史，没有任何聚合视图，`items` 里累积的访问与进度数据没有被汇总利用。

想做「真正的阅读统计」：累计阅读时长、每日活跃热力图、连读天数、阅读时段分布、时长 TOP 文章。

## 目标

1. 新增**阅读会话日志**，记录 _哪篇 / 哪天 / 哪个时段 / 读了多久_（仅页面可见时计时）。
2. **历史回填**：用 `items.first_seen_at` / `last_visited_at` 补「活跃日」标记，保留连读天数史与热力图密度，但**不伪造时长**。
3. **统计页 `/stats`**（顶栏一级导航项），服务端 SQL 一次聚合多 section 返回，前端纯渲染。
4. 会话日志进入 `/api/me/export` 备份（导出 key 为 `reading_sessions`，与表名 / `character_names` 风格对齐）。

## 非目标（YAGNI）

- 不做心跳式高精度计时（可见时计即可接受「可见但人不在」的少量高估）。
- 会话表**不存 `chapter`**（`items.last_chapter` 已有；v1 不做按章节统计）。
- 不做会话表**自动清理/过期**（个人本地库，行数可控）。
- 不提供**「清空统计 / 删会话」API**（会话不随清历史级联删，见「清历史与生命周期」）。
- 不做**客户端时区修正**（v1 假设服务端 TZ == 用户本地 TZ，见「时区」）。
- 不做正文内搜索、阅读目标/打卡提醒、社交分享、导出图片、flush 失败补传队列。

## 方案选择

**可见时计 + sendBeacon 分段提交**：

- 挂载起算，仅 `document.visibilityState === "visible"` 时累加秒数。
- `visibilitychange→hidden`、`pagehide`、组件卸载、以及每 60s 周期，用 `navigator.sendBeacon`（不可用时回退 `fetch(..., { keepalive: true })`）提交一段 `{ startedAt, durationS }`。
- **每次提交 = 一条「阅读段」行**；分段累加 = 真实时长，崩溃最多丢最后 ≤60s 一段。
- 否决：① 心跳法（写入频繁、服务端要二次聚合）；② 起止时间戳求差（后台标签 / 人离开都计时，严重高估）。

**服务端聚合**：`GET /api/me/stats` 一次返回所有 section，前端只渲染。SQLite 本地聚合足够快、往返少、API 干净。
- 否决：把原始会话拉到前端算（数据量大、按天/按时段分桶散到前端、时区处理复杂）。

## 架构

```
ReadPage / BookPage（仅正文就绪时；目录页不挂）
   │  useReadingSession({ site, kind, id, title, enabled })
   │  可见时计时 → sendBeacon 分段提交
   ▼
POST /api/me/sessions  ──►  Store.reading_sessions
                              (site, kind, item_id, title,
                               started_at ms, duration_s, estimated)

GET /api/me/stats?site=  ──►  服务端 SQL 聚合
   ▼
StatsPage（/stats，顶栏「统计」；站点控件 all | 1 | 2，默认 all）
   概览大数字 │ 每日热力图 │ 时段分布 │ 时长 TOP │ 最近阅读 │ 库存计数
```

## 数据模型

### 新表 `reading_sessions`

```sql
CREATE TABLE IF NOT EXISTS reading_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL DEFAULT '1',
  kind        TEXT    NOT NULL CHECK (kind IN ('post', 'book')),
  item_id     TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,            -- unix ms（UTC 绝对时间）
  duration_s  INTEGER,                     -- NULL = 回填的活跃日标记
  estimated   INTEGER NOT NULL DEFAULT 0   -- 1 = 回填，0 = 真实采集
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_item    ON reading_sessions (site, kind, item_id);
```

说明：

- `title` 冗余存储——即使 `items` 行被删除（清历史），统计仍能显示标题。
- `started_at` 存 UTC 毫秒（绝对）；**按天 / 按时段分桶在服务端按本地 TZ 换算**（见「时区」）。
- `duration_s NULL` = 回填的活跃日标记：**不进入「总时长」求和**，但在热力图 / 活跃天数 / 连读里算「当天有活动」。

### 回填迁移（幂等，仅首跑）

建表后，若 `reading_sessions` 为空且 `items` 非空，执行一次性回填（用 `SELECT count(*)` 判空，避免重复）：

- 对每条 `items`，取 `first_seen_at` 与 `last_visited_at`；**两者不同则各插一行，相同则只插一行**，`duration_s = NULL, estimated = 1, title = items.title, kind/site/item_id` 对齐。
- **不按 `visit_count` 插值**：每条 item 最多回填 1～2 个活跃日（first/last），高频重读用户的历史热力图仍偏稀——**可接受，不伪造数据**，避免评审/实现期再争论是否按 visit 伪造点。

### Store 新增域（对齐现有 `store.ts` 风格）

- `recordSession({ site, kind, itemId, title, startedAt, durationS })` → `INSERT`（真实采集路径 `durationS` 恒 ≥ 3；NULL 只由回填迁移产生，不走此方法）。
- `getStats({ site? })` → 聚合返回各 section（见下）。
- `exportBackup` 增加导出 `reading_sessions` 全表行（key 名 `reading_sessions`）。

## 时区（关键细节）

- `started_at` 存 UTC 毫秒；「日」边界以**服务端本地时区**为准（SQL `date(started_at / 1000, 'unixepoch', 'local time')` 取本地日期、`strftime('%H', started_at / 1000, 'unixepoch', 'local time')` 取本地小时）。
- **假设**：自托管个人机 / Docker 容器的 `TZ` 与用户一致。**落地（不只「提示」）**：
  - `Dockerfile` 增 `ENV TZ=Asia/Shanghai`（或 build-arg 注入）；AGENTS.md 环境变量表补 `TZ` 行。
  - 若不一致，跨日的连读 / 热力图会错位一格。
- v1 不做客户端时区修正（YAGNI）。未来若多用户 / 异地部署，再让客户端 flush 时附 `tz_offset`、服务端按偏移分桶。

## API

### `POST /api/me/sessions`（写，`NO_STORE_HEADERS`）

body：

```json
{ "site": "1", "kind": "post", "id": "123", "title": "…", "startedAt": 1723000000000, "durationS": 42 }
```

校验：

- `kind ∈ {post, book}`、`site` 经 `resolveSite` 有效。
- `id` 走现有 `assertSafeId`（非法 → 400，与其它 `/api/me/*` 一致）。
- `title` 非空、`startedAt` 为有限数字且 `≤ now + 5m`（拒绝明显未来时间）。
- `durationS` 非负整数；**`< 3` 直接丢弃不写**（去噪）。
- **上界 clamp**：`durationS = min(durationS, 300)` 后写入。周期 flush 正常每段 ≤60s，但客户端 bug / 手工 POST 可能写入极大值，clamp 防止脏数据炸坏 summary / TOP / 热力档（超过 300s 的段压到 300s，仍 200 写入，与「60s 一段」叙事自洽）。
- 未知字段忽略。返回 `{ ok }`。

### `GET /api/me/stats?site=`（读，`NO_STORE_HEADERS`）

`site` 可选，默认跨站聚合；带 `site=1|2` 只算该站，过滤对 `summary / calendar / timeOfDay / topItems / recentSessions` 生效（`inventory` 见例外）。

```json
{
  "summary": {
    "totalDurationS": 0,       // sum(duration_s)，不含 NULL
    "currentStreak": 0,        // 连续活跃日（锚点今天，今天无活动则昨天；两天都无则 0）
    "longestStreak": 0,        // 历史最长连续
    "activeDays": 0,           // distinct 本地日（真实+回填都算）
    "thisWeekS": 0,            // 本周（周一起）时长
    "thisMonthS": 0,           // 本月时长
    "trackedSince": 1723…,     // min(started_at)
    "lastActiveAt": 1723…      // max(started_at)
  },
  "calendar": [                // 近 365 天，稀疏（仅有活动的天）
    { "date": "2026-08-12", "durationS": 120, "estimated": 0 }
  ],
  "timeOfDay": [0, 0, "…(共24)", 0],  // 长度 24，下标 = 本地小时，值 = 该小时时长 S
  "topItems": [                // 按 sum(duration_s) desc，前 10
    { "kind": "book", "site": "2", "id": "…", "title": "…", "durationS": 3600, "sessions": 12 }
  ],
  "recentSessions": [          // 最近 20 条真实段（started_at desc，且 duration_s IS NOT NULL）
    { "startedAt": 1723…, "durationS": 120, "kind": "post", "site": "1", "id": "…", "title": "…" }
  ],
  "inventory": {               // 现有各表 count，给页面增重
    "history": 0, "favorites": 0, "tags": 0, "groups": 0, "characters": 0
  }
}
```

聚合规则（写死）：

- **`calendar[].durationS`** = 该本地日 `sum(duration_s)`（NULL 当 0，不进总时长语义）。
- **`calendar[].estimated`** = `1` **当且仅当**该本地日不存在任何 `duration_s IS NOT NULL` 的行（纯回填日）；有真实段则为 `0`。热力图实色按 `durationS`，斜纹只标「仅有活跃标记、无时长」的日。
- **`recentSessions`** 只返回 `duration_s IS NOT NULL` 的真实段，避免 UI 出现「时长空」；回填行仍进热力图 / 活跃日。
- **`topItems[].title`** = 该 `(site, kind, item_id)` 下 `max(started_at)` 那一段的 title（避免 SQLite `GROUP BY` 下 bare column 随机取值）。
- **`inventory` × site**：`groups` / `character_names` **无 `site` 列**（与角色高亮设计一致）。带 `site` 时：`history` / `favorites` / `tags` 按站 count；`groups` / `characters` **仍全局 count** 并在文档注明「不受 site 过滤」——不得实现成「site=2 时 groups 变 0」的假象。
- 聚合尽量在 SQL 内完成（`GROUP BY` 本地日期 / 小时、`sum` / `count`），service 层只组装 + 算 streak。

**连读定义**：取所有活跃日的本地日期集合（真实 + 回填都算），从今天（今天无活动则昨天）往回数连续天数 = `currentStreak`（今天与昨天都无活动则 0）；该集合的最长连续段 = `longestStreak`；集合大小 = `activeDays`。「本周（周一起）」「本月」边界在 SQL 与 JS 用同一规则（`weekday` 换算），单测固定假时钟。

## 前端

### `useReadingSession({ site, kind, id, title, enabled })` hook

放在 `apps/web/src/hooks/use-reading-session.ts`。

**启动门闩（与 `useReadingProgress` 的 ready 一致）—— 仅「有正文可读」才计时**：

- `ReadPage`：`enabled = loadedTid === tid`（当前 tid 正文已挂载；loading / error 壳上 `enabled=false`，不计时）。
- `BookPage`：`enabled = (isChapterBody || isCool18Book) && loadedKey === currentKey`；**`isToc`（书库目录页）`enabled=false`，不挂载 / 不计时长**。
- **换章 / 切正文**：靠 hook 依赖 `id` / `chapter`（或 `enabled`）变化 → 旧实例卸载 flush + 新实例挂载，避免目录↔正文切换漏 flush 或串计。

**计时与提交**：

- 维护 `accumulatedMs` 与 `segStartMs`（可见时为时间戳，不可见时为 `null`）。
- `visibilitychange`：变 hidden → 累加并 flush；变 visible → 置 `segStartMs = now`。
- 周期 `setInterval(60_000)`：累加并 flush（防崩溃丢数据）。
- `pagehide` + 卸载 cleanup：flush。
- **flush**：`durationS = round(accumulatedMs / 1000)`；若 `≥ 3`，POST `api.meSessions`，payload 含 `startedAt = segStartMs`（该段起点）、`kind/site/id/title`；之后重置 `accumulatedMs = 0`、`segStartMs = now`（visible 时）。`sendBeacon` 不可用回退 `fetch(url, { method: 'POST', body, keepalive: true, headers: {'Content-Type':'application/json'} })`。失败（配额 / 离线）静默丢弃该段，不阻塞阅读、不补传。
- **title 时序**：`title` 取自已加载正文（`content.title` / `book.bookTitle ?? book.title`），`enabled` 为真时必非空；title 变化**不重置计时**，只影响后续 flush 的 payload（首段用加载后的 title）。

挂载点：`ReadPage` 与 `BookPage` 各在正文上下文就绪后调用一次；同一次页面停留 = 一个 hook 实例。

### `routes.ts` / 导航

- `routes.stats = "/stats"`。
- `api` 增 `meSessions: "/api/me/sessions"`、`meStats: "/api/me/stats"`。
- `NAV_ITEMS` 增一项，**置于「我的」之后、「任务」之前**：

  ```ts
  { href: routes.stats, label: "统计", match: (p) => p === routes.stats }
  ```

- **不改 `ME_TABS`**——统计独立成页，不是「我的」子 Tab。
- mobile 顶栏若过挤，缩 label（非阻塞，实现期定）。

### `App.tsx`

注册 `/stats` → `lazy(() => import("./pages/StatsPage"))`，套 `RouteBoundary`（与其它路由一致）。

### `StatsPage.tsx`（`apps/web/src/pages/`）

- **站点控件契约（Critical）**：**不复用**会强制写 `?site=1|2` 的 `useSetSite`（`useSite()` 只认 1/2，无「全部」态）。StatsPage 用**专用控件**——扩展 `PageSiteTabs` 支持 `allowAll`，或页内本地控件——状态 `all | 1 | 2`，**默认 `all`**；`all` 时请求**不带** `site`（跨站聚合），`1 | 2` 时带 `site`。实施计划不得写「照抄其它页的 `PageSiteTabs`」而不改契约。
- `useEffect` fetch `api.meStats`（按控件状态决定是否带 `site`），`AsyncBody` 包加载 / 错误 / 空态。
- 板块（纯展示，**不引图表库**，div / SVG 手写 + Tailwind 4）：
  1. **概览大数字**：累计时长、当前连读、最长连读、活跃天数、本周 / 本月时长、记录始于。
  2. **每日热力图**：前端**自建近 365 天网格**（7×N，空日 `durationS=0` 也要渲染格子，不是「只画有数据的日」）；深浅 = 当日 `durationS`（分档或对数）；`estimated` 日加斜纹 / 描边区分；`title` 显示「日期 · 时长」。
  3. **时段分布**：24 根柱（或 0–6 / 6–12 / 12–18 / 18–24 四段），高度 = 该小时时长 S。
  4. **时长 TOP**：前 10 篇，条形 + 时长；点击 `readPath` / `bookPath` 进阅读页。
  5. **最近阅读**：最近 20 条真实段（时间 · 篇名 · 时长），可点进。
  6. **库存计数**：历史 / 收藏 / 标签 / 分组 / 角色五个小数字卡（取自 `inventory`）。
- `lib/format.ts` 增 `formatDuration(s)`（如 `3720 → "1h 2m"`、`90 → "1m 30s"`）。

## 边界与错误处理

- **归因规则（v1，写死）**：整段归因到 `started_at` 的本地日 / 小时，**不按墙钟在日界切分**。跨日连续读（23:50→00:10）：落在日界两侧的那一段整段计入起点日，最多偏 ≤60s 档。严格按墙钟跨日拆段 = YAGNI（要切就在 flush 时按本地日界拆两段，未来再做）。
- **清历史与生命周期**：`deleteItem` / `clearHistory` **不**级联删 `reading_sessions`（与冗余 title 一致——清历史后统计仍显示该篇时长）。v1 不提供「清空统计 / 删会话」API（非目标）。
- **空态判定**：以 sessions 为准（`trackedSince` / 有无真实段），**不因 `inventory.history = 0` 就显示「还没有阅读数据」**（清历史后天数 / 连读仍在）。
- **路由切换**：旧 hook 卸载 flush + 新 hook 挂载。React StrictMode dev 双挂载会多记一小段，仅 dev、生产单挂载；e2e 勿对累计秒数断言过紧。
- **极短停留**（<3s）：丢弃，不写。
- **sendBeacon 失败 / 离线**：静默丢该段，不阻塞、不补传（可选 `navigator.onLine === false` 时直接 skip，非必须）。

## 测试（`packages/core`，`bun test`）

- `recordSession`：正常插入、`<3s` 不写、`>300s` clamp 到 300、字段校验（`id` 走 `assertSafeId`）、`startedAt` 未来时间拒绝。
- `getStats`：固定时间戳构造 sessions，断言：`summary`（`totalDurationS` 忽略 NULL、`currentStreak` / `longestStreak` / `activeDays`）、`calendar` 按本地日分桶、**混合日 `estimated`**（同日真实+回填 → `estimated=0`）、`timeOfDay` 按本地小时、`topItems` 排序且 **title = `max(started_at)` 段的 title**、`recentSessions` 只含真实段、`site` 过滤生效。
- **`inventory` × site**：带 `site` 时 `groups` / `characters` 仍全局、`history` / `favorites` / `tags` 按站。
- 回填：空表 + `items` 非空 → 生成 `estimated=1` 行；非空表不重复回填。
- `exportBackup` 含 `reading_sessions` 行。
- **目录页不写 session**：store 层无直接关联，落在前端手工验收清单（`isToc` 时 `enabled=false`）。

## 改动面（I9）

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/storage/db.ts` | `reading_sessions` DDL + 索引 |
| `packages/core/src/storage/store.ts` + `*.test.ts` | `recordSession` / `getStats` / 回填 / `exportBackup` 增项 + 测试 |
| `apps/api/src/index.ts` | `POST /api/me/sessions`、`GET /api/me/stats` 路由分支 |
| `apps/web/src/lib/routes.ts` | `routes.stats`、`api.meSessions` / `api.meStats`、`NAV_ITEMS` 增「统计」 |
| `apps/web/src/App.tsx` | 注册 `/stats` → `StatsPage`（`RouteBoundary`） |
| `apps/web/src/hooks/use-reading-session.ts` | 新增 hook（可见时计 + sendBeacon 分段） |
| `apps/web/src/pages/ReadPage.tsx` / `BookPage.tsx` | 正文就绪后挂 hook（目录页 `enabled=false`） |
| `apps/web/src/pages/StatsPage.tsx` + 组件 | 统计页 + 站点控件（`all\|1\|2`，不复用 `useSetSite`） |
| `apps/web/src/lib/format.ts` | `formatDuration` |
| `Dockerfile` | `ENV TZ=…` |
| `AGENTS.md` | API 表两行（`POST /api/me/sessions`、`GET /api/me/stats`）+ 环境变量表 `TZ` |

## 验证

```bash
bun run test
bun run typecheck
bun run build
```
