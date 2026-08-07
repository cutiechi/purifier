# 任务系统 · 全站主帖归档 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立进程内长跑任务系统（`JobRunner` + `JobHandler` 扩展点），并以其第一个实例「全站主帖归档」循环翻页抓取所有主帖 tid+标题存入 `archive_posts` 表，前端提供 `/jobs` 任务管理页与 `/archive` 归档目录页。

**Architecture:** 三层。`packages/core` 新增 `jobs` / `job_logs` / `archive_posts` 三表，`Store` 增 Job/Log/Archive 方法，`jobs/` 目录放 `JobHandler` 接口 + `JobRunner` + `sleep` 工具 + `ArchivePostsJob`；`apps/api` 新增 `/api/me/jobs*` 路由（前缀匹配挂在 `switch` 前）+ `/api/me/archive`，启动时实例化 `JobRunner` 单例并 `recoverOnStartup`；`apps/web` 新增 `/jobs`、`/archive` 两页 + `lib/jobs.ts` API 封装。归档 v1 仅 cool18（site=1）。

**Tech Stack:** Bun + `bun:sqlite`、TypeScript strict、Vite + React 19 + React Router 7、Tailwind 4、lucide-react。

## Global Constraints

- 全仓 Prettier：**无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`**（所有代码块按此写）。
- TypeScript `strict`；核心验证 `cd packages/core && bun test`、`bun run typecheck`、`bun run build`。
- `/api/me/*` 响应一律 `NO_STORE_HEADERS`；错误体 `{ "error": "..." }`，`ExtractorError` 带 statusCode。
- `JobStatus` 六态：`pending` | `running` | `succeeded` | `failed` | `interrupted` | `aborted`。
- 归档 v1 仅 site=1（cool18 论坛主帖）；xbookcn 虽实现 `fetchHomeLinks` 但游标/内容语义不同，不接入。
- `markRunning(id): boolean` 返回 `changes>0`；`false` 时 `start()` 立即 `markFinished(id,"failed",...)` + 抛 500。
- `recoverOnStartup` 同时收 running 与 pending 两类崩溃残留 → interrupted。
- 写入策略：标题变了才 UPSERT（`first_seen_at` 保留、`archived_at` 刷新）；空标题 handler 写入前丢弃。
- 单页 `fetchHomeLinks` 失败 → `lastError` + break + 循环结束抛错 → Runner 标 failed。
- 游标终止：`nextMtid` 为 null → 停；仅当 `mtid!=="0"` 且数值 `nextMtid>=mtid` → 停（防卡死）；首页 mtid="0" 不当上界。
- delayMs clamp 到 [200,5000]，非法回落 800，不报错。
- `archive_posts` 索引：title / archived_at 建二级；tid 排序依赖主键 `(site,tid)`。
- App.tsx 全部同步 import；路由注册在 catch-all `path="*"` 之前。
- 组件不做单测（仓库无组件测试基建），靠 typecheck + 手动验证；纯函数与 Store/Runner 进 `bun test`。

## File Structure

**Create:**
- `packages/core/src/jobs/handler.ts` — `JobHandler` / `JobContext` / `JobResult` 接口（`JobStatus` 等数据类型在 `storage/types.ts`，不在此重复导出）。
- `packages/core/src/jobs/runner.ts` — `JobRunner` 类。
- `packages/core/src/jobs/sleep.ts` — abort-aware `sleep` 工具。
- `packages/core/src/jobs/handlers/archive_posts.ts` — `ArchivePostsJob`。
- `packages/core/src/jobs/index.ts` — barrel（不含测试 FakeHandler）。
- `packages/core/src/storage/jobs.test.ts` — Store Job/Log 方法测试。
- `packages/core/src/storage/archive.test.ts` — Store Archive 方法测试。
- `packages/core/src/jobs/runner.test.ts` — JobRunner 测试（FakeHandler 内联）。
- `packages/core/src/jobs/handlers/archive_posts.test.ts` — ArchivePostsJob 测试。
- `apps/web/src/lib/jobs.ts` — job API 封装 + 类型。
- `apps/web/src/pages/JobsPage.tsx` — 任务管理页。
- `apps/web/src/pages/ArchivePage.tsx` — 归档目录页。
- `apps/web/src/components/job-row.tsx` — 单个 job 行。
- `apps/web/src/components/job-log-panel.tsx` — 日志面板（desc 拉尾 + UI 反转）。

**Modify:**
- `packages/core/src/storage/db.ts` — DDL 追加三表 + 索引。
- `packages/core/src/storage/types.ts` — 追加 Job/JobLog/ArchivePost/JobStatus 等类型。
- `packages/core/src/storage/store.ts` — 追加 Job/Log/Archive 方法。
- `packages/core/src/index.ts` — 追加 `export * from "./jobs"`。
- `apps/api/src/index.ts` — 新增 handler 函数 + 路由分支 + 启动 wiring。
- `apps/web/src/lib/routes.ts` — 追加 `archive` / `jobs` 路由与 `meJobs` / `meArchive` API 常量 + 导航项。
- `apps/web/src/App.tsx` — 注册两路由。

---

## Task 1: DB 三表 + 类型

**Files:**
- Modify: `packages/core/src/storage/db.ts`
- Modify: `packages/core/src/storage/types.ts`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `openDatabase()` 建出 `jobs` / `job_logs` / `archive_posts` 三表；类型 `JobStatus` / `Job` / `JobLogLevel` / `JobLog` / `ArchivePost` 导出。

- [ ] **Step 1: 写失败测试**

在 `store.test.ts` 找到现有的 `creates items/favorites/tags/groups tables` 用例（断言 `sqlite_master` 表名列表），把三张新表加入期望列表（保持字母序）：

```ts
expect(rows.map((r) => r.name)).toEqual([
  "archive_posts",
  "favorites",
  "group_items",
  "groups",
  "items",
  "job_logs",
  "jobs",
  "tags",
])
```

并在该用例末尾（`db.close()` 前）追加 archive_posts 索引存在性断言：

```ts
const idx = db
  .query(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='archive_posts' ORDER BY name"
  )
  .all() as { name: string }[]
expect(idx.map((r) => r.name)).toEqual([
  "archive_posts_site_archived_idx",
  "archive_posts_site_title_idx",
])
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: FAIL（表名 mismatch，索引不存在）。

- [ ] **Step 3: 追加 DDL**

在 `db.ts` 的 `DDL` 常量末尾（`group_items` 表与现有索引之后）追加：

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

CREATE TABLE IF NOT EXISTS job_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS job_logs_job_created_idx ON job_logs(job_id, created_at);

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
CREATE INDEX IF NOT EXISTS archive_posts_site_archived_idx
  ON archive_posts(site, archived_at DESC);
```

- [ ] **Step 4: 追加类型**

在 `types.ts` 末尾追加：

```ts
export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload: string | null
  result: string | null
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

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/core && bun test src/storage/store.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/storage/db.ts packages/core/src/storage/types.ts packages/core/src/storage/store.test.ts
git commit -m "feat(core): add jobs/job_logs/archive_posts tables and types"
```

---

## Task 2: Store Job/Log 方法

**Files:**
- Modify: `packages/core/src/storage/store.ts`
- Test: `packages/core/src/storage/jobs.test.ts`（新建）

**Interfaces:**
- Consumes: `Job` / `JobStatus` / `JobLog` 类型（Task 1）。
- Produces: `Store.createJob` / `getJob` / `listJobs` / `markRunning` / `markFinished` / `hasRunningOfType` / `clearFinishedJobs` / `deleteJob` / `markStaleJobsInterrupted` / `appendJobLog` / `listJobLogs`。

- [ ] **Step 1: 写失败测试**

新建 `packages/core/src/storage/jobs.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-jobs-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

describe("jobs store", () => {
  test("createJob + getJob 往返；payload JSON 序列化", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", { site: "1", delayMs: 800 })
    expect(job.id).toBeGreaterThan(0)
    expect(job.status).toBe("pending")
    expect(job.type).toBe("archive_posts")
    expect(job.payload).toBe(JSON.stringify({ site: "1", delayMs: 800 }))
    expect(job.result).toBeNull()
    expect(job.created_at).toBe(1_000)
    const got = store.getJob(job.id)
    expect(got?.id).toBe(job.id)
    expect(store.getJob(9999)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("markRunning pending→running 返回 true；非 pending 返回 false", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    expect(store.markRunning(job.id)).toBe(true)
    const running = store.getJob(job.id)!
    expect(running.status).toBe("running")
    expect(running.started_at).toBe(1_001)
    // 再 mark 一次（已 running）→ false
    expect(store.markRunning(job.id)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("markFinished 写终态 + finished_at + result/error", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    store.markFinished(job.id, "succeeded", { pages: 3 }, null)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("succeeded")
    expect(done.result).toBe(JSON.stringify({ pages: 3 }))
    expect(done.error).toBeNull()
    expect(done.finished_at).toBe(1_002)
    rmSync(dir, { recursive: true, force: true })
  })

  test("hasRunningOfType 单例检测", () => {
    const { store, dir } = makeStore()
    expect(store.hasRunningOfType("archive_posts")).toBe(false)
    const job = store.createJob("archive_posts", null)
    store.markRunning(job.id)
    expect(store.hasRunningOfType("archive_posts")).toBe(true)
    store.markFinished(job.id, "succeeded", null, null)
    expect(store.hasRunningOfType("archive_posts")).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listJobs type/status 过滤 + created_at DESC", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null)
    const b = store.createJob("other", null)
    store.markRunning(a.id)
    const all = store.listJobs({ limit: 100, offset: 0 })
    expect(all.map((j) => j.id)).toEqual([b.id, a.id]) // DESC by created_at
    const archived = store.listJobs({ type: "archive_posts", limit: 100, offset: 0 })
    expect(archived.map((j) => j.id)).toEqual([a.id])
    const running = store.listJobs({ status: "running", limit: 100, offset: 0 })
    expect(running.map((j) => j.id)).toEqual([a.id])
    rmSync(dir, { recursive: true, force: true })
  })

  test("clearFinishedJobs 只删终态、CASCADE 清日志、保留 running/pending", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null) // pending
    const b = store.createJob("archive_posts", null)
    store.markRunning(b.id)
    store.markFinished(b.id, "succeeded", null, null)
    store.appendJobLog(b.id, "info", "done")
    const removed = store.clearFinishedJobs()
    expect(removed).toBe(1)
    expect(store.getJob(a.id)?.status).toBe("pending") // 保留
    expect(store.getJob(b.id)).toBeNull() // 终态已删
    const logs = store.listJobLogs(b.id, { limit: 100, offset: 0 })
    expect(logs).toHaveLength(0) // CASCADE 清掉
    rmSync(dir, { recursive: true, force: true })
  })

  test("markStaleJobsInterrupted 同时清 running 与 pending", () => {
    const { store, dir } = makeStore()
    const a = store.createJob("archive_posts", null) // pending
    const b = store.createJob("archive_posts", null)
    store.markRunning(b.id) // running
    const removed = store.markStaleJobsInterrupted()
    expect(removed).toBe(2)
    expect(store.getJob(a.id)?.status).toBe("interrupted")
    expect(store.getJob(b.id)?.status).toBe("interrupted")
    rmSync(dir, { recursive: true, force: true })
  })

  test("deleteJob 删 job；CASCADE 清日志；幂等", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.appendJobLog(job.id, "info", "x")
    store.deleteJob(job.id)
    expect(store.getJob(job.id)).toBeNull()
    expect(store.listJobLogs(job.id, { limit: 10, offset: 0 })).toHaveLength(0)
    expect(() => store.deleteJob(job.id)).not.toThrow() // 幂等
    rmSync(dir, { recursive: true, force: true })
  })

  test("appendJobLog + listJobLogs ASC/DESC + level 过滤", () => {
    const { store, dir } = makeStore()
    const job = store.createJob("archive_posts", null)
    store.appendJobLog(job.id, "info", "first")
    store.appendJobLog(job.id, "warn", "second")
    store.appendJobLog(job.id, "error", "third")
    const asc = store.listJobLogs(job.id, { limit: 100, offset: 0 })
    expect(asc.map((l) => l.message)).toEqual(["first", "second", "third"])
    const desc = store.listJobLogs(job.id, { limit: 100, offset: 0, order: "desc" })
    expect(desc.map((l) => l.message)).toEqual(["third", "second", "first"])
    const warns = store.listJobLogs(job.id, {
      limit: 100,
      offset: 0,
      level: "warn",
    })
    expect(warns.map((l) => l.message)).toEqual(["second"])
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/jobs.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现 Store 方法**

在 `store.ts` 的 `Store` 类内（`close()` 之前）追加。先在文件顶部 import 块把新类型加进来（与现有 `Group` 等并列）：

```ts
import {
  ArchivePost,
  Group,
  GroupMember,
  ItemKind,
  ItemState,
  Job,
  JobLog,
  JobLogLevel,
  JobStatus,
  ListItem,
  ListQuery,
  ListResult,
  TagCount,
  PAGE_SIZE,
} from "./types"
```

然后在类内追加方法：

```ts
  // --- Jobs ---

  createJob(
    type: string,
    payload: Record<string, unknown> | null
  ): Job {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO jobs (type, status, payload, result, error, started_at, finished_at, created_at)
         VALUES (?1, 'pending', ?2, NULL, NULL, NULL, NULL, ?3)`
      )
      .run(type, payload === null ? null : JSON.stringify(payload), now)
    const id = Number(
      (this.db.query("SELECT last_insert_rowid() AS i").get() as { i: number }).i
    )
    return this.getJob(id)!
  }

  getJob(id: number): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?1").get(id) as
      | (Omit<Job, "status"> & { status: string })
      | null
    if (!row) return null
    return { ...row, status: row.status as JobStatus }
  }

  listJobs(opts: {
    type?: string
    status?: string
    limit: number
    offset: number
  }): Job[] {
    const rows = this.db
      .query(
        `SELECT * FROM jobs
         WHERE (?1 IS NULL OR type = ?1)
           AND (?2 IS NULL OR status = ?2)
         ORDER BY created_at DESC, id DESC
         LIMIT ?3 OFFSET ?4`
      )
      .all(opts.type ?? null, opts.status ?? null, opts.limit, opts.offset) as
      | (Omit<Job, "status"> & { status: string })[]
    return rows.map((r) => ({ ...r, status: r.status as JobStatus }))
  }

  markRunning(id: number): boolean {
    const res = this.db
      .query(
        "UPDATE jobs SET status='running', started_at=?2 WHERE id=?1 AND status='pending'"
      )
      .run(id, this.now())
    return Number(res.changes ?? 0) > 0
  }

  markFinished(
    id: number,
    status: "succeeded" | "failed" | "interrupted" | "aborted",
    result: Record<string, unknown> | null,
    error: string | null
  ): void {
    this.db
      .query(
        `UPDATE jobs SET status=?2, finished_at=?3, result=?4, error=?5 WHERE id=?1`
      )
      .run(
        id,
        status,
        this.now(),
        result === null ? null : JSON.stringify(result),
        error
      )
  }

  hasRunningOfType(type: string): boolean {
    const row = this.db
      .query(
        "SELECT 1 FROM jobs WHERE type=?1 AND status='running' LIMIT 1"
      )
      .get(type)
    return !!row
  }

  clearFinishedJobs(): number {
    const res = this.db
      .query(
        `DELETE FROM jobs WHERE status IN ('succeeded','failed','interrupted','aborted')`
      )
      .run()
    return Number(res.changes ?? 0)
  }

  deleteJob(id: number): void {
    this.db.query("DELETE FROM jobs WHERE id=?1").run(id)
  }

  markStaleJobsInterrupted(): number {
    const res = this.db
      .query(
        `UPDATE jobs SET status='interrupted', finished_at=?1
         WHERE status IN ('running','pending')`
      )
      .run(this.now())
    return Number(res.changes ?? 0)
  }

  appendJobLog(jobId: number, level: JobLogLevel, message: string): void {
    this.db
      .query(
        "INSERT INTO job_logs (job_id, level, message, created_at) VALUES (?1,?2,?3,?4)"
      )
      .run(jobId, level, message, this.now())
  }

  listJobLogs(
    jobId: number,
    opts: {
      limit: number
      offset: number
      level?: string
      order?: "asc" | "desc"
    }
  ): JobLog[] {
    const order = opts.order === "desc" ? "DESC" : "ASC"
    return this.db
      .query(
        `SELECT * FROM job_logs
         WHERE job_id=?1 AND (?2 IS NULL OR level=?2)
         ORDER BY created_at ${order}, id ${order}
         LIMIT ?3 OFFSET ?4`
      )
      .all(
        jobId,
        opts.level ?? null,
        opts.limit,
        opts.offset
      ) as JobLog[]
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && bun test src/storage/jobs.test.ts`
Expected: PASS（全部 9 条）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/jobs.test.ts
git commit -m "feat(core): Store methods for jobs and job logs"
```

---

## Task 3: Store Archive 方法

**Files:**
- Modify: `packages/core/src/storage/store.ts`
- Test: `packages/core/src/storage/archive.test.ts`（新建）

**Interfaces:**
- Consumes: `ArchivePost` 类型（Task 1）。
- Produces: `Store.upsertArchivePosts(site, items, ts)` → `{inserted, updated}`；`Store.listArchivePosts(site, opts)` → `{items, nextPage?}`。

- [ ] **Step 1: 写失败测试**

新建 `packages/core/src/storage/archive.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store } from "./store"

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-"))
  const db = openDatabase(dir)
  let t = 5_000
  const store = new Store(db, () => t++)
  return { store, db, dir }
}

describe("archive store", () => {
  test("upsertArchivePosts 全新批 → inserted=N, updated=0", () => {
    const { store, dir } = makeStore()
    const res = store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "A" },
        { tid: "101", title: "B" },
      ],
      9_000
    )
    expect(res).toEqual({ inserted: 2, updated: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("标题不变批 → inserted=0, updated=0，archived_at 不变", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts(
      "1",
      [{ tid: "100", title: "A" }],
      9_000
    )
    const res = store.upsertArchivePosts(
      "1",
      [{ tid: "100", title: "A" }],
      99_000
    )
    expect(res).toEqual({ inserted: 0, updated: 0 })
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items[0]!.archived_at).toBe(9_000) // 未刷新
    expect(list.items[0]!.first_seen_at).toBe(9_000)
    rmSync(dir, { recursive: true, force: true })
  })

  test("标题变化批 → updated=N，archived_at 刷新、first_seen_at 保留", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts("1", [{ tid: "100", title: "A" }], 9_000)
    const res = store.upsertArchivePosts(
      "1",
      [{ tid: "100", title: "A 改" }],
      99_000
    )
    expect(res).toEqual({ inserted: 0, updated: 1 })
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items[0]!.title).toBe("A 改")
    expect(list.items[0]!.archived_at).toBe(99_000)
    expect(list.items[0]!.first_seen_at).toBe(9_000)
    rmSync(dir, { recursive: true, force: true })
  })

  test("混合批（新+变+不变）三类计数", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "旧A" },
        { tid: "101", title: "不变B" },
      ],
      9_000
    )
    const res = store.upsertArchivePosts(
      "1",
      [
        { tid: "100", title: "新A" }, // 变
        { tid: "101", title: "不变B" }, // 不变
        { tid: "102", title: "C" }, // 新
      ],
      99_000
    )
    expect(res).toEqual({ inserted: 1, updated: 1 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("空批早返回 {0,0}", () => {
    const { store, dir } = makeStore()
    expect(store.upsertArchivePosts("1", [], 9_000)).toEqual({
      inserted: 0,
      updated: 0,
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("listArchivePosts 三种 sort + q 过滤 + 分页", () => {
    const { store, dir } = makeStore()
    store.upsertArchivePosts(
      "1",
      [
        { tid: "300", title: "香蕉" },
        { tid: "100", title: "苹果" },
        { tid: "200", title: "Apple" },
      ],
      9_000
    )
    // sort title asc（NOCASE）
    const byTitle = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "title",
    })
    expect(byTitle.items.map((i) => i.title)).toEqual([
      "Apple",
      "苹果",
      "香蕉",
    ])
    // sort tid desc
    const byTid = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(byTid.items.map((i) => i.tid)).toEqual(["300", "200", "100"])
    // sort archived_at desc（同 ts，按 tid desc 兜底由 SQL 决定，此处只验数量）
    const byArchived = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "archived_at",
    })
    expect(byArchived.items).toHaveLength(3)
    // q 过滤
    const q = store.listArchivePosts("1", {
      q: "app",
      page: 1,
      limit: 10,
      sort: "title",
    })
    expect(q.items.map((i) => i.title)).toEqual(["Apple"])
    // 分页 nextPage
    const page1 = store.listArchivePosts("1", {
      page: 1,
      limit: 2,
      sort: "tid",
    })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextPage).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("listArchivePosts 非法 sort 抛错", () => {
    const { store, dir } = makeStore()
    expect(() =>
      store.listArchivePosts("1", {
        page: 1,
        limit: 10,
        // @ts-expect-error 测试非法入参
        sort: "evil; DROP TABLE",
      })
    ).toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/storage/archive.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现 Store 方法**

在 `store.ts` 的 `Store` 类内（Task 2 方法之后、`close()` 之前）追加。先把 `ArchivePost` 加进顶部 import（Task 2 已加）。

```ts
  // --- Archive ---

  upsertArchivePosts(
    site: string,
    items: Array<{ tid: string; title: string }>,
    ts: number
  ): { inserted: number; updated: number } {
    if (items.length === 0) return { inserted: 0, updated: 0 }
    const run = this.db.transaction(() => {
      const tids = items.map((i) => i.tid)
      const placeholders = tids.map(() => "?").join(",")
      const rows = this.db
        .query(
          `SELECT tid, title FROM archive_posts WHERE site=? AND tid IN (${placeholders})`
        )
        .all(site, ...tids) as { tid: string; title: string }[]
      const oldTitle = new Map(rows.map((r) => [r.tid, r.title]))

      let inserted = 0
      let updated = 0
      const stmt = this.db.query(
        `INSERT INTO archive_posts (site, tid, title, first_seen_at, archived_at)
         VALUES (?1,?2,?3,?4,?4)
         ON CONFLICT(site,tid) DO UPDATE SET
           title=excluded.title, archived_at=excluded.archived_at`
      )
      for (const it of items) {
        const old = oldTitle.get(it.tid)
        if (old === it.title) continue // 标题没变，整条跳过
        stmt.run(site, it.tid, it.title, ts)
        if (old === undefined) inserted++
        else updated++
      }
      return { inserted, updated }
    })
    return run()
  }

  listArchivePosts(
    site: string,
    opts: {
      q?: string
      page: number
      limit: number
      sort: "title" | "tid" | "archived_at"
      order?: "asc" | "desc"
    }
  ): { items: ArchivePost[]; nextPage?: number } {
    const SORT_COL: Record<typeof opts.sort, string> = {
      title: "title COLLATE NOCASE",
      tid: "tid",
      archived_at: "archived_at",
    }
    const sortCol = SORT_COL[opts.sort]
    if (!sortCol) throw new Error(`invalid sort: ${opts.sort}`)
    // 默认 order：title→asc、tid/archived_at→desc
    const order =
      opts.order ?? (opts.sort === "title" ? "asc" : "desc")
    if (order !== "asc" && order !== "desc") {
      throw new Error(`invalid order: ${order}`)
    }
    const page = Math.max(1, opts.page)
    const q = opts.q?.trim() ?? ""
    const rows = this.db
      .query(
        `SELECT * FROM archive_posts
         WHERE site=?1
           AND (?2 = '' OR title LIKE '%' || ?2 || '%' COLLATE NOCASE)
         ORDER BY ${sortCol} ${order.toUpperCase()}, tid ${order.toUpperCase()}
         LIMIT ?3 OFFSET ?4`
      )
      .all(site, q, opts.limit + 1, (page - 1) * opts.limit) as ArchivePost[]
    const hasMore = rows.length > opts.limit
    const items = hasMore ? rows.slice(0, opts.limit) : rows
    return {
      items,
      nextPage: hasMore ? page + 1 : undefined,
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && bun test src/storage/archive.test.ts`
Expected: PASS（全部 7 条）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/store.ts packages/core/src/storage/archive.test.ts
git commit -m "feat(core): Store methods for archive_posts (upsert + list)"
```

---

## Task 4: sleep 工具 + JobHandler 接口

**Files:**
- Create: `packages/core/src/jobs/sleep.ts`
- Create: `packages/core/src/jobs/handler.ts`
- Test: `packages/core/src/jobs/sleep.test.ts`（新建）

**Interfaces:**
- Consumes: 无。
- Produces: `sleep(ms, signal?): Promise<void>`（signal 可选；传则 abort 时 clearTimeout）；`JobHandler` / `JobContext` / `JobResult` 接口。

- [ ] **Step 1: 写失败测试**

新建 `packages/core/src/jobs/sleep.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { sleep } from "./sleep"

describe("sleep", () => {
  test("正常等待后 resolve", async () => {
    const start = Date.now()
    await sleep(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(20)
  })

  test("abort 立即 resolve，不等完整 delay", async () => {
    const controller = new AbortController()
    const start = Date.now()
    const p = sleep(1000, controller.signal)
    controller.abort()
    await p
    expect(Date.now() - start).toBeLessThan(100)
  })

  test("已 aborted 的 signal 立即 resolve", async () => {
    const controller = new AbortController()
    controller.abort()
    const start = Date.now()
    await sleep(1000, controller.signal)
    expect(Date.now() - start).toBeLessThan(50)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/jobs/sleep.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 sleep**

新建 `packages/core/src/jobs/sleep.ts`：

```ts
/**
 * abort-aware sleep：传 signal 时，abort 立即 clearTimeout 并 resolve（不泄漏 timer、不等完整 delay）。
 * signal 可选：不传则退化为普通 setTimeout（测试与无取消需求场景用）。
 */
export function sleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) return resolve()
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
```

- [ ] **Step 4: 实现 JobHandler 接口**

新建 `packages/core/src/jobs/handler.ts`：

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
  /** 该 handler 处理的 job type */
  type: string
  /** 抛错 → Runner 标 failed；正常返回 → succeeded（除非 signal.aborted → aborted） */
  run(ctx: JobContext): Promise<JobResult>
}
```

`JobStatus` / `Job` / `JobLog` / `ArchivePost` 类型由 `storage/types.ts` 提供（Task 1），不在此重复导出，避免 `export *` 汇聚冲突。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/core && bun test src/jobs/sleep.test.ts`
Expected: PASS（3 条）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/jobs/sleep.ts packages/core/src/jobs/handler.ts packages/core/src/jobs/sleep.test.ts
git commit -m "feat(core): abort-aware sleep + JobHandler interface"
```

---

## Task 5: JobRunner

**Files:**
- Create: `packages/core/src/jobs/runner.ts`
- Test: `packages/core/src/jobs/runner.test.ts`（新建）

**Interfaces:**
- Consumes: `Store`（Task 2/3）；`JobHandler` / `JobContext` / `JobResult`（Task 4）。
- Produces: `JobRunner` 类（`register` / `start` / `stop` / `recoverOnStartup`）。

- [ ] **Step 1: 写失败测试**

新建 `packages/core/src/jobs/runner.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../storage/db"
import { Store } from "../storage/store"
import { sleep } from "./sleep"
import type { JobHandler, JobContext, JobResult } from "./handler"
import { JobRunner } from "./runner"

function makeRunner() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-runner-"))
  const db = openDatabase(dir)
  let t = 1_000
  const store = new Store(db, () => t++)
  const runner = new JobRunner(store)
  return { runner, store, dir }
}

class FakeHandler implements JobHandler {
  type = "fake"
  ticks = 0
  async run(ctx: JobContext): Promise<JobResult> {
    ctx.log("info", "start")
    for (let i = 0; i < 3; i++) {
      if (ctx.signal.aborted) break
      await sleep(5)
      this.ticks++
      ctx.log("info", `tick ${i}`)
    }
    return { ticks: this.ticks }
  }
}

class FailingHandler implements JobHandler {
  type = "failing"
  async run(): Promise<JobResult> {
    throw new Error("boom")
  }
}

describe("JobRunner", () => {
  test("正常完成 → succeeded，result 写入，logs 齐全", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FakeHandler())
    const job = await runner.start("fake")
    expect(job.status).toBe("running")
    // 等异步完成
    await sleep(80)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("succeeded")
    expect(done.result).toBe(JSON.stringify({ ticks: 3 }))
    const logs = store.listJobLogs(job.id, { limit: 100, offset: 0 })
    expect(logs.map((l) => l.message)).toEqual([
      "start",
      "tick 0",
      "tick 1",
      "tick 2",
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test("stop 中途 → aborted，logs 截断，sleep 不等完整 delay", async () => {
    const { runner, store, dir } = makeRunner()
    const handler = new FakeHandler()
    runner.register(handler)
    const job = await runner.start("fake")
    await sleep(8) // 让它跑 1-2 tick
    expect(runner.stop(job.id)).toBe(true)
    await sleep(50) // 等 finally
    const done = store.getJob(job.id)!
    expect(done.status).toBe("aborted")
    expect(handler.ticks).toBeLessThan(3)
    rmSync(dir, { recursive: true, force: true })
  })

  test("同 type 二次 start → 抛错（单例）", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FakeHandler())
    const job = await runner.start("fake")
    await expect(runner.start("fake")).rejects.toThrow(/already running/)
    // 清理：停掉后台 job 并等 finally，避免写已删目录
    runner.stop(job.id)
    await sleep(40)
    void store
    rmSync(dir, { recursive: true, force: true })
  })

  test("handler 抛错 → failed + error 写入", async () => {
    const { runner, store, dir } = makeRunner()
    runner.register(new FailingHandler())
    const job = await runner.start("failing")
    await sleep(30)
    const done = store.getJob(job.id)!
    expect(done.status).toBe("failed")
    expect(done.error).toContain("boom")
    rmSync(dir, { recursive: true, force: true })
  })

  test("recoverOnStartup 同时清 running 与 pending", () => {
    const { runner, store, dir } = makeRunner()
    // 手动塞两个残留行
    const a = store.createJob("fake", null) // pending
    const b = store.createJob("fake", null)
    store.markRunning(b.id)
    runner.recoverOnStartup()
    expect(store.getJob(a.id)?.status).toBe("interrupted")
    expect(store.getJob(b.id)?.status).toBe("interrupted")
    rmSync(dir, { recursive: true, force: true })
  })

  test("未知 type → 抛错", async () => {
    const { runner, dir } = makeRunner()
    await expect(runner.start("unknown")).rejects.toThrow(/unknown job type/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/jobs/runner.test.ts`
Expected: FAIL（`runner` 模块不存在）。

- [ ] **Step 3: 实现 JobRunner**

新建 `packages/core/src/jobs/runner.ts`：

```ts
import { ExtractorError } from "../extractor"
import type { Store } from "../storage/store"
import type { Job } from "../storage/types"
import type { JobHandler, JobContext, JobResult } from "./handler"

export class JobRunner {
  private running = new Map<number, AbortController>()

  constructor(
    private store: Store,
    private handlers: Map<string, JobHandler> = new Map()
  ) {}

  register(h: JobHandler): void {
    this.handlers.set(h.type, h)
  }

  async start(
    type: string,
    payload?: Record<string, unknown>
  ): Promise<Job> {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new ExtractorError("unknown job type", 400)
    }
    if (this.store.hasRunningOfType(type)) {
      throw new ExtractorError("job already running", 409)
    }
    const job = this.store.createJob(type, payload ?? null)
    const ok = this.store.markRunning(job.id)
    if (!ok) {
      // 行已不在 pending（异常路径）：兜底转 failed，避免悬挂 pending
      this.store.markFinished(
        job.id,
        "failed",
        null,
        "failed to mark running"
      )
      throw new ExtractorError("failed to start job", 500)
    }
    const controller = new AbortController()
    this.running.set(job.id, controller)
    // 不 await：后台跑，立即返回 running job
    void this.runJob(job.id, handler, payload ?? {}, controller.signal)
    return this.store.getJob(job.id)!
  }

  /** 触发 abort；返回是否命中在跑的 job。真正改 status 由 runJob finally 处理 */
  stop(jobId: number): boolean {
    const controller = this.running.get(jobId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /** 进程启动时调：崩溃残留的 running/pending 标 interrupted */
  recoverOnStartup(): void {
    this.store.markStaleJobsInterrupted()
  }

  private async runJob(
    jobId: number,
    handler: JobHandler,
    payload: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    const ctx: JobContext = {
      jobId,
      payload,
      signal,
      log: (level, message) =>
        this.store.appendJobLog(jobId, level, message),
    }
    let status: "succeeded" | "failed" | "aborted" = "succeeded"
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
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && bun test src/jobs/runner.test.ts`
Expected: PASS（6 条）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/jobs/runner.ts packages/core/src/jobs/runner.test.ts
git commit -m "feat(core): JobRunner with abort-based cancellation and recovery"
```

---

## Task 6: ArchivePostsJob

**Files:**
- Create: `packages/core/src/jobs/handlers/archive_posts.ts`
- Test: `packages/core/src/jobs/handlers/archive_posts.test.ts`（新建）

**Interfaces:**
- Consumes: `Store`（Task 3）；`resolveSite`（已有）；`HomePage` 类型（已有）；`sleep`（Task 4）；`JobHandler`（Task 4）。
- Produces: `ArchivePostsJob`（type="archive_posts"）。

- [ ] **Step 1: 写失败测试**

新建 `packages/core/src/jobs/handlers/archive_posts.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../../storage/db"
import { Store } from "../../storage/store"
import type { ChapterLink, HomePage } from "../../extractor"
import { ArchivePostsJob } from "./archive_posts"
import type { JobContext } from "../handler"

/** ChapterLink 必填 index；工厂补默认 0（handler 不读 index） */
function link(tid: string, title: string): ChapterLink {
  return { index: 0, tid, title }
}

function page(links: ChapterLink[], nextMtid: string | null): HomePage {
  return { links, nextMtid }
}

function makeJob() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-job-"))
  const db = openDatabase(dir)
  let t = 10_000
  const store = new Store(db, () => t++)
  const job = new ArchivePostsJob(store, () => t++)
  return { job, store, dir }
}

function makeCtx(payload: Record<string, unknown> = {}): {
  ctx: JobContext
  logs: Array<{ level: string; message: string }>
  controller: AbortController
} {
  const controller = new AbortController()
  const logs: Array<{ level: string; message: string }> = []
  const ctx: JobContext = {
    jobId: 1,
    log: (level, message) => logs.push({ level, message }),
    signal: controller.signal,
    payload,
  }
  return { ctx, logs, controller }
}

describe("ArchivePostsJob", () => {
  test("多页正常 → result 正确，游标推进到底", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("300", "C"), link("200", "B")], "200"),
      page([link("150", "A")], "150"),
      page([link("100", "旧")], null),
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const { ctx } = makeCtx({ delayMs: 200 }) // 合法下界，避免回落 800 拖慢
    const result = await job.run(ctx)
    expect(result).toEqual({ pages: 3, inserted: 4, updated: 0, site: "1" })
    const list = store.listArchivePosts("1", { page: 1, limit: 10, sort: "tid" })
    expect(list.items.map((x) => x.tid)).toEqual(["300", "200", "150", "100"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("重跑：标题不变跳过，变化计数 updated", async () => {
    const { job, dir } = makeJob()
    const p: HomePage = page([link("100", "A")], null)
    job.fetchPage = async () => p
    await job.run(makeCtx({ delayMs: 200 }).ctx)
    // 第二次：标题变了
    p.links[0]!.title = "A 改"
    const result = await job.run(makeCtx({ delayMs: 200 }).ctx)
    expect(result).toEqual({ pages: 1, inserted: 0, updated: 1, site: "1" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("游标起始 mtid=0 不被当成上界，正常推进（不只抓一页）", async () => {
    const { job, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("5000", "X")], "4000"),
      page([link("4000", "Y")], null),
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200 }).ctx)
    expect(result.pages).toBe(2) // 关键：不是 1
    rmSync(dir, { recursive: true, force: true })
  })

  test("单页抛错 → 抛错（Runner 标 failed），不重试不跳过", async () => {
    const { job, dir } = makeJob()
    let call = 0
    job.fetchPage = async () => {
      call++
      if (call === 2) throw new Error("upstream 502")
      return page([link("10", "A")], "10")
    }
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    await expect(job.run(ctx)).rejects.toThrow(/upstream 502/)
    expect(
      logs.some((l) => l.level === "warn" && /page 2 failed/.test(l.message))
    ).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("空标题项被丢弃，日志报 dropped", async () => {
    const { job, store, dir } = makeJob()
    job.fetchPage = async () =>
      page(
        [link("100", "A"), link("101", "   "), link("102", "")],
        null
      )
    const { ctx, logs } = makeCtx({ delayMs: 200 })
    await job.run(ctx)
    const list = store.listArchivePosts("1", {
      page: 1,
      limit: 10,
      sort: "tid",
    })
    expect(list.items.map((x) => x.tid)).toEqual(["100"])
    expect(logs.some((l) => /2 empty dropped/.test(l.message))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("abort 中途 → logs 含 aborted by user，result 反映已处理页", async () => {
    const { job, dir } = makeJob()
    const { ctx, logs, controller } = makeCtx({ delayMs: 200 })
    let call = 0
    job.fetchPage = async () => {
      call++
      if (call === 2) controller.abort()
      return page([link(String(call * 100), "T")], String(call * 100))
    }
    const result = await job.run(ctx)
    expect(result.pages).toBeGreaterThanOrEqual(1)
    expect(
      logs.some((l) => /aborted by user/.test(l.message))
    ).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("site!=='1' → 抛错", async () => {
    const { job, dir } = makeJob()
    const { ctx } = makeCtx({ site: "2" })
    await expect(job.run(ctx)).rejects.toThrow(/site: 2/)
    rmSync(dir, { recursive: true, force: true })
  })

  test("非法 delayMs（NaN/负/超 5000）回落 800", async () => {
    const { job, dir } = makeJob()
    job.fetchPage = async () => page([], null)
    for (const bad of [NaN, -1, 99999]) {
      const { ctx } = makeCtx({ delayMs: bad })
      // 不抛错即代表 clamp 生效（空页直接结束）
      await job.run(ctx)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && bun test src/jobs/handlers/archive_posts.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 ArchivePostsJob**

新建 `packages/core/src/jobs/handlers/archive_posts.ts`：

```ts
import { resolveSite } from "../../extractor"
import type { HomePage } from "../../extractor"
import type { Store } from "../../storage/store"
import { sleep } from "../sleep"
import type { JobContext, JobHandler, JobResult } from "../handler"

export class ArchivePostsJob implements JobHandler {
  type = "archive_posts"

  /**
   * 测试 seam：默认走真实 extractor.fetchHomeLinks；测试可覆盖。
   * 生产代码用 this.run 里的实现，这里给个可覆盖的实例方法。
   */
  fetchPage = async (mtid: string): Promise<HomePage> => {
    const extractor = resolveSite("1")
    return extractor.fetchHomeLinks(mtid)
  }

  constructor(
    private store: Store,
    private now: () => number = Date.now
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const site = String(ctx.payload.site ?? "1")
    // v1 仅 cool18（site=1）：论坛主帖目录。xbookcn 虽有 fetchHomeLinks，
    // 但其游标是页码递增、内容是小说卡片，语义与本 job 不同，不接入。
    if (site !== "1") {
      throw new Error(`archive not supported for site: ${site}`)
    }

    let mtid = "0"
    let pages = 0
    let inserted = 0
    let updated = 0
    let lastError: string | null = null
    const rawDelay = Number(ctx.payload.delayMs)
    const delayMs =
      Number.isFinite(rawDelay) && rawDelay >= 200 && rawDelay <= 5000
        ? rawDelay
        : 800

    while (!ctx.signal.aborted) {
      let page: HomePage
      try {
        page = await this.fetchPage(mtid)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        ctx.log("warn", `page ${pages + 1} failed: ${lastError}; stopping`)
        break
      }
      pages++
      if (page.links.length === 0) {
        ctx.log("info", `page ${pages}: empty, done`)
        break
      }
      const clean = page.links
        .map((l) => ({ tid: l.tid, title: l.title.trim() }))
        .filter((l) => l.tid && l.title)
      const dropped = page.links.length - clean.length
      const res = this.store.upsertArchivePosts(site, clean, this.now())
      inserted += res.inserted
      updated += res.updated
      ctx.log(
        "info",
        `page ${pages}: +${page.links.length} fetched (${res.inserted} new, ${res.updated} updated${dropped ? `, ${dropped} empty dropped` : ""}), nextMtid=${page.nextMtid}`
      )

      if (!page.nextMtid) {
        ctx.log("info", `reached end (no nextMtid)`)
        break
      }
      // 仅当游标未推进时停（防卡死）；首页 mtid="0" 不当上界；数值比较
      if (mtid !== "0" && Number(page.nextMtid) >= Number(mtid)) {
        ctx.log(
          "info",
          `reached end (cursor not advancing: ${page.nextMtid} >= ${mtid})`
        )
        break
      }
      mtid = page.nextMtid
      await sleep(delayMs, ctx.signal)
    }

    if (ctx.signal.aborted) ctx.log("warn", "aborted by user")
    const result: JobResult = { pages, inserted, updated, site }
    if (lastError) {
      throw new Error(`archive stopped on page error: ${lastError}`)
    }
    return result
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && bun test src/jobs/handlers/archive_posts.test.ts`
Expected: PASS（8 条）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/jobs/handlers/archive_posts.ts packages/core/src/jobs/handlers/archive_posts.test.ts
git commit -m "feat(core): ArchivePostsJob (cool18 home crawl, cursor + empty filter + failed on error)"
```

---

## Task 7: jobs barrel + core 导出

**Files:**
- Create: `packages/core/src/jobs/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 4/5/6 产物。
- Produces: `@workspace/core` 导出 `JobRunner` / `ArchivePostsJob` / `JobHandler` / `JobContext` / `JobResult` / `JobStatus`（不导出测试用 FakeHandler）。

- [ ] **Step 1: 写 barrel**

新建 `packages/core/src/jobs/index.ts`：

```ts
export * from "./handler"
export * from "./runner"
export * from "./sleep"
export { ArchivePostsJob } from "./handlers/archive_posts"
```

- [ ] **Step 2: core 导出**

修改 `packages/core/src/index.ts`，追加一行：

```ts
export * from "./extractor"
export * from "./upstream"
export * from "./storage"
export * from "./jobs"
```

- [ ] **Step 3: typecheck 验证导出可用**

Run: `cd packages/core && bun run typecheck`（或 `bun run typecheck` 全仓）
Expected: PASS（无导出冲突；`JobLog` 与 storage 的 `JobLog` 同源不冲突）。

- [ ] **Step 4: 全量测试回归**

Run: `cd packages/core && bun test`
Expected: PASS（所有新测试 + 旧测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/jobs/index.ts packages/core/src/index.ts
git commit -m "feat(core): export jobs module (JobRunner, ArchivePostsJob, types)"
```

---

## Task 8: API `/api/me/jobs*` 端点

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `@workspace/core` 的 `JobRunner` / `ArchivePostsJob` / `Job` / `JobLog` / `JobStatus`；现有 `Store` / `ExtractorError` / `jsonOk` / `jsonError` / `NO_STORE_HEADERS`。
- Produces: `/api/me/jobs`（GET/POST/DELETE）、`/api/me/jobs/:id`（GET/DELETE）、`/api/me/jobs/:id/logs`（GET）、`/api/me/jobs/:id/stop`（POST）。

- [ ] **Step 1: 加 handler 函数**

在 `apps/api/src/index.ts` 的 handler 区（`handleGroupsList` 附近）追加。先在顶部 import 块从 `@workspace/core` 增加：

```ts
import {
  // ... 现有导入 ...
  JobRunner,
  ArchivePostsJob,
  type Job,
  type JobLog,
  type JobStatus,
} from "@workspace/core"
```

然后追加 handler 函数：

```ts
/** jobs 列表 query 解析（limit 默认 20 上限 100，offset 默认 0） */
function jobsListQuery(url: URL) {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20)
  )
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10) || 0
  )
  return {
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit,
    offset,
  }
}

/** Job 行 payload/result JSON → 对象（失败降级 null） */
function parseJob(job: Job) {
  let payload: Record<string, unknown> | null = null
  let result: Record<string, unknown> | null = null
  try {
    payload = job.payload ? JSON.parse(job.payload) : null
  } catch {
    payload = null
  }
  try {
    result = job.result ? JSON.parse(job.result) : null
  } catch {
    result = null
  }
  return { ...job, payload, result }
}

function handleJobsList(url: URL): Response {
  const items = store.listJobs(jobsListQuery(url))
  return jsonOk(
    { items: items.map(parseJob) },
    NO_STORE_HEADERS
  )
}

async function handleJobStart(req: Request): Promise<Response> {
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // 无 body 走默认
  }
  const type =
    body && typeof body === "object" && "type" in body
      ? String((body as { type: unknown }).type)
      : ""
  const payload =
    body && typeof body === "object" && "payload" in body
      ? ((body as { payload: Record<string, unknown> }).payload ?? {})
      : {}
  const job = await runner.start(type, payload)
  return jsonOk({ job: parseJob(job) }, NO_STORE_HEADERS)
}

function handleJobGet(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  return jsonOk({ job: parseJob(job) }, NO_STORE_HEADERS)
}

function handleJobDelete(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status === "running") {
    return jsonError("cannot delete running job; stop it first", 409)
  }
  store.deleteJob(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function handleJobsClear(): Response {
  const removed = store.clearFinishedJobs()
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}

function handleJobLogs(url: URL, id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200)
  )
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10) || 0
  )
  const level = url.searchParams.get("level") ?? undefined
  const order =
    url.searchParams.get("order") === "desc" ? "desc" : "asc"
  const items = store.listJobLogs(id, { limit, offset, level, order })
  return jsonOk({ items }, NO_STORE_HEADERS)
}

function handleJobStop(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status !== "running") {
    return jsonError(`cannot stop job in status: ${job.status}`, 409)
  }
  runner.stop(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}
```

说明：list / get / delete 这些纯查询与删除直接走 `store`（Task 2 已实现 `listJobs` / `getJob` / `deleteJob`）；`runner` 只暴露 `start` / `stop` / `recoverOnStartup`，不在 Runner 上重复包装查询方法。

- [ ] **Step 2: 加路由分支**

在 `route()` 函数里，`/api/me/groups` 前缀分支**之前**（jobs 与 groups 同级，顺序不敏感，放前面便于阅读）追加：

```ts
const jobsSub = pathname.match(
  /^\/api\/me\/jobs\/(\d+)(?:\/(logs|stop))?$/
)
if (jobsSub) {
  const id = Number(jobsSub[1])
  const sub = jobsSub[2]
  if (sub === undefined) {
    if (req.method === "GET") return handleJobGet(id)
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
```

- [ ] **Step 3: 启动 wiring（runner 单例 + recover）**

在 `apps/api/src/index.ts` 模块级（`const store = ...` 之后）追加：

```ts
const runner = new JobRunner(store)
runner.register(new ArchivePostsJob(store))
runner.recoverOnStartup()
```

`runner` 需在 handler 函数闭包可访问——它是模块级 `const`，与 `store` 同生命周期，自动可见。

- [ ] **Step 4: typecheck + 启动手动验证**

Run: `bun run typecheck`
Expected: PASS。

启动 dev（`bun run dev:api`），手动 curl 验证：

```bash
# 列空
curl -s 'http://127.0.0.1:3001/api/me/jobs' | head
# 启动一个会立即失败的 job（无上游也行，验证 wiring）
curl -s -X POST 'http://127.0.0.1:3001/api/me/jobs' -H 'content-type: application/json' -d '{"type":"unknown"}'
# 期望 400 unknown job type
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): /api/me/jobs endpoints + JobRunner wiring"
```

---

## Task 9: API `/api/me/archive` 端点

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `Store.listArchivePosts`（Task 3）；`DEFAULT_SITE` / `jsonOk` / `NO_STORE_HEADERS`。
- Produces: `GET /api/me/archive`。

- [ ] **Step 1: 加 handler**

在 `apps/api/src/index.ts` handler 区追加：

```ts
function handleMeArchive(url: URL): Response {
  const site = url.searchParams.get("site") ?? DEFAULT_SITE
  const q = url.searchParams.get("q") ?? undefined
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50)
  )
  const sortRaw = url.searchParams.get("sort") ?? "title"
  const sort =
    sortRaw === "title" || sortRaw === "tid" || sortRaw === "archived_at"
      ? sortRaw
      : "title"
  const orderRaw = url.searchParams.get("order")
  const order =
    orderRaw === "asc" || orderRaw === "desc" ? orderRaw : undefined
  const result = store.listArchivePosts(site, { q, page, limit, sort, order })
  return jsonOk(result, NO_STORE_HEADERS)
}
```

- [ ] **Step 2: 加路由**

在 `route()` 的 `switch` 内追加（与其它 `/api/me/*` 同级，放在 `/api/me/state` 附近）：

```ts
case "/api/me/archive":
  requireGet(req)
  return handleMeArchive(url)
```

- [ ] **Step 3: typecheck + 手动验证**

Run: `bun run typecheck`
Expected: PASS。

启动 dev，先跑一次归档（若上游可达）再查；或直接查空：

```bash
curl -s 'http://127.0.0.1:3001/api/me/archive?sort=title' | head
# 期望 {"items":[],"nextPage":...} 或带数据
```

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): GET /api/me/archive endpoint"
```

---

## Task 10: 前端 `lib/jobs.ts`

**Files:**
- Create: `apps/web/src/lib/jobs.ts`
- Modify: `apps/web/src/lib/routes.ts`

**Interfaces:**
- Consumes: `api` 常量（`routes.ts`）。
- Produces: `lib/jobs.ts` 的类型与 7 个 API 函数；`routes.ts` 的 `routes.jobs` / `routes.archive` / `api.meJobs` / `api.meArchive`。

- [ ] **Step 1: 加路由/API 常量**

修改 `apps/web/src/lib/routes.ts`，在 `routes` 对象加 `archive` / `jobs`，在 `api` 对象加 `meJobs` / `meArchive`：

```ts
export const routes = {
  home: "/",
  featured: "/featured",
  picks: "/picks",
  trending: "/trending",
  comments: "/comments",
  categories: "/categories",
  browse: "/browse",
  search: "/search",
  history: "/history",
  favorites: "/favorites",
  tags: "/tags",
  groups: "/groups",
  archive: "/archive",
  jobs: "/jobs",
} as const

export const api = {
  // ... 现有 ...
  meGroups: "/api/me/groups",
  meJobs: "/api/me/jobs",
  meArchive: "/api/me/archive",
  health: "/api/health",
} as const
```

- [ ] **Step 2: 写 `lib/jobs.ts`**

新建 `apps/web/src/lib/jobs.ts`：

```ts
import { api } from "@/lib/routes"

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

export interface JobLog {
  id: number
  job_id: number
  level: "info" | "warn" | "error"
  message: string
  created_at: number
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
}

export async function startJob(
  type: string,
  payload?: Record<string, unknown>
): Promise<Job> {
  const res = await fetch(api.meJobs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload: payload ?? {} }),
  })
  await throwIfNotOk(res)
  const json = (await res.json()) as { job: Job }
  return json.job
}

export async function listJobs(opts?: {
  type?: string
  status?: string
}): Promise<Job[]> {
  const params = new URLSearchParams()
  if (opts?.type) params.set("type", opts.type)
  if (opts?.status) params.set("status", opts.status)
  const qs = params.toString()
  const res = await fetch(`${api.meJobs}${qs ? `?${qs}` : ""}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { items: Job[] }
  return json.items
}

export async function getJob(id: number): Promise<Job> {
  const res = await fetch(`${api.meJobs}/${id}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { job: Job }
  return json.job
}

export async function getJobLogs(
  id: number,
  opts?: { level?: string; order?: "asc" | "desc"; limit?: number }
): Promise<JobLog[]> {
  const params = new URLSearchParams()
  if (opts?.level) params.set("level", opts.level)
  if (opts?.order) params.set("order", opts.order)
  if (opts?.limit) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const res = await fetch(`${api.meJobs}/${id}/logs${qs ? `?${qs}` : ""}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { items: JobLog[] }
  return json.items
}

export async function stopJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/stop`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function deleteJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}`, { method: "DELETE" })
  await throwIfNotOk(res)
}

export async function clearFinishedJobs(): Promise<number> {
  const res = await fetch(api.meJobs, { method: "DELETE" })
  await throwIfNotOk(res)
  const json = (await res.json()) as { removed: number }
  return json.removed
}

/** 轮询间隔持久化（localStorage） */
const POLL_MS_KEY = "purifier:jobs:pollMs"
const POLL_OPTIONS = [1000, 1500, 2000, 5000, 10000] as const

export function getPollMs(): number {
  const raw = Number(localStorage.getItem(POLL_MS_KEY))
  return POLL_OPTIONS.includes(raw as (typeof POLL_OPTIONS)[number])
    ? raw
    : 1500
}

export function setPollMs(ms: number): void {
  if (POLL_OPTIONS.includes(ms as (typeof POLL_OPTIONS)[number])) {
    localStorage.setItem(POLL_MS_KEY, String(ms))
  }
}

export { POLL_OPTIONS }
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/jobs.ts apps/web/src/lib/routes.ts
git commit -m "feat(web): job API client + routes constants"
```

---

## Task 11: JobsPage + 组件

**Files:**
- Create: `apps/web/src/components/job-row.tsx`
- Create: `apps/web/src/components/job-log-panel.tsx`
- Create: `apps/web/src/pages/JobsPage.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `lib/jobs.ts`（Task 10）；`PageShell` / `PageHeader`（现有组件）；lucide-react。
- Produces: `/jobs` 页面。

- [ ] **Step 1: 注册路由**

修改 `apps/web/src/App.tsx`：顶部 import 加 `JobsPage`，`<Routes>` 内（catch-all 之前）加：

```tsx
<Route path="/jobs" element={<JobsPage />} />
```

- [ ] **Step 2: 写 JobLogPanel**

新建 `apps/web/src/components/job-log-panel.tsx`：

```tsx
import { useEffect, useRef, useState } from "react"
import { getJobLogs, type JobLog } from "@/lib/jobs"

/** 日志面板：running 时按 pollMs 轮询 desc 拉尾，UI 反转为 ASC 显示 */
export function JobLogPanel({
  jobId,
  running,
  pollMs,
}: {
  jobId: number
  running: boolean
  pollMs: number
}) {
  const [logs, setLogs] = useState<JobLog[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const fresh = await getJobLogs(jobId, { order: "desc", limit: 200 })
        if (!cancelled) {
          // desc 拉回 → 反转成 ASC 显示
          setLogs(fresh.slice().reverse())
        }
      } catch {
        // 静默
      }
      if (!cancelled && running) {
        timerRef.current = setTimeout(poll, pollMs)
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [jobId, running, pollMs])

  if (logs.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">暂无日志</p>
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-foreground">
      {logs.map((l) => (
        <div
          key={l.id}
          className={
            l.level === "error"
              ? "text-destructive"
              : l.level === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
          }
        >
          [{l.level}] {l.message}
        </div>
      ))}
    </pre>
  )
}
```

- [ ] **Step 3: 写 JobRow**

新建 `apps/web/src/components/job-row.tsx`：

```tsx
import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { Job } from "@/lib/jobs"
import { JobLogPanel } from "./job-log-panel"

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
  aborted: "bg-muted text-muted-foreground",
}

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "等待",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  interrupted: "中断",
  aborted: "已停止",
}

export function JobRow({
  job,
  pollMs,
  onStop,
  onDelete,
}: {
  job: Job
  pollMs: number
  onStop: (id: number) => void
  onDelete: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const running = job.status === "running"
  const duration =
    job.started_at != null && job.finished_at != null
      ? `${Math.round((job.finished_at - job.started_at) / 1000)}s`
      : job.started_at != null
        ? "进行中"
        : "-"
  return (
    <li className="rounded-2xl border border-border/80 bg-card/80 shadow-sm">
      <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label={open ? "收起日志" : "展开日志"}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <span
          className={`rounded-lg px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[job.status]}`}
        >
          {STATUS_LABEL[job.status]}
        </span>
        <span className="text-sm font-medium text-foreground">{job.type}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          #{job.id}
        </span>
        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {duration}
        </span>
        {job.result && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {Object.entries(job.result)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {running && (
            <button
              type="button"
              onClick={() => onStop(job.id)}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              停止
            </button>
          )}
          {!running && (
            <button
              type="button"
              onClick={() => onDelete(job.id)}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              删除
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          {job.error && (
            <p className="mb-2 text-xs text-destructive">{job.error}</p>
          )}
          <JobLogPanel jobId={job.id} running={running} pollMs={pollMs} />
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 4: 写 JobsPage**

新建 `apps/web/src/pages/JobsPage.tsx`（参照 `GroupPage.tsx`：kebab-case 组件路径、`AsyncBody` 三态、design tokens）：

```tsx
import { useCallback, useEffect, useState } from "react"
import { Play, Trash2 } from "lucide-react"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { JobRow } from "@/components/job-row"
import { useSite } from "@/hooks/use-site"
import {
  clearFinishedJobs,
  deleteJob,
  getPollMs,
  listJobs,
  setPollMs,
  startJob,
  stopJob,
  POLL_OPTIONS,
  type Job,
} from "@/lib/jobs"

export default function JobsPage() {
  const site = useSite()
  const archiveSupported = site === "1"
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [pollMs, setPollMsState] = useState<number>(1500)

  useEffect(() => {
    setPollMsState(getPollMs())
  }, [])

  // silent：轮询/操作后局部刷新，不闪 loading；首屏 loading 由调用方控制
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError("")
    try {
      setJobs(await listJobs())
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 有 running job 时按 pollMs silent 刷新列表
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running")
    if (!hasRunning) return
    const t = setTimeout(() => void reload({ silent: true }), pollMs)
    return () => clearTimeout(t)
  }, [jobs, pollMs, reload])

  const onStart = async () => {
    setBusy(true)
    setError("")
    try {
      await startJob("archive_posts", { site: "1" })
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  const onStop = async (id: number) => {
    try {
      await stopJob(id)
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止失败")
    }
  }

  const onDelete = async (id: number) => {
    if (!confirm("删除该任务及其日志？")) return
    try {
      await deleteJob(id)
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    }
  }

  const onClear = async () => {
    if (!confirm("清空所有已结束的任务？")) return
    try {
      await clearFinishedJobs()
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "清空失败")
    }
  }

  const onChangePoll = (ms: number) => {
    setPollMs(ms)
    setPollMsState(ms)
  }

  const hasRunning = jobs.some((j) => j.status === "running")

  return (
    <PageShell>
      <PageHeader
        title="任务"
        description="后台长跑任务（全站主帖归档等）"
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={busy || hasRunning || !archiveSupported}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          title={!archiveSupported ? "当前站点不支持归档" : undefined}
        >
          <Play size={14} /> 开始归档
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 size={14} /> 清空已结束
        </button>
        <label className="ml-auto text-xs text-muted-foreground">
          刷新间隔
          <select
            value={pollMs}
            onChange={(e) => onChangePoll(Number(e.target.value))}
            className="ml-2 rounded-lg border border-border bg-background px-1.5 py-1"
          >
            {POLL_OPTIONS.map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000}s
              </option>
            ))}
          </select>
        </label>
      </div>
      {!archiveSupported && (
        <p className="mb-4 text-sm text-muted-foreground">
          当前站点不支持归档（仅论坛站可归档主帖）。
        </p>
      )}
      <AsyncBody
        loading={loading}
        error={error}
        empty={jobs.length === 0}
        onRetry={() => void reload()}
        emptyText="暂无任务"
      >
        <ul className="space-y-2.5">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              pollMs={pollMs}
              onStop={onStop}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </AsyncBody>
    </PageShell>
  )
}
```

- [ ] **Step 5: typecheck + 构建验证**

Run: `bun run typecheck && bun run build:web`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/JobsPage.tsx apps/web/src/components/job-row.tsx apps/web/src/components/job-log-panel.tsx apps/web/src/App.tsx
git commit -m "feat(web): /jobs page with polling log panel and poll interval control"
```

---

## Task 12: ArchivePage + 导航项

**Files:**
- Create: `apps/web/src/pages/ArchivePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/lib/routes.ts`

**Interfaces:**
- Consumes: `api.meArchive` / `readPath`（`routes.ts`）；`PageShell` / `PageHeader`。
- Produces: `/archive` 页面；`NAV_ITEMS` 两项。

- [ ] **Step 1: 注册路由**

修改 `apps/web/src/App.tsx`：import `ArchivePage`，加路由（catch-all 之前）：

```tsx
<Route path="/archive" element={<ArchivePage />} />
```

- [ ] **Step 2: 加导航项**

修改 `apps/web/src/lib/routes.ts` 的 `NAV_ITEMS`，在「分组」与「历史」之间插入两项：

```ts
{
  href: routes.archive,
  label: "归档",
  sites: ["1"],
  match: (p: string) => p === routes.archive,
},
{
  href: routes.jobs,
  label: "任务",
  sites: ["1", "2"],
  match: (p: string) => p === routes.jobs,
},
```

- [ ] **Step 3: 写 ArchivePage**

新建 `apps/web/src/pages/ArchivePage.tsx`（参照现网风格：kebab-case 组件路径、`AsyncBody`、design tokens）：

```tsx
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { api, readPath, routes } from "@/lib/routes"

interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
}

type SortKey = "title" | "tid" | "archived_at"

const SORT_LABEL: Record<SortKey, string> = {
  title: "标题",
  tid: "最新",
  archived_at: "最近更新",
}

export default function ArchivePage() {
  const [items, setItems] = useState<ArchivePost[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("title")
  const [page, setPage] = useState(1)

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("sort", sort)
      params.set("page", String(page))
      if (q) params.set("q", q)
      const res = await fetch(`${api.meArchive}?${params.toString()}`)
      const json = (await res.json()) as {
        items: ArchivePost[]
        nextPage?: number
        error?: string
      }
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setItems(json.items ?? [])
      setNextPage(json.nextPage)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [sort, page, q])

  useEffect(() => {
    const t = setTimeout(() => void reload(), 300) // debounce q
    return () => clearTimeout(t)
  }, [reload])

  return (
    <PageShell>
      <PageHeader title="归档" description="全站主帖目录（tid + 标题）" />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="搜索标题"
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        />
        <div className="ml-auto flex gap-1">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSort(key)
                setPage(1)
              }}
              className={`rounded-lg px-2.5 py-1 text-sm transition-colors ${
                sort === key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {SORT_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={
          <>
            还没有归档，去
            <Link
              to={routes.jobs}
              className="text-foreground underline underline-offset-2"
            >
              任务
            </Link>
            开始一次归档
          </>
        }
      >
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={`${it.site}:${it.tid}`}
              className="flex items-baseline gap-2"
            >
              <a
                href={readPath(it.tid, it.site)}
                className="text-sm text-foreground hover:underline"
              >
                {it.title}
              </a>
              <span className="text-xs text-muted-foreground/70 tabular-nums">
                #{it.tid}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            上一页
          </button>
          <span className="px-2 py-1 text-sm text-muted-foreground tabular-nums">
            第 {page} 页
          </span>
          <button
            type="button"
            disabled={!nextPage}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </AsyncBody>
    </PageShell>
  )
}
```

- [ ] **Step 4: typecheck + 构建**

Run: `bun run typecheck && bun run build`
Expected: PASS。

- [ ] **Step 5: 端到端手动验证**

```bash
bun run dev
# 浏览器打开 http://localhost:3000/jobs，点「开始归档」
# 看日志增长、status 变化
# 打开 /archive 看目录、试搜索与排序切换
```

- [ ] **Step 6: 全量回归 + 提交**

```bash
bun run test
bun run typecheck
bun run build
```

```bash
git add apps/web/src/pages/ArchivePage.tsx apps/web/src/App.tsx apps/web/src/lib/routes.ts
git commit -m "feat(web): /archive page with search/sort/pagination + nav items"
```

---

## 完成后

- 跑 `bun run test && bun run typecheck && bun run build` 全绿。
- 手动跑一次真实归档（需上游可达或配 `HTTPS_PROXY`），验证 `/jobs` 进度与 `/archive` 数据。
