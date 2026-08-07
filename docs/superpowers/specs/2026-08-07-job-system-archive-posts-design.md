# 任务系统 · 全站主帖归档 设计

- 日期：2026-08-07
- 状态：待评审
- 范围：`packages/core`（存储 + 任务系统）+ `apps/api`（接口）+ `apps/web`（前端）

## 1. 背景与问题

现有系统只能"用户访问到哪篇，才记录哪篇"（`recordVisit` 写 `items` 表）。用户希望有一份**全站主帖目录**（tid + 标题），用于离线浏览 / 全站检索 / 备份。

全站主帖上万条，逐条抓取耗时几十分钟，不适合塞进普通请求。需要一个**任务系统**承载这类长跑作业，「全站主帖归档」是它的第一个实例。

当前项目没有任何任务 / 作业 / 队列基础设施（已确认：`grep task|job|queue|cron` 无命中，无 scripts 目录）。这次一并建立。

## 2. 目标与非目标

### 目标

- **任务系统**：进程内长跑作业框架，支持启动 / 查状态 / 看日志 / 取消 / 删除；进程重启后残留 running 标 interrupted，不自动续跑。
- **全站主帖归档**：循环 `fetchHomeLinks(mtid)` 翻页直到游标推进不动，把 tid + 标题写入 `archive_posts` 表。
- **归档目录访问**：`GET /api/me/archive` 分页查询，支持按 title / tid / archived_at 排序、标题子串搜索。
- **前端**：`/jobs` 任务管理页 + `/archive` 归档目录页。

### 非目标（YAGNI）

- 不做通用任务框架的完整能力（并发 / cron / 优先级 / 重试）。调度器只支持"手动触发、同 type 单例、内存 Map + AbortSignal 协作取消、重启标 interrupted"。
- 不抓正文。归档只存 tid + 标题；要看正文走现有 `GET /api/posts?tid=`。
- 不存 url、作者、发布时间、跟帖数等 meta。tid 可经 `buildUrl(tid)` 重建 url；其它字段用户访问该帖时由 `recordVisit` 写入 `items`。
- 不做增量停页优化。每次重跑都从最新页全翻到底，靠 UPSERT 幂等处理已存在。
- 不做自动定时触发。用户手动点「开始」。
- API 层不写测试（与现有项目一致，测试集中在 core）。

## 3. 架构方案

### 3.1 方案选择：轻量框架（方案 C）

经对比三种方案后采用**轻量框架**：

- **通用框架（方案 A）**：完整调度（并发 / cron / 优先级），一次到位但工作量大，YAGNI。
- **归档专用（方案 B）**：不抽象，表叫 `archive_runs`，端点叫 `/api/me/archive/*`。简单但以后加第二个作业要重构。
- **轻量框架（方案 C，采用）**：表与 API 用通用命名（`jobs` / `job_logs`），调度器实现最小化。命名与表结构留扩展点，实现只做当下需要的。

用户预期任务系统会承载多个作业（强调"系统"而非"脚本"），但完整调度能力现在用不上。方案 C 在命名上做对，调度最小化，是平衡。

### 3.2 整体架构

```
┌─ apps/api ────────────────────────────────────┐
│  /api/me/jobs        ← 列出/启动/查看日志/停止  │
│  /api/me/archive     ← 归档目录查询             │
│       │                                       │
│       ▼                                       │
│  JobRunner（进程内单例）                        │
│   • 内存 Map<jobId, AbortController>           │
│   • 调度注册的 JobHandler                       │
│       │                                       │
│       ▼                                       │
│  ArchivePostsJob（第一个 JobHandler 实例）       │
│   • 循环 fetchHomeLinks(mtid)                  │
│   • 限速、UPSERT archive_posts                 │
│   • 写 job_logs                                │
└───────────────────────────────────────────────┘
        │ 依赖
        ▼
┌─ packages/core ───────────────────────────────┐
│  Store                                        │
│   • jobs / job_logs / archive_posts 表         │
│  Extractor.fetchHomeLinks  ← 已有，复用         │
└───────────────────────────────────────────────┘
```

### 3.3 数据流

1. 前端 `POST /api/me/jobs {type:"archive_posts", payload:{site:"1",delayMs:800}}` → 创建 `jobs` 行（pending）→ 同步标 running → 立即返回 `{job}`。
2. `JobRunner` 后台 `void runJob(...)`：循环翻页，每页 UPSERT + 写日志 + 限速 sleep。
3. 结束（自然完成 / abort / 出错）→ `markFinished`，status 置 succeeded / aborted / failed。
4. 前端轮询 `GET /jobs/:id` + `GET /jobs/:id/logs` 看进度与日志。

## 4. 数据库设计

新增三张表，在 `packages/core/src/storage/db.ts` 的 `CREATE TABLE IF NOT EXISTS` 块追加。沿用现有命名（snake_case、毫秒时间戳、`rowid` 隐式主键）。老库幂等补建，无破坏性迁移。

### 4.1 `jobs` —— 任务运行实例

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  payload       TEXT,
  result        TEXT,
  error         TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_type_created_idx ON jobs(type, created_at DESC);
```

**status 状态机（六态）**：

```
pending → running → succeeded     （正常完成）
                  → failed        （handler 抛错）
                  → aborted       （用户 POST stop）
         ↘ interrupted            （进程重启扫到的残留 running）
```

`aborted` 与 `interrupted` 分开：前者是用户主动停（明确意图），后者是进程异常退出（意外）。两者都属"未完成"但语义不同，前端可分别展示。

- `payload`：启动参数 JSON（如 `{site, delayMs}`）。
- `result`：结束摘要 JSON（如 `{pages, inserted, updated, site, stoppedOnError?}`）。
- `error`：failed 时的错误信息。
- `started_at` / `finished_at`：进入 / 离开 running 的时间戳。

### 4.2 `job_logs` —— 运行日志行

```sql
CREATE TABLE IF NOT EXISTS job_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS job_logs_job_created_idx ON job_logs(job_id, created_at);
```

- `level`：`info` | `warn` | `error`。
- `ON DELETE CASCADE`：删 job 时日志一并清。
- 取日志按 `(job_id, created_at)`，索引覆盖。

### 4.3 `archive_posts` —— 归档目录

```sql
CREATE TABLE IF NOT EXISTS archive_posts (
  site          TEXT    NOT NULL,
  tid           TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  first_seen_at INTEGER NOT NULL,
  archived_at   INTEGER NOT NULL,
  PRIMARY KEY (site, tid)
);
CREATE INDEX IF NOT EXISTS archive_posts_site_title_idx
  ON archive_posts(site, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS archive_posts_site_tid_idx
  ON archive_posts(site, tid DESC);
CREATE INDEX IF NOT EXISTS archive_posts_site_archived_idx
  ON archive_posts(site, archived_at DESC);
```

**关键决策**：

- **主键 `(site, tid)`**：天然去重，UPSERT 兜底。
- **`title NOT NULL`**：进表必有标题，空标题在抓取阶段丢弃。
- **无 url 列**：tid 经 `buildUrl(tid)` 可重建。
- **`first_seen_at`**：该 tid 首次进入归档的时间，永不被覆盖。
- **`archived_at`**：该 tid 标题最近一次发生变化的时间（新行 = 首次出现时间）。语义见 §4.4 写入策略。不用于排序时仍保留，便于调试与未来视图。三列（title / tid / archived_at）均建索引，支持前端多列排序。
- **无 `updated_at`**：归档是 append-only 目录，标题更新通过"标题变了才 UPSERT"实现（见 §4.4）。

**为什么单独一张表而非复用 `items`**：`items` 是"我的"（历史 / 收藏 / 标签载体），visit_count=0 的几万条归档数据会污染所有 list 查询（`listHistory` / `listFavorites` 无过滤条件区分）。归档是"全站的"目录，语义不同，物理隔离最干净。

### 4.4 写入策略：标题变了才 UPSERT

`upsertArchivePosts` 实现要点（完整 SQL 见 §5.4）：

1. 先 `SELECT tid, title FROM archive_posts WHERE site=? AND tid IN (...)` 拉本批已存在的旧标题。
2. 遍历本批：
   - 旧标题 === 新标题 → **整条跳过**，不写 SQL，不刷 archived_at。
   - 旧标题不存在 → INSERT，`first_seen_at = archived_at = ts`，`inserted++`。
   - 旧标题 !== 新标题 → UPSERT，更新 title 与 archived_at（`first_seen_at` 保留），`updated++`。

三个统计语义由此干净：

- `inserted` = 新增行数。
- `updated` = 标题实际变化的已存在行数。
- `archived_at` = 标题最近一次变化时间（未变行不刷新）。

## 5. Store 层（`packages/core/src/storage/store.ts`）

沿用现有风格（方法名小写驼峰、返回 plain object、事务包批量写、注释解释非显然决策）。

### 5.1 Job 方法

```ts
createJob(type: string, payload: Record<string, unknown> | null): Job
// INSERT status='pending', created_at=now；payload JSON.stringify；返回完整 Job

getJob(id: number): Job | null

listJobs(opts: { type?: string; status?: string; limit: number; offset: number }): Job[]
// WHERE 过滤 + LIMIT/OFFSET，ORDER BY created_at DESC
// limit/offset 由 API 层填入默认与上限（limit 默认 20、上限 100，offset 默认 0）；
// Store 不校验范围，只做透传

markRunning(id: number): void
// UPDATE status='running', started_at=now WHERE id=? AND status='pending'

markFinished(
  id: number,
  status: "succeeded" | "failed" | "interrupted" | "aborted",
  result: Record<string, unknown> | null,
  error: string | null
): void
// UPDATE status, finished_at=now, result=JSON.stringify(result), error
// 调用方（Runner）保证只在 runJob 结束时调一次

hasRunningOfType(type: string): boolean
// SELECT 1 FROM jobs WHERE type=? AND status='running' LIMIT 1
// 单例约束检查（§6.2）

clearFinishedJobs(): number
// DELETE FROM jobs WHERE status IN ('succeeded','failed','interrupted','aborted')
// 返回删除行数；CASCADE 自动清 job_logs

markStaleRunningAsInterrupted(): number
// UPDATE jobs SET status='interrupted', finished_at=now WHERE status='running'
// 进程启动时 recoverOnStartup 调用，返回影响行数
```

### 5.2 Job 日志方法

```ts
appendJobLog(jobId: number, level: "info"|"warn"|"error", message: string): void
// INSERT created_at=now

listJobLogs(jobId: number, opts: { limit: number; offset: number; level?: string }): JobLog[]
// WHERE job_id=? [+ level 过滤] ORDER BY created_at ASC LIMIT/OFFSET
// limit/offset 由 API 层填入默认与上限（limit 默认 200、上限 1000，offset 默认 0）；
// Store 不校验范围，只做透传
```

`appendJobLog` 一页一条，频率低，不做批量缓冲。

### 5.3 Archive 查询方法

```ts
listArchivePosts(
  site: string,
  opts: { q?: string; page: number; limit: number; sort: "title"|"tid"|"archived_at"; order?: "asc"|"desc" }
): { items: ArchivePost[]; nextPage: number | null }
// WHERE site=? [+ q 标题子串 NOCASE]
// ORDER BY <sort> <order>，LIMIT/OFFSET
```

**排序白名单（防 SQL 注入）**：

```ts
const SORT_COL: Record<opts["sort"], string> = {
  title: "title COLLATE NOCASE",
  tid: "tid",
  archived_at: "archived_at",
}
```

`sort` 必须命中三选一，否则抛错；`order` 必须是 `"asc"|"desc"`，否则抛错。默认 order：title→asc、tid→desc、archived_at→desc。

### 5.4 Archive 写入方法

```ts
upsertArchivePosts(
  site: string,
  items: Array<{ tid: string; title: string; ts: number }>
): { inserted: number; updated: number }
```

实现：

```ts
upsertArchivePosts(site, items) {
  if (items.length === 0) return { inserted: 0, updated: 0 }
  const ts = items[0].ts
  const run = this.db.transaction(() => {
    const tids = items.map(i => i.tid)
    const ph = tids.map(() => "?").join(",")
    const rows = this.db
      .query(`SELECT tid, title FROM archive_posts WHERE site=? AND tid IN (${ph})`)
      .all(site, ...tids) as { tid: string; title: string }[]
    const oldTitle = new Map(rows.map(r => [r.tid, r.title]))

    let inserted = 0, updated = 0
    const stmt = this.db.query(
      `INSERT INTO archive_posts (site, tid, title, first_seen_at, archived_at)
       VALUES (?1,?2,?3,?4,?4)
       ON CONFLICT(site,tid) DO UPDATE SET
         title=excluded.title, archived_at=excluded.archived_at`
    )
    for (const it of items) {
      const old = oldTitle.get(it.tid)
      if (old === it.title) continue          // 标题没变，整条跳过
      stmt.run(site, it.tid, it.title, ts)
      if (old === undefined) inserted++
      else updated++
    }
    return { inserted, updated }
  })
  return run()
}
```

要点：

- **批内 `ts` 统一**：调用方传一个 `ts`（`Date.now()`），全批同时间戳。
- **`tid IN (...)` 动态占位符**：与现有 `tagsFor` 风格一致，不用 `VALUES (?)` 表语法。
- **空批早返回**：避免空 IN 子句与空事务。

### 5.5 类型定义（`packages/core/src/storage/types.ts`）

```ts
export type JobStatus =
  | "pending" | "running" | "succeeded"
  | "failed" | "interrupted" | "aborted"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload: string | null      // JSON string；API 层 parse
  result: string | null       // 同上
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

export type JobLogLevel = "info" | "warn" | "error"

export interface JobLog {
  id: number
  job_id: number
  level: JobLogLevel
  message: string
  created_at: number
}

export interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
}
```

`payload` / `result` 在 Store 层保持 `string | null`（SQLite 存 TEXT），由 API 层 `JSON.parse` 成对象返回前端。Store 层不耦合 JSON 解析容错，职责清晰。

## 6. 任务系统核心（`packages/core/src/jobs/`，新建目录）

### 6.1 JobHandler 接口（扩展点）

`packages/core/src/jobs/handler.ts`：

```ts
export interface JobContext {
  jobId: number
  log(level: "info" | "warn" | "error", message: string): void
  signal: AbortSignal
  payload: Record<string, unknown>
}

export interface JobResult {
  [key: string]: unknown
}

export interface JobHandler {
  type: string
  run(ctx: JobContext): Promise<JobResult>
}
```

`AbortSignal` 协作取消：Web 标准，Bun 原生支持，无需引依赖。Handler 在每个翻页循环顶部检查 `ctx.signal.aborted`。

### 6.2 JobRunner（API 进程内单例）

`packages/core/src/jobs/runner.ts`：

```ts
export class JobRunner {
  private running = new Map<number, AbortController>()

  constructor(
    private store: Store,
    private handlers: Map<string, JobHandler> = new Map()
  ) {}

  register(h: JobHandler): void

  async start(type: string, payload?: Record<string, unknown>): Promise<Job>

  stop(jobId: number): boolean

  recoverOnStartup(): void
}
```

**`start()` 流程**：

1. 校验 `type` 在 handlers 注册表 → 否则抛 `ExtractorError("unknown job type", 400)`。
2. 校验当前没有同 type 的 job 在 running（单例约束）→ 否则抛 `ExtractorError("job already running", 409)`。
3. `store.createJob(type, payload)` → 拿 `jobId`，status=pending。
4. `store.markRunning(jobId)` → status=running, started_at=now。
5. 创建 `AbortController`，存入 `running` Map。
6. **不 await**：`void this.runJob(jobId, type, payload, controller.signal)` —— 立即返回 job。
7. `runJob` 异步跑完，try/catch 兜底，最终 `markFinished`。

**单例约束的 TOCTOU**：API 进程内单实例 + JS 单线程，`start()` 同步走到 `createJob`，实际无并发窗口。可接受。

**`stop()` 行为**：只调 `controller.abort()`，立即返回。真正改 status 由 `runJob` 的 finally 处理（保证 `finished_at` 只写一次、result/error 正确）。job 已结束 → Map 里没有它 → 返回 false。

**`recoverOnStartup()`**：API 启动时调一次。`store.markStaleRunningAsInterrupted()`。不删 job_logs（保留崩溃前日志便于排查）。

**`runJob` 核心逻辑**：

```ts
private async runJob(jobId, type, payload, signal) {
  const handler = this.handlers.get(type)!
  const ctx: JobContext = {
    jobId,
    payload: payload ?? {},
    signal,
    log: (level, message) => this.store.appendJobLog(jobId, level, message),
  }
  let status: JobStatus = "succeeded"
  let result: JobResult | null = null
  let error: string | null = null
  try {
    result = await handler.run(ctx)
    if (signal.aborted) status = "aborted"
  } catch (err) {
    status = "failed"
    error = err instanceof Error ? err.message : String(err)
    ctx.log("error", `job failed: ${error}`)
  } finally {
    this.running.delete(jobId)
    this.store.markFinished(jobId, status, result, error)
  }
}
```

`markFinished` 只在 finally 调一次。handler 正常返回但 signal.aborted → aborted（用户意图优先）。

### 6.3 ArchivePostsJob（第一个 handler）

`packages/core/src/jobs/handlers/archive_posts.ts`：

```ts
export class ArchivePostsJob implements JobHandler {
  type = "archive_posts"
  constructor(private store: Store) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const site = String(ctx.payload.site ?? "1")
    if (site !== "1") {
      throw new ExtractorError("site does not support archive", 400)
    }
    const extractor = resolveSite(site)
    if (typeof extractor.fetchHomeLinks !== "function") {
      throw new ExtractorError("site does not support archive", 400)
    }

    let mtid = "0"
    let pages = 0, inserted = 0, updated = 0
    const delayMs = Number(ctx.payload.delayMs ?? 800)
    let stoppedOnError = false

    while (!ctx.signal.aborted) {
      let page: HomePage
      try {
        page = await extractor.fetchHomeLinks(mtid)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ctx.log("warn", `page ${pages + 1} failed: ${msg}; stopping`)
        stoppedOnError = true
        break
      }
      pages++
      if (page.links.length === 0) {
        ctx.log("info", `page ${pages}: empty, done`)
        break
      }
      const res = this.store.upsertArchivePosts(site, page.links.map(l => ({
        tid: l.tid, title: l.title, ts: Date.now(),
      })))
      inserted += res.inserted
      updated += res.updated
      ctx.log("info", `page ${pages}: +${page.links.length} fetched (${res.inserted} new, ${res.updated} updated), nextMtid=${page.nextMtid}`)

      if (!page.nextMtid || page.nextMtid >= mtid) {
        ctx.log("info", `reached end (nextMtid=${page.nextMtid})`)
        break
      }
      mtid = page.nextMtid
      await sleep(delayMs, ctx.signal)
    }

    if (ctx.signal.aborted) ctx.log("warn", "aborted by user")
    const result: JobResult = { pages, inserted, updated, site }
    if (stoppedOnError) result.stoppedOnError = true
    return result
  }
}
```

要点：

- **site 校验**：构造时不固定 extractor，run 里校验 site==="1" + `fetchHomeLinks` 存在。xbookcn 不支持，立即 failed。
- **单页失败策略**：warn + break（结束 job，标 succeeded，result 带 `stoppedOnError: true`）。不重试该页、不跳过该页继续（跳过会丢中间 tid 且打乱游标）。
- **终止条件 `nextMtid >= mtid`**：兜底防止游标倒退死循环（理论不会发生，防御）。
- **`sleep(delayMs, signal)`**：`Promise.race([setTimeout, abortPromise])`，abort 立即 resolve 不等完，否则用户点 stop 还要等限速。
- **Handler 依赖 `resolveSite`**：从 `@workspace/core` 导出（已导出）。

### 6.4 依赖注入与 wiring

`apps/api/src/index.ts` 启动时：

```ts
const store = new Store(openDatabase(DATA_DIR))
const runner = new JobRunner(store)
runner.register(new ArchivePostsJob(store))
runner.recoverOnStartup()
```

`JobRunner` 与 `ArchivePostsJob` 从 `@workspace/core` 导出。

## 7. API 端点（`apps/api/src/index.ts`）

新增 `/api/me/jobs` 一组 + `/api/me/archive`，沿用现有风格（`requireGet`、`jsonOk` + `NO_STORE_HEADERS`，全是 `/api/me/*` 个人数据）。

### 7.1 端点表

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/me/jobs` | query：`type`、`status`、`limit`（默认 20，上限 100）、`offset`。按 `created_at DESC`。返回 `{ items: Job[] }` |
| `POST` | `/api/me/jobs` | body `{ type: "archive_posts", payload?: { site?, delayMs? } }`。校验 type 已注册（400）、无同 type running（409）。立即返回 `{ job }`（status=running，后台异步执行） |
| `GET` | `/api/me/jobs/:id` | 单个 job 详情。不存在 404。返回 `{ job }` |
| `GET` | `/api/me/jobs/:id/logs` | query：`limit`（默认 200，上限 1000）、`offset`、`level`。按 `created_at ASC`。返回 `{ items: JobLog[] }` |
| `POST` | `/api/me/jobs/:id/stop` | 取消。不存在 404；非 running 409。返回 `{ ok: true }`（实际终止异步完成） |
| `DELETE` | `/api/me/jobs/:id` | 删 job + 级联日志。只允许删终态 job，删 running 409。返回 `{ ok: true }` |
| `DELETE` | `/api/me/jobs` | 清空所有终态 job。返回 `{ ok: true, removed: N }` |
| `GET` | `/api/me/archive` | query：`site`（默认 1）、`q`、`sort`（title/tid/archived_at）、`order`（asc/desc）、`page`、`limit`（默认 50，上限 100）。返回 `{ items: ArchivePost[], nextPage?: number }` |

### 7.2 路由位置

子资源正则分支（与 `/api/me/groups` 同级，放在 switch 之前）：

```ts
const jobsSub = pathname.match(/^\/api\/me\/jobs\/(\d+)(?:\/(logs|stop))?$/)
if (jobsSub) {
  const id = Number(jobsSub[1])
  const sub = jobsSub[2]
  if (sub === undefined) {
    if (req.method === "GET") return handleJobGet(url, id)
    if (req.method === "DELETE") return handleJobDelete(id)
    throw new ExtractorError("method not allowed", 405)
  }
  if (sub === "logs") {
    if (req.method !== "GET") throw new ExtractorError("method not allowed", 405)
    return handleJobLogs(url, id)
  }
  if (sub === "stop") {
    if (req.method !== "POST") throw new ExtractorError("method not allowed", 405)
    return handleJobStop(id)
  }
}
if (pathname === "/api/me/jobs") {
  if (req.method === "GET") return handleJobsList(url)
  if (req.method === "POST") return await handleJobStart(req)
  if (req.method === "DELETE") return handleJobsClear()
  throw new ExtractorError("method not allowed", 405)
}
// switch 内：
case "/api/me/archive":
  requireGet(req)
  return handleMeArchive(url)
```

### 7.3 Job JSON 形状（前端用）

API 层返回前 `JSON.parse` payload / result：

```ts
{
  id: number
  type: string
  status: "pending"|"running"|"succeeded"|"failed"|"interrupted"|"aborted"
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}
```

parse 失败降级为 null。`runner` 实例需在 `route` 闭包可访问（模块级单例，与 `store` 同生命周期）。

### 7.4 错误映射

复用现有 `toErrorResponse`（`ExtractorError` 用 `statusCode`）：

| 场景 | HTTP | body |
| --- | --- | --- |
| `POST /jobs` type 未注册 | 400 | `{error:"unknown job type"}` |
| `POST /jobs` 同 type 已 running | 409 | `{error:"job already running"}` |
| `GET/DELETE /jobs/:id` 不存在 | 404 | `{error:"job not found"}` |
| `POST /jobs/:id/stop` 非 running | 409 | `{error:"cannot stop job in status: X"}` |
| `DELETE /jobs/:id` 删 running | 409 | `{error:"cannot delete running job"}` |
| `POST /jobs/:id/stop` 不存在 | 404 | `{error:"job not found"}` |
| 参数校验失败 | 400 | `{error:"invalid ..."}` |

## 8. 前端（`apps/web`）

### 8.1 新增文件

```
apps/web/src/pages/JobsPage.tsx          # 任务管理
apps/web/src/pages/ArchivePage.tsx       # 归档目录
apps/web/src/components/JobRow.tsx       # 单个 job 行（status badge + 操作）
apps/web/src/components/JobLogPanel.tsx  # 日志展开面板（轮询）
apps/web/src/lib/jobs.ts                 # job API 封装 + 类型
```

### 8.2 `lib/jobs.ts`

```ts
export type JobStatus = "pending"|"running"|"succeeded"|"failed"|"interrupted"|"aborted"
export interface Job {
  id: number; type: string; status: JobStatus
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  started_at: number | null; finished_at: number | null
  created_at: number
}
export interface JobLog { id: number; job_id: number; level: "info"|"warn"|"error"; message: string; created_at: number }

export async function startJob(type: string, payload?: Record<string, unknown>): Promise<Job>
export async function listJobs(opts?: { type?: string; status?: string }): Promise<{ items: Job[] }>
export async function getJob(id: number): Promise<Job>
export async function getJobLogs(id: number, opts?: { level?: string }): Promise<{ items: JobLog[] }>
export async function stopJob(id: number): Promise<void>
export async function deleteJob(id: number): Promise<void>
export async function clearFinishedJobs(): Promise<{ removed: number }>
```

### 8.3 JobsPage 状态机

- 加载时 `GET /jobs` 列表。
- 顶部「开始归档」按钮 → `POST /jobs {type:"archive_posts"}` → 把返回 job 插到列表头 → 设为轮询目标。
- 轮询间隔：用户可调（下拉 1s/2s/5s/10s），值存 `localStorage`（key `purifier:jobs:pollMs`），默认 1500。
- running job：按轮询间隔 `GET /jobs/:id` + `GET /jobs/:id/logs`，status 变终态后停轮询。
- 点「停止」→ `POST /jobs/:id/stop` → 继续轮询直到 status 变 aborted。
- 点「删除」→ 确认 → `DELETE /jobs/:id` → 移除。
- 顶部「清空已结束」→ `DELETE /jobs` → 重新加载列表。
- status badge 配色：running 蓝、succeeded 绿、failed 红、interrupted/aborted 灰。

### 8.4 ArchivePage 状态机

- 加载时 `GET /api/me/archive?sort=title&...`。
- 搜索框输入 → debounce → 带 `q` 重新查。
- 排序 tab（标题 / 最新 / 最近更新）→ 带 `sort` 重新查。
- 分页：沿用现有 `nextPage` 机制。
- 每条：标题（链到 `/read/:tid`）+ tid + archived_at（小字）。
- 空状态：「还没有归档，去 /jobs 开始一次归档任务」。

### 8.5 路由与导航

`App.tsx` 注册：

```ts
<Route path="/jobs" element={<JobsPage />} />
<Route path="/archive" element={<ArchivePage />} />
```

`routes.ts`：

```ts
export const routes = { ..., archive: "/archive", jobs: "/jobs" } as const
export const api = { ..., meJobs: "/api/me/jobs", meArchive: "/api/me/archive" } as const
```

`NAV_ITEMS` 加两项（位置在「分组」与「历史」之间）：

```ts
{ href: routes.archive, label: "归档", sites: ["1"], match: p => p === routes.archive },
{ href: routes.jobs,     label: "任务", sites: ["1","2"], match: p => p === routes.jobs },
```

`archive` 限 sites:["1"]（归档仅支持 cool18）；`jobs` 限 sites:["1","2"]（任务页两站都可进，但归档按钮在 site=2 时前端禁用）。

## 9. 错误处理

### 9.1 Job 执行层

见 §6.2 `runJob`：try/catch/finally，`markFinished` 只在 finally 调一次。handler 正常返回但 signal.aborted → aborted；handler 抛错 → failed；不重试（YAGNI，单用户场景手动重跑）。

### 9.2 ArchivePostsJob 内部

单页失败 → warn 日志 + break + succeeded + `result.stoppedOnError=true`。不重试、不跳过。与 `loadCachedReplies` 的"失败回退缓存"不同：归档无缓存可回退，失败如实记录。

### 9.3 API 层

见 §7.4，复用 `toErrorResponse`。

### 9.4 archive_posts 的 site 校验

见 §6.3：site!=="1" 或 extractor 无 `fetchHomeLinks` → `ExtractorError("site does not support archive", 400)` → job 立即 failed + error 日志。前端按钮 site=2 时禁用。

## 10. 测试策略

### 10.1 Store 层（`packages/core/src/storage/`，`bun test`）

**`jobs.test.ts`**（新建）：

- `createJob` + `getJob` 往返；payload JSON 序列化往返。
- `markRunning` 状态流转（pending→running）。
- `markFinished` 各终态、`finished_at` 写入。
- `hasRunningOfType` 单例检测。
- `clearFinishedJobs` 只删终态、保留 running/pending、CASCADE 清日志。
- `markStaleRunningAsInterrupted` 只影响 running、返回正确计数。
- `appendJobLog` + `listJobLogs` ASC 排序、level 过滤、limit/offset。

**`archive.test.ts`**（新建）：

- `upsertArchivePosts` 全新批 → inserted=N, updated=0。
- 标题不变批 → inserted=0, updated=0（整条跳过，archived_at 不变）。
- 标题变化批 → inserted=0, updated=N，archived_at 更新、first_seen_at 保留。
- 混合批（新 + 变 + 不变）→ 三类计数正确。
- 空批早返回。
- `listArchivePosts` 三种 sort + q 过滤 + 分页 + 白名单校验（非法 sort 抛错）。

Store 测试沿用现有风格（内存 DB、注入时钟 `() => fixedTs`、断言 plain object）。

### 10.2 JobRunner 层（`packages/core/src/jobs/runner.test.ts`，新建）

用 fake handler（不碰真实 extractor）：

```ts
class FakeHandler implements JobHandler {
  type = "fake"
  ticks = 0
  async run(ctx) {
    ctx.log("info", "start")
    for (let i = 0; i < 3; i++) {
      if (ctx.signal.aborted) break
      await sleep(10)
      this.ticks++
      ctx.log("info", `tick ${i}`)
    }
    return { ticks: this.ticks }
  }
}
```

测试场景：

- 正常完成 → succeeded，result 写入，logs 4 条。
- `stop()` 中途 → aborted，logs 截断。
- 同 type 二次 start → 抛 409。
- `recoverOnStartup` → 残留 running 标 interrupted。
- handler 抛错 → failed，error 写入。
- markFinished 只调一次（spy 验证）。

### 10.3 ArchivePostsJob（`packages/core/src/jobs/handlers/archive_posts.test.ts`，新建）

mock `extractor.fetchHomeLinks`（返回构造的 `HomePage`）：

- 多页正常 → result `{pages, inserted, updated}` 正确。
- 限速 delayMs 生效（fake timer 验证 sleep 调用）。
- 单页抛错 → warn 日志 + break + succeeded + result.stoppedOnError。
- abort 中途 → logs 含 "aborted by user"，result 反映已处理页数。
- site!=="1" → 立即 failed。

### 10.4 API 层

不写测试（与现有项目一致）。Store 与 Runner 测试覆盖核心逻辑，API 是薄封装，靠类型检查 + 手动验证。

### 10.5 验证命令

```bash
bun run test          # core 测试
bun run typecheck     # 全仓类型
bun run build         # 构建
```

## 11. 实现顺序（建议）

1. **DB + Store**：三张表 + Job/Log/Archive 全部 Store 方法 + 类型 + 测试（§4、§5、§10.1）。
2. **JobRunner + handler 接口**：runner + fake handler 测试（§6.1、§6.2、§10.2）。
3. **ArchivePostsJob**：handler 实现 + 测试（§6.3、§10.3）。
4. **API 端点**：jobs + archive 全部端点 + wiring（§7）。
5. **前端 lib + 两个页面**：`lib/jobs.ts` + JobsPage + ArchivePage + 路由 + 导航（§8）。
6. **验证**：`bun run test && bun run typecheck && bun run build`，手动跑一次归档验证端到端。

每步完成后跑对应测试，最后全量验证。
