# 阅读统计（时间序列）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增阅读会话日志（可见时计 + sendBeacon 分段），服务端一次聚合，前端独立统计页 `/stats`（顶栏一级导航）展示总时长 / 热力图 / 连读 / 时段 / TOP / 库存。

**Architecture:** `reading_sessions` 表（含 `estimated` 回填行）→ `Store.recordSession` / `getStats` → `POST /api/me/sessions`（写）+ `GET /api/me/stats`（聚合读）→ `useReadingSession` hook（挂 ReadPage/BookPage 正文就绪时，目录页禁用）→ `StatsPage`（站点控件 `all|1|2`，不复用 `useSetSite`）。

**Tech Stack:** Bun + `bun:sqlite`（core / api）、React 19 + React Router 7 + Tailwind 4（web）。无新依赖、无图表库（热力图 / 柱状手写 div/SVG）。

## Global Constraints

- Prettier：**无分号、双引号、printWidth 80、trailingComma "es5"**。
- TypeScript `strict`；`@/` 别名（web）、`@workspace/...` 跨包；API 只用 `Bun.serve`，不引 HTTP 框架。
- 上游 HTML 解析只在 `packages/core` 的 Extractor（本功能不触达上游）。
- 时区：`started_at` 存 UTC ms；「日 / 小时」按**服务端本地 TZ** 分桶；假设容器 `TZ` = 用户本地（Task 10 落地 Dockerfile `ENV TZ`）。
- 新类型加进 `packages/core/src/storage/types.ts` 即自动经 barrel 导出（`storage/index.ts` `export * from "./types"` → `core/src/index.ts` `export * from "./storage"`），无需改 barrel。
- 验证三件套：`bun run test`（core）、`bun run typecheck`、`bun run build`。前端 / API 无单测框架，以 typecheck + build + 手测为准；core 用 `bun:test`。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `packages/core/src/storage/db.ts` | `reading_sessions` DDL + 回填迁移 |
| `packages/core/src/storage/types.ts` | `ReadingSessionInput` / `StatsResult` 等类型 |
| `packages/core/src/storage/store.ts` | `recordSession` / `getStats` / `exportBackup` 增项 + 纯函数 `localDateStr` / `computeStreaks` |
| `packages/core/src/storage/store.test.ts` | 上述方法的测试 |
| `apps/api/src/index.ts` | `POST /api/me/sessions`、`GET /api/me/stats` 路由分支 |
| `apps/web/src/hooks/use-reading-session.ts` | 可见时计 + sendBeacon 分段提交 hook（新文件） |
| `apps/web/src/pages/ReadPage.tsx`、`BookPage.tsx` | 正文就绪后挂 hook（目录页 `enabled=false`） |
| `apps/web/src/lib/routes.ts` | `routes.stats`、`api.meSessions` / `api.meStats`、`NAV_ITEMS` 增「统计」 |
| `apps/web/src/App.tsx` | 注册 `/stats` → `StatsPage` |
| `apps/web/src/lib/format.ts` | `formatDuration` |
| `apps/web/src/pages/StatsPage.tsx` | 统计页 + `all|1|2` 站点控件 + 各板块（新文件） |
| `apps/web/src/components/stats-heatmap.tsx` | 近 365 天热力图（7×N 周对齐，新文件） |
| `Dockerfile` | runner 阶段装 tzdata + `ENV TZ` |
| `AGENTS.md` | API 表两行 + 环境变量 `TZ` |

---

## Task 1: `reading_sessions` 表 + 回填迁移

**Files:**
- Modify: `packages/core/src/storage/db.ts`（DDL 串 + 新迁移块）
- Test: `packages/core/src/storage/store.test.ts`（`openDatabase` 表清单用例 + 新回填用例）

**Interfaces:**
- Produces: `reading_sessions(id, site, kind, item_id, title, started_at, duration_s, estimated)`；迁移在 `openDatabase` 末尾、表空且 `items` 非空时回填 `estimated=1` 行。

- [ ] **Step 1: 更新表清单断言（先让它失败）**

在 `store.test.ts` 的 `creates items/favorites/tags/groups tables` 用例里，`expected` 数组在 `"jobs"` 与 `"tags"` 之间插入 `"reading_sessions"`：

```ts
expect(rows.map((r) => r.name)).toEqual([
  "archive_cursors",
  "archive_posts",
  "character_names",
  "favorites",
  "group_items",
  "groups",
  "items",
  "job_logs",
  "jobs",
  "reading_sessions",
  "tags",
])
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（表不存在，清单缺 `reading_sessions`）。

- [ ] **Step 3: 加 DDL**

在 `db.ts` 的 `DDL` 模板串里、`character_names` 表块之后、闭合反引号之前插入：

```sql
CREATE TABLE IF NOT EXISTS reading_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL DEFAULT '1',
  kind        TEXT    NOT NULL CHECK (kind IN ('post', 'book')),
  item_id     TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  duration_s  INTEGER,
  estimated   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_item    ON reading_sessions (site, kind, item_id);
```

- [ ] **Step 4: 运行测试，确认表清单通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: PASS（表清单用例通过）。

- [ ] **Step 5: 写回填迁移失败测试**

在 `store.test.ts` 新增用例：

```ts
test("backfills reading_sessions from items on reopen", () => {
  const dir = tempDir()
  const db1 = openDatabase(dir)
  const s1 = new Store(db1, () => 1000)
  s1.recordVisit("1", "post", "a", "A", "/read/a") // first=last=1000
  new Store(db1, () => 5000).recordVisit("1", "post", "a", "A", "/read/a") // last=5000
  db1.close()

  const db2 = openDatabase(dir) // 触发回填
  const rows = db2
    .query(
      "SELECT started_at, duration_s, estimated FROM reading_sessions ORDER BY started_at"
    )
    .all() as { started_at: number; duration_s: number | null; estimated: number }[]
  expect(rows).toEqual([
    { started_at: 1000, duration_s: null, estimated: 1 },
    { started_at: 5000, duration_s: null, estimated: 1 },
  ])

  // 幂等：再次打开不重复回填
  db2.close()
  const db3 = openDatabase(dir)
  const n = (
    db3.query("SELECT COUNT(*) AS n FROM reading_sessions").get() as { n: number }
  ).n
  expect(n).toBe(2)
  db3.close()
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（回填未实现，行数为 0）。

- [ ] **Step 7: 实现回填迁移**

在 `db.ts` `openDatabase` 内、`group_items` 唯一索引块之后、`return db` 之前插入：

```ts
// 4. reading_sessions 回填：表为空且 items 非空时，按 first_seen_at / last_visited_at
//    补活跃日（duration_s NULL, estimated 1）。幂等：表非空跳过。不按 visit_count 插值。
const sessionsEmpty = (
  db.query("SELECT COUNT(*) AS n FROM reading_sessions").get() as { n: number }
).n
if (sessionsEmpty === 0) {
  const itemsCount = (
    db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number }
  ).n
  if (itemsCount > 0) {
    db.transaction(() => {
      const insert = db.query(
        `INSERT INTO reading_sessions (site, kind, item_id, title, started_at, duration_s, estimated)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1)`
      )
      const rows = db
        .query(
          "SELECT site, kind, id, title, first_seen_at, last_visited_at FROM items"
        )
        .all() as {
        site: string
        kind: string
        id: string
        title: string
        first_seen_at: number
        last_visited_at: number
      }[]
      for (const r of rows) {
        insert.run(r.site, r.kind, r.id, r.title, r.first_seen_at)
        if (r.last_visited_at !== r.first_seen_at) {
          insert.run(r.site, r.kind, r.id, r.title, r.last_visited_at)
        }
      }
    })()
  }
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add reading_sessions table and backfill"
```

---

## Task 2: `Store.recordSession` + 类型

**Files:**
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/store.ts`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Produces: `type ReadingSessionInput = { site: SiteId; kind: ItemKind; itemId: string; title: string; startedAt: number; durationS: number }`；`Store.recordSession(input: ReadingSessionInput): void`（`durationS<3` 丢弃、`min(.,300)` clamp）。

- [ ] **Step 1: 写失败测试**

`store.test.ts` 新增：

```ts
describe("recordSession", () => {
  function setup() {
    const dir = tempDir()
    const db = openDatabase(dir)
    const store = new Store(db)
    return { store, db, dir }
  }
  test("inserts a real segment", () => {
    const { store, db, dir } = setup()
    store.recordSession({
      site: "1",
      kind: "post",
      itemId: "a",
      title: "A",
      startedAt: 1000,
      durationS: 42,
    })
    const row = db
      .query(
        "SELECT duration_s, estimated FROM reading_sessions WHERE item_id='a'"
      )
      .get() as { duration_s: number; estimated: number }
    expect(row).toEqual({ duration_s: 42, estimated: 0 })
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  test("discards segments under 3s", () => {
    const { store, db, dir } = setup()
    store.recordSession({
      site: "1",
      kind: "post",
      itemId: "a",
      title: "A",
      startedAt: 1000,
      durationS: 2,
    })
    const n = (
      db.query("SELECT COUNT(*) AS n FROM reading_sessions").get() as {
        n: number
      }
    ).n
    expect(n).toBe(0)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  test("clamps duration over 300s", () => {
    const { store, db, dir } = setup()
    store.recordSession({
      site: "1",
      kind: "book",
      itemId: "b",
      title: "B",
      startedAt: 1000,
      durationS: 9999,
    })
    const row = db
      .query("SELECT duration_s FROM reading_sessions WHERE item_id='b'")
      .get() as { duration_s: number }
    expect(row.duration_s).toBe(300)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  test("sessions survive deleteItem (no cascade)", () => {
    const { store, db, dir } = setup()
    store.recordVisit("1", "post", "a", "A", "/read/a")
    store.recordSession({
      site: "1",
      kind: "post",
      itemId: "a",
      title: "A",
      startedAt: 10,
      durationS: 9,
    })
    store.deleteItem("1", "post", "a")
    const n = (
      db
        .query("SELECT COUNT(*) AS n FROM reading_sessions WHERE item_id='a'")
        .get() as { n: number }
    ).n
    expect(n).toBe(1) // 设计：清历史不级联删会话（冗余 title 保留）
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（`recordSession` 不存在）。

- [ ] **Step 3: 加类型**

`types.ts` 末尾（`CharacterName` 之后）加：

```ts
export interface ReadingSessionInput {
  site: SiteId
  kind: ItemKind
  itemId: string
  title: string
  startedAt: number
  durationS: number
}
```

- [ ] **Step 4: 实现 `recordSession`**

`store.ts`：在 import 块的类型列表加 `ReadingSessionInput`；在 `getState` 方法之后插入：

```ts
/** 记录一段真实阅读：durationS<3 丢弃（去噪），>300 clamp 到 300（防脏数据）。 */
recordSession(input: ReadingSessionInput): void {
  if (input.durationS < 3) return
  const durationS = Math.min(input.durationS, 300)
  this.db
    .query(
      `INSERT INTO reading_sessions (site, kind, item_id, title, started_at, duration_s, estimated)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)`
    )
    .run(input.site, input.kind, input.itemId, input.title, input.startedAt, durationS)
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/types.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add Store.recordSession"
```

---

## Task 3: `Store.getStats` 聚合 + 连读纯函数

**Files:**
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/store.ts`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `recordSession`（Task 2）、`reading_sessions`（Task 1）。
- Produces: 类型 `StatsSummary` / `StatsCalendarDay` / `StatsTopItem` / `StatsRecentSession` / `StatsInventory` / `StatsResult`；`Store.getStats(opts?: { site?: SiteId }): StatsResult`；模块级纯函数 `localDateStr(ms)` / `dayBefore(dateStr)` / `computeStreaks(dates, today)`。

- [ ] **Step 1: 加类型**

`types.ts` 末尾加：

```ts
export interface StatsSummary {
  totalDurationS: number
  currentStreak: number
  longestStreak: number
  activeDays: number
  thisWeekS: number
  thisMonthS: number
  trackedSince: number | null
  lastActiveAt: number | null
}

export interface StatsCalendarDay {
  date: string
  durationS: number
  estimated: number
}

export interface StatsTopItem {
  kind: ItemKind
  site: SiteId
  id: string
  title: string
  durationS: number
  sessions: number
}

export interface StatsRecentSession {
  startedAt: number
  durationS: number
  kind: ItemKind
  site: SiteId
  id: string
  title: string
}

export interface StatsInventory {
  history: number
  favorites: number
  tags: number
  groups: number
  characters: number
}

export interface StatsResult {
  summary: StatsSummary
  calendar: StatsCalendarDay[]
  timeOfDay: number[]
  topItems: StatsTopItem[]
  recentSessions: StatsRecentSession[]
  inventory: StatsInventory
}
```

- [ ] **Step 2: 写连读纯函数失败测试**

`store.test.ts` 顶部再 import `{ computeStreaks, localDateStr, dayBefore }`。新增：

```ts
describe("computeStreaks", () => {
  test("current streak anchors today, else yesterday", () => {
    const today = "2026-08-12"
    expect(
      computeStreaks(["2026-08-10", "2026-08-11", "2026-08-12"], today)
    ).toEqual({ currentStreak: 3, longestStreak: 3 })
    // 今天还没读 → 以昨天为锚
    expect(
      computeStreaks(["2026-08-10", "2026-08-11"], today)
    ).toEqual({ currentStreak: 2, longestStreak: 2 })
    // 今天和昨天都没有 → 0（历史最长仍算）
    expect(
      computeStreaks(["2026-08-01", "2026-08-09"], today)
    ).toEqual({ currentStreak: 0, longestStreak: 1 })
  })
  test("longest run independent of current", () => {
    expect(
      computeStreaks(
        ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-10", "2026-08-12"],
        "2026-08-12"
      )
    ).toEqual({ currentStreak: 1, longestStreak: 3 })
  })
})
```

- [ ] **Step 3: 运行，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（函数未导出）。

- [ ] **Step 4: 实现纯函数**

`store.ts` 文件顶层（`Store` class 之前、`normalizeTags` 之后）加：

```ts
/** 本地日期串 YYYY-MM-DD（按服务端本地 TZ） */
export function localDateStr(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD 的前一天 */
export function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/**
 * 连读：锚点为今天（今天无活动则昨天）；从锚往回数连续日。
 * longestStreak = 活跃日集合里最长连续段。activeDays 由调用方算（=集合大小）。
 */
export function computeStreaks(
  dates: string[],
  today: string
): { currentStreak: number; longestStreak: number } {
  const set = new Set(dates)
  const sorted = [...set].sort()
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const d of sorted) {
    run = prev !== null && dayBefore(d) === prev ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  let current = 0
  let cur = set.has(today) ? today : set.has(dayBefore(today)) ? dayBefore(today) : null
  while (cur !== null && set.has(cur)) {
    current++
    cur = dayBefore(cur)
  }
  return { currentStreak: current, longestStreak: longest }
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: computeStreaks 用例 PASS。

- [ ] **Step 6: 写 `getStats` 失败测试**

`store.test.ts` 新增（用本地日期构造时间戳，TZ 无关）：

```ts
describe("getStats", () => {
  function setup(nowMs: number) {
    const dir = tempDir()
    const db = openDatabase(dir)
    const store = new Store(db, () => nowMs)
    return { store, db, dir }
  }
  function at(year: number, month: number, day: number, hour = 12): number {
    return new Date(year, month - 1, day, hour).getTime()
  }
  test("summary ignores NULL, calendar estimated rule, timeOfDay, topItems title, site filter", () => {
    // “今天” 2026-08-12 12:00 本地
    const now = at(2026, 8, 12, 12)
    const { store, db, dir } = setup(now)
    // 回填行（历史活跃日，durationS NULL）：08-09 纯回填
    db.query(
      `INSERT INTO reading_sessions (site,kind,item_id,title,started_at,duration_s,estimated)
       VALUES ('1','post','old','Old',?1,NULL,1)`
    ).run(at(2026, 8, 9, 8))
    // I1 混合日：08-12 同时插回填行 + 真实段 → 该日 estimated 须为 0
    db.query(
      `INSERT INTO reading_sessions (site,kind,item_id,title,started_at,duration_s,estimated)
       VALUES ('1','post','old2','Old2',?1,NULL,1)`
    ).run(at(2026, 8, 12, 6))
    // 今天真实段：post a 读 60s @10:00，book b 读 120s @22:00
    store.recordSession({ site: "1", kind: "post", itemId: "a", title: "A", startedAt: at(2026, 8, 12, 10), durationS: 60 })
    store.recordSession({ site: "2", kind: "book", itemId: "b", title: "B", startedAt: at(2026, 8, 12, 22), durationS: 120 })
    // I2：groups 无 site 列，带 site 过滤时仍全局计数
    store.upsertGroup({ key: "k", title: "G", items: [{ tid: "g1", title: "GT" }] })

    const all = store.getStats()
    expect(all.summary.totalDurationS).toBe(180)
    // 活跃日：08-09（回填）+ 08-12（真实）→ 连读从今天回数，08-11/08-10 无 → currentStreak=1
    expect(all.summary.activeDays).toBe(2)
    expect(all.summary.currentStreak).toBe(1)
    expect(all.summary.longestStreak).toBe(1)
    expect(all.summary.trackedSince).toBe(at(2026, 8, 9, 8))
    expect(all.summary.lastActiveAt).toBe(at(2026, 8, 12, 22))
    // calendar：08-09 纯回填 estimated=1；08-12 混合（回填+真实）estimated=0、durationS=180
    const cal = Object.fromEntries(all.calendar.map((c) => [c.date, c]))
    expect(cal["2026-08-09"]).toEqual({ date: "2026-08-09", durationS: 0, estimated: 1 })
    expect(cal["2026-08-12"]).toEqual({ date: "2026-08-12", durationS: 180, estimated: 0 })
    // timeOfDay：下标 10=60，22=120
    expect(all.timeOfDay[10]).toBe(60)
    expect(all.timeOfDay[22]).toBe(120)
    // topItems：b(120) 在 a(60) 之前；title 取 max(started_at) 段
    expect(all.topItems[0]).toMatchObject({ id: "b", durationS: 120, title: "B" })
    expect(all.topItems[1]).toMatchObject({ id: "a", durationS: 60, title: "A" })
    // recentSessions 只含真实段
    expect(all.recentSessions.length).toBe(2)
    expect(all.recentSessions[0]).toMatchObject({ id: "b" })

    // site 过滤：site=2 只剩 b 的 120s
    const onlyBooks = store.getStats({ site: "2" })
    expect(onlyBooks.summary.totalDurationS).toBe(120)
    expect(onlyBooks.topItems.every((t) => t.site === "2")).toBe(true)
    // I2：groups 无 site 列 → 带 site=2 仍全局计数（setup 插了 1 个组）
    expect(onlyBooks.inventory.groups).toBe(1)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 7: 运行，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（`getStats` 不存在）。

- [ ] **Step 8: 实现 `getStats`**

`store.ts` import 类型块加 `StatsCalendarDay, StatsResult, StatsTopItem, StatsRecentSession, StatsInventory, StatsSummary`。在 `recordSession` 之后插入：

```ts
/** 统计聚合：summary / calendar(365d) / timeOfDay(24h) / topItems / recentSessions / inventory。 */
getStats(opts: { site?: SiteId } = {}): StatsResult {
  const site = opts.site
  // site 过滤片段 + 绑定助手：site 的 ? 始终在额外 cond 的 ? 之前
  const scoped = (cond: string) =>
    site
      ? `WHERE site = ?${cond ? ` AND ${cond}` : ""}`
      : cond
        ? `WHERE ${cond}`
        : ""
  const runScoped = <T>(sql: string, extra: unknown[] = []): T[] =>
    (this.db.query(sql).all(...(site ? [site] : []), ...extra) as T[])

  const sinceMs = this.now() - 365 * 86_400_000

  // calendar（近 365 天）
  const calRows = runScoped<{
    d: string
    s: number
    est: number
  }>(
    `SELECT date(started_at / 1000, 'unixepoch', 'local time') AS d,
            COALESCE(SUM(duration_s), 0) AS s,
            CASE WHEN SUM(CASE WHEN duration_s IS NOT NULL THEN 1 ELSE 0 END) > 0
                 THEN 0 ELSE 1 END AS est
     FROM reading_sessions ${scoped("started_at >= ?")}
     GROUP BY d ORDER BY d`,
    [sinceMs]
  )
  const calendar: StatsCalendarDay[] = calRows.map((r) => ({
    date: r.d,
    durationS: r.s,
    estimated: r.est,
  }))

  // 时段分布（24h）
  const todRows = runScoped<{ h: string; s: number }>(
    `SELECT strftime('%H', started_at / 1000, 'unixepoch', 'local time') AS h,
            COALESCE(SUM(duration_s), 0) AS s
     FROM reading_sessions ${scoped("duration_s IS NOT NULL")}
     GROUP BY h`
  )
  const timeOfDay = new Array(24).fill(0)
  for (const r of todRows) timeOfDay[Number(r.h)] = r.s

  // 时长 TOP（title = max(started_at) 那段；避免 GROUP BY bare column 随机）
  const topItems: StatsTopItem[] = runScoped(
    `SELECT kind, site, item_id AS id,
            (SELECT r2.title FROM reading_sessions r2
             WHERE r2.site = reading_sessions.site AND r2.kind = reading_sessions.kind
               AND r2.item_id = reading_sessions.item_id
             ORDER BY r2.started_at DESC LIMIT 1) AS title,
            COALESCE(SUM(duration_s), 0) AS durationS,
            COUNT(*) AS sessions
     FROM reading_sessions ${scoped("duration_s IS NOT NULL")}
     GROUP BY site, kind, item_id
     ORDER BY durationS DESC LIMIT 10`
  )

  const recentSessions: StatsRecentSession[] = runScoped(
    `SELECT started_at AS startedAt, duration_s AS durationS, kind, site,
            item_id AS id, title
     FROM reading_sessions ${scoped("duration_s IS NOT NULL")}
     ORDER BY started_at DESC LIMIT 20`
  )

  const sumDuration = (cond: string, extra: unknown[] = []): number =>
    (
      runScoped<{ t: number }>(
        `SELECT COALESCE(SUM(duration_s), 0) AS t FROM reading_sessions ${scoped(cond)}`,
        extra
      )[0] ?? { t: 0 }
    ).t

  const totalDurationS = sumDuration("duration_s IS NOT NULL")
  const range =
    runScoped<{ mn: number | null; mx: number | null }>(
      `SELECT MIN(started_at) AS mn, MAX(started_at) AS mx FROM reading_sessions ${scoped("")}`
    )[0] ?? { mn: null, mx: null }

  // 本周（周一起）/ 本月边界（本地）
  const now = new Date(this.now())
  const weekStartMs = (() => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dow = (d.getDay() + 6) % 7 // 周一=0
    d.setDate(d.getDate() - dow)
    return d.getTime()
  })()
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const thisWeekS = sumDuration("duration_s IS NOT NULL AND started_at >= ?", [
    weekStartMs,
  ])
  const thisMonthS = sumDuration("duration_s IS NOT NULL AND started_at >= ?", [
    monthStartMs,
  ])

  // 活跃日集合（真实+回填）→ streak / activeDays
  const dayRows = runScoped<{ d: string }>(
    `SELECT DISTINCT date(started_at / 1000, 'unixepoch', 'local time') AS d
     FROM reading_sessions ${scoped("")}`
  )
  const dates = dayRows.map((r) => r.d)
  const { currentStreak, longestStreak } = computeStreaks(dates, localDateStr(this.now()))

  // inventory：items/favorites/tags 按 site；groups/character_names 无 site 列 → 全局
  const countSite = (table: string): number =>
    site
      ? (
          this.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE site = ?`).get(site) as {
            n: number
          }
        ).n
      : (this.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const inventory: StatsInventory = {
    history: countSite("items"),
    favorites: countSite("favorites"),
    tags: site
      ? (
          this.db
            .query("SELECT COUNT(*) AS n FROM (SELECT DISTINCT tag FROM tags WHERE site = ?)")
            .get(site) as { n: number }
        ).n
      : (
          this.db.query("SELECT COUNT(*) AS n FROM (SELECT DISTINCT tag FROM tags)").get() as {
            n: number
          }
        ).n,
    groups: (this.db.query("SELECT COUNT(*) AS n FROM groups").get() as { n: number }).n,
    characters: (
      this.db.query("SELECT COUNT(*) AS n FROM character_names").get() as { n: number }
    ).n,
  }

  const summary: StatsSummary = {
    totalDurationS,
    currentStreak,
    longestStreak,
    activeDays: new Set(dates).size,
    thisWeekS,
    thisMonthS,
    trackedSince: range.mn,
    lastActiveAt: range.mx,
  }

  return { summary, calendar, timeOfDay, topItems, recentSessions, inventory }
}
```

- [ ] **Step 9: 运行测试，确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: PASS（含 getStats 全部断言）。

- [ ] **Step 10: 全量 core 测试 + 类型检查**

Run: `bun run test && bun run typecheck`
Expected: PASS / 无错误。

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/types.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add Store.getStats aggregation and streak helpers"
```

---

## Task 4: `exportBackup` 含 `reading_sessions`

**Files:**
- Modify: `packages/core/src/storage/store.ts`（`exportBackup` 返回类型 + 体）
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Produces: `exportBackup()` 返回多一个 key `reading_sessions: Array<{...全列}>`。

- [ ] **Step 1: 写失败测试**

```ts
test("exportBackup includes reading_sessions", () => {
  const dir = tempDir()
  const db = openDatabase(dir)
  const store = new Store(db)
  store.recordSession({ site: "1", kind: "post", itemId: "a", title: "A", startedAt: 7, durationS: 9 })
  const backup = store.exportBackup()
  expect(Array.isArray(backup.reading_sessions)).toBe(true)
  expect(backup.reading_sessions.length).toBe(1)
  expect(backup.reading_sessions[0]).toMatchObject({ item_id: "a", duration_s: 9 })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: FAIL（`reading_sessions` key 不存在）。

- [ ] **Step 3: 扩展 `exportBackup`**

`store.ts` `exportBackup` 返回类型加一行：

```ts
reading_sessions: Array<{
  id: number
  site: string
  kind: string
  item_id: string
  title: string
  started_at: number
  duration_s: number | null
  estimated: number
}>
```

体内 `character_names` 查询之后、`return {` 之前加：

```ts
const reading_sessions = this.db
  .query("SELECT * FROM reading_sessions ORDER BY started_at")
  .all() as Array<{
  id: number
  site: string
  kind: string
  item_id: string
  title: string
  started_at: number
  duration_s: number | null
  estimated: number
}>
```

返回对象里 `character_names,` 之后加 `reading_sessions,`。

- [ ] **Step 4: 运行，确认通过**

Run: `bun test packages/core/src/storage/store.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): include reading_sessions in exportBackup"
```

---

## Task 5: API 路由 `POST /api/me/sessions` + `GET /api/me/stats`

**Files:**
- Modify: `apps/api/src/index.ts`（import 类型 + 两个 handler + 两个 switch case）

**Interfaces:**
- Consumes: `Store.recordSession`、`Store.getStats`、`assertSafeId`、`resolveSite`、`ExtractorError`、`jsonOk`、`NO_STORE_HEADERS`。
- Produces: `POST /api/me/sessions`（body `{site?,kind,id,title,startedAt,durationS}` → `{ok}`，400 用 `ExtractorError`）；`GET /api/me/stats?site=` → `StatsResult`。两者 `NO_STORE_HEADERS`。

> API 层无单测框架（项目测试在 core）；本任务以 typecheck + build + 手测验证。

- [ ] **Step 1: 确认 import（无需新增）**

`recordSession` / `getStats` 经 core barrel 自动导出；`assertSafeId`、`resolveSite`、`ExtractorError`、`jsonOk`、`NO_STORE_HEADERS` 均已在 `apps/api/src/index.ts` 现有 import 列表。`recordSession` 的参数类型在调用处自动校验，无需引入 `ReadingSessionInput`。

- [ ] **Step 2: 加两个 handler**

在 `handleMeArchiveStatus` 之后（`handleMeExport` 之前）插入：

```ts
async function handleSessionsWrite(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") throw new ExtractorError("invalid json body", 400)
  const kindRaw = "kind" in body ? body.kind : undefined
  const idRaw = "id" in body ? body.id : undefined
  if (kindRaw !== "post" && kindRaw !== "book") {
    throw new ExtractorError("invalid kind", 400)
  }
  if (typeof idRaw !== "string") throw new ExtractorError("invalid id", 400)
  assertSafeId(idRaw)
  const site = "site" in body ? String(body.site) : "1"
  resolveSite(site) // 非法 site → ExtractorError(400)
  const titleRaw = "title" in body ? body.title : undefined
  if (typeof titleRaw !== "string" || titleRaw.trim() === "") {
    throw new ExtractorError("invalid title", 400)
  }
  const title = titleRaw.trim()
  const startedAt = "startedAt" in body ? body.startedAt : undefined
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt <= 0) {
    throw new ExtractorError("invalid startedAt", 400)
  }
  if (startedAt > Date.now() + 5 * 60_000) {
    throw new ExtractorError("startedAt in future", 400)
  }
  const durationS = "durationS" in body ? body.durationS : undefined
  if (typeof durationS !== "number" || !Number.isFinite(durationS) || durationS < 0) {
    throw new ExtractorError("invalid durationS", 400)
  }
  // <3 丢弃 / >300 clamp 在 store 层；不写则不算一次会话
  store.recordSession({
    site,
    kind: kindRaw,
    itemId: idRaw,
    title,
    startedAt,
    durationS: Math.floor(durationS),
  })
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function handleStats(url: URL): Response {
  const siteParam = url.searchParams.get("site")
  if (siteParam == null) return jsonOk(store.getStats({}), NO_STORE_HEADERS)
  resolveSite(siteParam) // 非法 site → ExtractorError(400)
  return jsonOk(store.getStats({ site: siteParam }), NO_STORE_HEADERS)
}
```

> 注：`resolveSite(id?): Extractor`，非法 id 抛 `ExtractorError(400)`；这里只借它做 site 校验，用入参 site 字符串传给 store。

- [ ] **Step 3: 加 switch case**

`routeInner` 的 `switch (pathname)` 里、`case "/api/me/progress":` 之后、`default:` 之前加：

```ts
case "/api/me/sessions": {
  if (req.method === "POST") return await handleSessionsWrite(req)
  throw new ExtractorError("method not allowed", 405)
}
case "/api/me/stats": {
  requireGet(req)
  return handleStats(url)
}
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `bun run typecheck && bun run build`
Expected: 无错误。

- [ ] **Step 5: 手测**

`bun run dev:api` 后：
- `curl -s localhost:3001/api/me/stats` → 返回 `StatsResult`（空库 summary 全 0）。
- `curl -s -X POST localhost:3001/api/me/sessions -H 'content-type: application/json' -d '{"kind":"post","id":"t1","title":"T","startedAt":'$(date +%s)'000,"durationS":42}'` → `{ok:true}`；再 GET stats `totalDurationS` ≥ 42。
- 非法 id：`... -d '{"kind":"post","id":"a b","title":"T","startedAt":1000,"durationS":5}'` → 400。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add POST /api/me/sessions and GET /api/me/stats"
```

---

## Task 6: `useReadingSession` hook

**Files:**
- Create: `apps/web/src/hooks/use-reading-session.ts`

**Interfaces:**
- Consumes: `api.meSessions`（Task 8 先加常量；本任务先用字面量 `/api/me/sessions`，Task 8 改为常量）。
- Produces: `useReadingSession(opts: { site: SiteId; kind: "post" | "book"; id: string; title: string; enabled: boolean }): void`。可见时计 + `sendBeacon`/`fetch keepalive` 分段 flush（≥3s 才发）；`enabled=false` 不计时。

> 前端无单测；typecheck + build + 手测验证。

- [ ] **Step 1: 实现 hook**

`apps/web/src/hooks/use-reading-session.ts`：

```ts
import { useEffect, useRef } from "react"
import { type SiteId } from "@/lib/routes"

const FLUSH_INTERVAL_MS = 60_000
const MIN_SEGMENT_S = 3

/**
 * 可见时计阅读时长，分段 sendBeacon 提交。
 * enabled 与 useReadingProgress 的 ready 一致：仅在「正文就绪」时计时；
 * 目录页 / loading / error 壳传 enabled=false。换 id/chapter 经依赖变化重挂：旧实例 flush + 新实例。
 *
 * 双锚点：segStartPerf（performance.now，单调，算时长）+ segStartWall（Date.now，
 * 作 payload startedAt，归因日/小时按它分桶）。
 * accumulate 无条件把「段起点→now」计入 accMs：visibilitychange→hidden 时 visible()
 * 已是 false，若再要求 visible() 才累加会丢掉当前段（最多近 60s）。
 */
export function useReadingSession(opts: {
  site: SiteId
  kind: "post" | "book"
  id: string
  title: string
  enabled: boolean
}): void {
  const { site, kind, id, title, enabled } = opts
  const accMs = useRef(0)
  const segStartPerf = useRef<number | null>(null)
  const segStartWall = useRef<number | null>(null)
  // 最新 title 进 ref：title 变化不重置计时，只影响后续 flush payload
  const titleRef = useRef(title)
  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    if (!enabled) return
    const visible = () => document.visibilityState === "visible"
    const startSegment = () => {
      if (segStartPerf.current === null) {
        segStartPerf.current = performance.now()
        segStartWall.current = Date.now()
      }
    }
    // 无条件累加当前段（hidden 转换点不能因 visible()=false 而漏计）
    const accumulate = () => {
      if (segStartPerf.current !== null) {
        accMs.current += performance.now() - segStartPerf.current
        segStartPerf.current = null
        segStartWall.current = null
      }
    }
    const flush = () => {
      const wallStart = segStartWall.current // accumulate 前先取段起点墙钟
      accumulate()
      const durationS = Math.round(accMs.current / 1000)
      const startedAt = wallStart ?? Date.now() - durationS * 1000
      if (durationS >= MIN_SEGMENT_S) {
        const payload = JSON.stringify({
          site,
          kind,
          id,
          title: titleRef.current,
          startedAt,
          durationS,
        })
        const url = "/api/me/sessions"
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }))
          } else {
            void fetch(url, {
              method: "POST",
              body: payload,
              keepalive: true,
              headers: { "content-type": "application/json" },
            })
          }
        } catch {
          /* 静默：统计非关键路径 */
        }
      }
      accMs.current = 0
      if (visible()) startSegment() // 仍可见 → 开新段
    }
    const onVisibility = () => {
      if (!visible()) flush()
      else startSegment()
    }
    startSegment()
    const timer = setInterval(flush, FLUSH_INTERVAL_MS)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", flush)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [enabled, site, kind, id]) // 故意不含 title：title 变化不重置计时
}
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-reading-session.ts
git commit -m "feat(web): add useReadingSession visibility-aware tracking hook"
```

---

## Task 7: ReadPage / BookPage 挂载 hook

**Files:**
- Modify: `apps/web/src/pages/ReadPage.tsx`
- Modify: `apps/web/src/pages/BookPage.tsx`

**Interfaces:**
- Consumes: `useReadingSession`（Task 6）。门闩与 `useReadingProgress` 的 `ready` 一致：ReadPage `loadedTid === tid`；BookPage `(isChapterBody || isCool18Book) && loadedKey === currentKey`，**`isToc` → `enabled=false`**。

- [ ] **Step 1: ReadPage 挂载**

`ReadPage.tsx` import：

```ts
import { useReadingSession } from "@/hooks/use-reading-session"
```

在 `useReadingProgress(...)` 调用之后加（`content` 就绪后 title 取 `content.title`）：

```ts
useReadingSession({
  site,
  kind: "post",
  id: tid,
  title: content?.title ?? "",
  enabled: loadedTid === tid,
})
```

> `site` 取 ReadPage 现有变量（与 `useReadingProgress` 同源；若该页用 `useSite()` 则一致）。若 ReadPage 当前未拿 `site`，用 `useSite()`。

- [ ] **Step 2: BookPage 挂载**

`BookPage.tsx` import 同上。在 `useReadingProgress(...)` 之后加：

```ts
useReadingSession({
  site,
  kind: "book",
  id: cid,
  title: isToc ? "" : (book?.bookTitle ?? book?.title ?? ""),
  enabled: (isChapterBody || isCool18Book) && loadedKey === currentKey,
})
```

> `isToc` 为 true 时 `enabled=false`，目录页不计时长。`book` 为该页正文 state（按现有变量名取标题字段；若字段名不同用实际）。

- [ ] **Step 3: 类型检查 + 构建**

Run: `bun run typecheck && bun run build`
Expected: 无错误。

- [ ] **Step 4: 手测**

`bun run dev`：打开帖子读一会儿 → 触发 flush（DevTools Network 可见 `/api/me/sessions` POST，或 60s 后）；书库目录页停留不产生 session；章节正文页产生。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ReadPage.tsx apps/web/src/pages/BookPage.tsx
git commit -m "feat(web): mount useReadingSession on read/book pages (toc excluded)"
```

---

## Task 8: 路由 / 导航 / api 常量

**Files:**
- Modify: `apps/web/src/lib/routes.ts`（`routes.stats`、`api.meSessions` / `api.meStats`、`NAV_ITEMS`）
- Modify: `apps/web/src/App.tsx`（注册 `/stats`）
- Modify: `apps/web/src/hooks/use-reading-session.ts`（把字面量换成 `api.meSessions`）

**Interfaces:**
- Produces: `routes.stats = "/stats"`；`api.meSessions`、`api.meStats`；`NAV_ITEMS` 多一项「统计」（「我的」后、「任务」前）；`App.tsx` 懒加载 `StatsPage`。

- [ ] **Step 1: routes.ts 常量**

`routes` 对象 `jobs: "/jobs",` 之后加 `stats: "/stats",`。
`api` 对象 `meExport: "/api/me/export",` 之后加：

```ts
meSessions: "/api/me/sessions",
meStats: "/api/me/stats",
```

- [ ] **Step 2: NAV_ITEMS 增项**

`NAV_ITEMS` 在「我的」项之后、「任务」项之前插入：

```ts
{
  href: routes.stats,
  label: "统计",
  match: (p: string) => p === routes.stats,
},
```

- [ ] **Step 3: App.tsx 注册路由**

`const ArchivePage = lazy(...)` 之后加 `const StatsPage = lazy(() => import("@/pages/StatsPage"))`。
在 `<Route path="/archive" .../>` 之后、`<Route path="*" .../>` 之前加：

```tsx
<Route
  path="/stats"
  element={
    <RouteBoundary>
      <StatsPage />
    </RouteBoundary>
  }
/>
```

- [ ] **Step 4: hook 改用常量**

`use-reading-session.ts`：

```ts
import { api, type SiteId } from "@/lib/routes"
```

把 `const url = "/api/me/sessions"` 改为 `const url = api.meSessions`。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected：此时 `StatsPage` 尚未创建 → 会报错；先占位创建空页让 typecheck 过：

`apps/web/src/pages/StatsPage.tsx`：

```tsx
export default function StatsPage() {
  return null
}
```

再 Run: `bun run typecheck`
Expected: 无错误（Task 9 填充页面）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/routes.ts apps/web/src/App.tsx apps/web/src/hooks/use-reading-session.ts apps/web/src/pages/StatsPage.tsx
git commit -m "feat(web): wire /stats route, nav item, and api consts"
```

---

## Task 9: `formatDuration` + `StatsPage` 全页

**Files:**
- Modify: `apps/web/src/lib/format.ts`（`formatDuration`）
- Modify: `apps/web/src/pages/StatsPage.tsx`（完整页面）
- Create: `apps/web/src/components/stats-heatmap.tsx`（热力图）

**Interfaces:**
- Consumes: `api.meStats`、`AsyncBody`、`PageHeader`、`PageShell`、`formatDateTime`、`readPath`/`bookPath`、`StatsResult`（经 `@workspace/core` 类型，前端按 JSON 结构 inline typing）。
- Produces: `formatDuration(s)`；`StatsPage`（站点控件 `all|1|2` 默认 all → 带或不带 `site` 拉取，渲染概览 / 热力图 / 时段 / TOP / 最近 / 库存）。

- [ ] **Step 1: formatDuration**

`format.ts` 末尾加：

```ts
export function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0m"
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h > 0) return `${h}h ${mm}m`
  if (m > 0) return `${m}m ${Math.floor(s % 60)}s`
  return `${Math.floor(s)}s`
}
```

- [ ] **Step 2: 热力图组件**

`apps/web/src/components/stats-heatmap.tsx`：

```tsx
import { useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { formatDuration } from "@/lib/format"

type Day = { date: string; durationS: number; estimated: number }

function level(s: number): number {
  if (s <= 0) return 0
  if (s < 300) return 1
  if (s < 1200) return 2
  if (s < 3600) return 3
  return 4
}
const LEVEL_BG = [
  "bg-muted/60",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
]
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`

/**
 * 近 365 天 GitHub 式热力图：列=周、行=周日…周六。先按首日 weekday 补 null 对齐到
 * 周日，再每 7 个切一列。空日也画（durationS=0）。
 */
export function StatsHeatmap({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<Day | null>(null)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const all: Day[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date(todayMid)
    d.setDate(d.getDate() - i)
    const key = keyOf(d)
    all.push(byDate.get(key) ?? { date: key, durationS: 0, estimated: 0 })
  }
  // 对齐到周日（getDay 周日=0）：首日之前补 null，使每列同 weekday
  const pad = all.length ? new Date(all[0].date + "T00:00:00").getDay() : 0
  const flat: (Day | null)[] = [...Array(pad).fill(null), ...all]
  const weeks: (Day | null)[][] = []
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7))
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex gap-[3px] overflow-x-auto"
        role="img"
        aria-label="近一年阅读热力图"
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }).map((_, di) => {
              const c = week[di] ?? null
              if (!c) return <div key={di} className="h-2.5 w-2.5" />
              return (
                <div
                  key={c.date}
                  title={`${c.date} · ${formatDuration(c.durationS)}`}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  className={cn(
                    "h-2.5 w-2.5 rounded-[2px]",
                    LEVEL_BG[level(c.durationS)],
                    c.estimated === 1 && "ring-1 ring-inset ring-amber-400/70"
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
      {hover && (
        <p className="text-xs text-muted-foreground">
          {hover.date} · {formatDuration(hover.durationS)}
          {hover.estimated === 1 ? "（历史活跃日，无时长）" : ""}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: StatsPage 主体**

`StatsPage.tsx`：

```tsx
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionLabel } from "@/components/page-header"
import { StatsHeatmap } from "@/components/stats-heatmap"
import { AsyncBody } from "@/components/ui-state"
import { api, bookPath, readPath, type SiteId } from "@/lib/routes"
import { formatDateTime, formatDuration } from "@/lib/format"
import { cn } from "@workspace/ui/lib/utils"

type StatsResult = {
  summary: {
    totalDurationS: number
    currentStreak: number
    longestStreak: number
    activeDays: number
    thisWeekS: number
    thisMonthS: number
    trackedSince: number | null
    lastActiveAt: number | null
  }
  calendar: { date: string; durationS: number; estimated: number }[]
  timeOfDay: number[]
  topItems: {
    kind: "post" | "book"
    site: SiteId
    id: string
    title: string
    durationS: number
    sessions: number
  }[]
  recentSessions: {
    startedAt: number
    durationS: number
    kind: "post" | "book"
    site: SiteId
    id: string
    title: string
  }[]
  inventory: {
    history: number
    favorites: number
    tags: number
    groups: number
    characters: number
  }
}

type Scope = "all" | SiteId
const SCOPE_TABS: { key: Scope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "1", label: "论坛" },
  { key: "2", label: "书库" },
]

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 px-4 py-3.5">
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export default function StatsPage() {
  const [scope, setScope] = useState<Scope>("all")
  const [data, setData] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    const url = scope === "all" ? api.meStats : `${api.meStats}?site=${scope}`
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error("请求失败")
        const json = (await r.json()) as StatsResult
        if (!cancelled) setData(json)
      })
      .catch((e) => !cancelled && setError(e?.message ?? "请求失败"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [scope])

  const hasSessions = !!data && (data.summary.trackedSince !== null)
  const maxHour = data ? Math.max(1, ...data.timeOfDay) : 1

  return (
    <PageShell>
      <PageHeader title="统计" description="阅读时长 · 连读 · 时段" />
      <div
        className="mb-4 flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1"
        role="tablist"
        aria-label="站点"
      >
        {SCOPE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={scope === t.key}
            onClick={() => setScope(t.key)}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              scope === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AsyncBody
        loading={loading}
        error={error}
        empty={!hasSessions}
        emptyText="还没有阅读记录，读几篇再来看看吧"
      >
        {data && (
          <div className="space-y-8">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard value={formatDuration(data.summary.totalDurationS)} label="累计时长" />
              <StatCard value={String(data.summary.currentStreak)} label="当前连读(天)" />
              <StatCard value={String(data.summary.longestStreak)} label="最长连读(天)" />
              <StatCard value={String(data.summary.activeDays)} label="活跃天数" />
              <StatCard value={formatDuration(data.summary.thisWeekS)} label="本周时长" />
              <StatCard value={formatDuration(data.summary.thisMonthS)} label="本月时长" />
              {data.summary.trackedSince != null && (
                <StatCard
                  value={formatDateTime(data.summary.trackedSince)}
                  label="记录始于"
                />
              )}
            </section>

            <section>
              <SectionLabel>每日热力图（近一年）</SectionLabel>
              <StatsHeatmap days={data.calendar} />
            </section>

            <section>
              <SectionLabel>阅读时段分布</SectionLabel>
              <div className="flex h-32 items-end gap-1">
                {data.timeOfDay.map((s, h) => (
                  <div
                    key={h}
                    title={`${h}:00 · ${formatDuration(s)}`}
                    className="flex-1 rounded-t bg-primary/70"
                    style={{ height: `${(s / maxHour) * 100}%`, minHeight: s > 0 ? 2 : 0 }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
              </div>
            </section>

            <section className="grid gap-8 lg:grid-cols-2">
              <div>
                <SectionLabel>时长 TOP</SectionLabel>
                {data.topItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无</p>
                ) : (
                  <ul className="space-y-2">
                    {data.topItems.map((t) => {
                      const href =
                        t.kind === "post" ? readPath(t.id, t.site) : bookPath(t.id, { site: t.site })
                      return (
                        <li key={`${t.site}:${t.kind}:${t.id}`}>
                          <Link to={href} className="block">
                            <div className="flex items-center justify-between gap-3">
                              <span className="line-clamp-1 text-sm text-foreground">{t.title}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatDuration(t.durationS)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-muted">
                              <div
                                className="h-full rounded bg-primary/70"
                                style={{
                                  width: `${(t.durationS / data.topItems[0].durationS) * 100}%`,
                                }}
                              />
                            </div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <div>
                <SectionLabel>最近阅读</SectionLabel>
                {data.recentSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.recentSessions.map((r, i) => {
                      const href =
                        r.kind === "post" ? readPath(r.id, r.site) : bookPath(r.id, { site: r.site })
                      return (
                        <li key={i}>
                          <Link to={href} className="flex items-center justify-between gap-3 text-sm">
                            <span className="line-clamp-1 text-foreground">{r.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateTime(r.startedAt)} · {formatDuration(r.durationS)}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <SectionLabel>库存</SectionLabel>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard value={String(data.inventory.history)} label="历史" />
                <StatCard value={String(data.inventory.favorites)} label="收藏" />
                <StatCard value={String(data.inventory.tags)} label="标签" />
                <StatCard value={String(data.inventory.groups)} label="分组" />
                <StatCard value={String(data.inventory.characters)} label="角色" />
              </div>
            </section>
          </div>
        )}
      </AsyncBody>
    </PageShell>
  )
}
```

> `empty={!hasSessions}`：以 sessions 为准（`trackedSince !== null`），不因 `inventory.history=0` 判空（清历史后天数仍在）。

- [ ] **Step 4: 类型检查 + 构建**

Run: `bun run typecheck && bun run build`
Expected: 无错误。

- [ ] **Step 5: 手测**

`bun run dev`：顶栏点「统计」→ 空态文案（无数据时）；用 curl/hook 写入几条 session 后 → 各板块渲染；切换全部/论坛/书库 → 数据随之变；书库站 groups 仍全局数。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/pages/StatsPage.tsx apps/web/src/components/stats-heatmap.tsx
git commit -m "feat(web): add StatsPage with heatmap, streak, time-of-day, top items"
```

---

## Task 10: Dockerfile `TZ` + AGENTS.md 文档

**Files:**
- Modify: `Dockerfile`（`ENV TZ`）
- Modify: `AGENTS.md`（环境变量表 + API 表）

- [ ] **Step 1: runner 阶段装 tzdata 并设 TZ**

`oven/bun:1.3`（Debian 系）不一定带 tzdata；仅 `ENV TZ=` 时 SQLite `local time` 仍可能按 UTC → 热力图/连读错位。在 `Dockerfile` 的 **runner 阶段、`USER bun` 之前**（root 权限）装 tzdata 并设 TZ：把下块插在 runner 阶段 `RUN mkdir -p /data && chown -R bun:bun /data` 这一行之前：

```dockerfile
USER root
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Shanghai
```

> 阶段末尾原有的 `USER bun` 在后，故运行身份仍是 `bun`。手测：`docker run --rm purifier date` 与容器内 `SELECT date('now','localtime')` 都应是上海日。

- [ ] **Step 2: AGENTS.md 环境变量表**

环境变量表加一行（按表格式）：

```markdown
| `TZ`                         | `Asia/Shanghai`         | 容器本地时区；阅读统计按本地日分桶，须与用户一致（镜像需含 tzdata，见 Dockerfile runner 阶段） |
```

- [ ] **Step 3: AGENTS.md API 表**

API 表追加两行（保持现有表格列：路径 / 参数 / 行为）：

```markdown
| `POST /api/me/sessions`                  | body `{ site?, kind, id, title, startedAt, durationS }`    | 记一段阅读会话 `{ ok }`；`id` 走 `assertSafeId`，`durationS<3` 丢弃、`>300` clamp，`startedAt>now+5m` 400 |
| `GET /api/me/stats`                      | `site?`                                                     | `{ summary, calendar, timeOfDay, topItems, recentSessions, inventory }`；省略 `site` 跨站 |
```

- [ ] **Step 4: 验证**

Run: `bun run typecheck && bun run build`
Expected: 无错误（文档/构建变更不影响类型检查）。

Run: `docker build -t purifier:latest . && docker run --rm purifier:latest date`
Expected: 容器时间为上海时区（`CST` / `+08`）；镜像内 tzdata 已装。

- [ ] **Step 5: Commit**

```bash
git add Dockerfile AGENTS.md
git commit -m "docs(stats): set container TZ and document stats API"
```

---

## Self-Review（含 plan-review 修订核对）

**Spec / plan-review 覆盖：**
- 会话日志（篇/日/时段/时长）→ T1 表 + T2 recordSession + T6 hook。✓
- 仅可见时计 + 目录页禁用 → T6（visibility + 无条件 accumulate）+ T7 enabled（isToc 排除）。✓
- 回填活跃日、不伪造时长 → T1 回填（estimated=1, duration_s NULL）+ T3 calendar estimated 规则。✓
- `/stats` + 顶栏导航（独立页）→ T8 + T9。✓
- 站点控件 all|1|2 不复用 useSetSite → T9 自绘控件。✓
- 服务端一次聚合 → T3 getStats + T5 handleStats。✓
- 进 export → T4。✓
- 板块齐全（含「记录始于」）→ T3 数据 + T9 渲染。✓
- **plan-review C1** hidden 不丢段：T6 `accumulate` 无条件、`flush` 先取 `wallStart` 再累加。✓
- **plan-review C2** startedAt 用段起点墙钟（`segStartWall`）→ T6。✓
- **plan-review C3** `ItemKind` 不从 routes 引：T6/T8 用 `"post" | "book"` 字面量、仅引 `SiteId`。✓
- **plan-review I1** 混合日 estimated：T3 测试 08-12 同时插回填+真实 → `estimated: 0`。✓
- **plan-review I2** groups 全局：T3 测试 `upsertGroup` 后 `getStats({site:"2"}).inventory.groups === 1`。✓
- **plan-review I3** 热力图 7×N 周对齐：T9 `StatsHeatmap` 按周日对齐 + 首 padding。✓
- **plan-review I4** 记录始于：T9 概览第 7 卡（`trackedSince != null` 才渲染）。✓
- **plan-review I5** tzdata：T10 runner 阶段 root 装 tzdata + `ENV TZ`，`USER bun` 在后。✓
- **plan-review I6** File Structure 列 `stats-heatmap.tsx`。✓
- 归因到 started_at、estimated 规则、clamp+assertSafeId+startedAt 上界、清历史不级联（+T2「sessions survive deleteItem」测试锁定）、inventory×site、topItems.title argMax、export key=`reading_sessions`（含 `id`）、API title 入库前 trim → 各 Task。✓

**Placeholder scan：** 无 TBD/TODO；`resolveSite(id?): Extractor` 已按真实签名调用（仅校验、传 site 字符串）。

**Type consistency：** `ReadingSessionInput` / `StatsResult` 及子类型在 T2/T3 定义，T5（API）/T9（内联类型）消费；`recordSession` / `getStats({site?})` 跨 T2/T3/T5 一致；hook 用 `kind: "post" | "book"` 字面量（与 web 现有 `useReadingProgress` 一致，不引 `ItemKind`），`useReadingSession({site,kind,id,title,enabled})` T6 定义、T7 调用一致；`exportBackup.reading_sessions` 类型含 `id` 与 `SELECT *` 对齐。
