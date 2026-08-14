# 任务页改版（jobs redesign）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按规格 `docs/superpowers/specs/2026-08-14-jobs-page-redesign-design.md` 重做任务页：后端任务暂停/继续（runner checkpoint）、列表排序/批量删除、前端统计卡 + 进行中条 + 两步创建 modal + 响应式表格。

**Architecture:** 暂停走 Runner 内存句柄 + `JobContext.checkpoint()`（resolve-not-throw，与 `sleep` 协作取消一致）；存储层新增 `paused` 状态与 `markResumed`，`listJobs`/`countJobs` 共用 status 聚合（`active`/`finished`）与排序条件；API 扩 pause/resume/stop/批量删除/排序参数；前端拆成统计卡、进行中条、创建 modal、表格四个组件，`JobsPage` 只做编排与轮询。

**Tech Stack:** Bun + `Bun.serve`（无框架）、React 19 + Tailwind CSS 4、`bun:test`（测试只在 `packages/core`）。

## Global Constraints

- TypeScript `strict`；Prettier：无分号、双引号、printWidth 80、trailingComma "es5"。
- API 只用 Bun 内置 `Bun.serve`，不引入 HTTP 框架；不新起 `apps/api` 测试脚手架。
- 错误体统一 `{ "error": "..." }`；`/api/me/*` 响应用 `NO_STORE_HEADERS`。
- 前端导入 `@/` 别名、跨包 `@workspace/...`、图标 lucide-react、样式 Tailwind 4 工具类。
- 单删/批量删除终态白名单：`succeeded | failed | interrupted | aborted`；`running | paused | pending` 一律 409。
- UI 不展示游标值（`next_mtid`）、tid、`#id`；`formatJobProgress` 不再拼「游标 …」。
- 轮询固定 1500ms，仅当实例内存在 active（running|paused|pending）任务。
- 每个任务完成即 `bun run test`（或对应文件 `bun test`）+ 提交。

---

### Task 1: Store 暂停状态基座

**Files:**
- Modify: `packages/core/src/storage/types.ts:95`（`JobStatus`）
- Modify: `packages/core/src/storage/store.ts`（jobs 区：`markPaused`/`markResumed`/`hasRunningOfType`/`markStaleJobsInterrupted`）
- Test: `packages/core/src/storage/jobs.test.ts`

**Interfaces:**
- Produces: `JobStatus` 新增 `"paused"`；`store.markPaused(id): boolean`（running→paused，不动 `started_at`）；`store.markResumed(id): boolean`（paused→running，不动 `started_at`）。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/storage/jobs.test.ts` 追加（沿用文件顶部已有 `makeStore`）：

```ts
test("markPaused/markResumed 往返，不改 started_at", () => {
  const { store, dir } = makeStore()
  const job = store.createJob("archive_posts", null)
  store.markRunning(job.id)
  const startedAt = store.getJob(job.id)!.started_at
  expect(store.markPaused(job.id)).toBe(true)
  expect(store.getJob(job.id)!.status).toBe("paused")
  expect(store.getJob(job.id)!.started_at).toBe(startedAt)
  expect(store.markPaused(job.id)).toBe(false) // 已 paused
  expect(store.markResumed(job.id)).toBe(true)
  expect(store.getJob(job.id)!.status).toBe("running")
  expect(store.getJob(job.id)!.started_at).toBe(startedAt)
  expect(store.markResumed(job.id)).toBe(false) // 已 running
  rmSync(dir, { recursive: true, force: true })
})

test("hasRunningOfType 把 paused 算占用", () => {
  const { store, dir } = makeStore()
  const job = store.createJob("archive_posts", null)
  store.markRunning(job.id)
  store.markPaused(job.id)
  expect(store.hasRunningOfType("archive_posts")).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})

test("markStaleJobsInterrupted 覆盖 paused", () => {
  const { store, dir } = makeStore()
  const job = store.createJob("archive_posts", null)
  store.markRunning(job.id)
  store.markPaused(job.id)
  expect(store.markStaleJobsInterrupted()).toBe(1)
  expect(store.getJob(job.id)!.status).toBe("interrupted")
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/jobs.test.ts`
Expected: FAIL（`markPaused is not a function` 等）。

- [ ] **Step 3: 实现**

`packages/core/src/storage/types.ts` — `JobStatus` 加 `"paused"`（放 `"running"` 之后）：

```ts
export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"
```

`packages/core/src/storage/store.ts` jobs 区，紧跟 `markRunning` 后加：

```ts
/** running → paused（暂停；不动 started_at，暂停时长计入总耗时） */
markPaused(id: number): boolean {
  const res = this.db
    .query("UPDATE jobs SET status='paused' WHERE id=?1 AND status='running'")
    .run(id)
  return Number(res.changes ?? 0) > 0
}

/** paused → running（恢复；不改 started_at。不能复用 markRunning：那是 pending→running 且重写 started_at） */
markResumed(id: number): boolean {
  const res = this.db
    .query("UPDATE jobs SET status='running' WHERE id=?1 AND status='paused'")
    .run(id)
  return Number(res.changes ?? 0) > 0
}
```

`hasRunningOfType` 的 SQL 改为：

```ts
"SELECT 1 FROM jobs WHERE type=?1 AND status IN ('running','paused') LIMIT 1"
```

`markStaleJobsInterrupted` 里 jobs 的 UPDATE 条件改为 `IN ('running','pending','paused')`（archive_cursors 那条不动）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/storage/jobs.test.ts`
Expected: PASS 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/store.ts packages/core/src/storage/jobs.test.ts
git commit -m "feat(core): jobs paused status with markPaused/markResumed"
```

---

### Task 2: Store 列表聚合/排序 + 批量删除

**Files:**
- Modify: `packages/core/src/storage/types.ts`（新增 `JobSortKey`）
- Modify: `packages/core/src/storage/store.ts`（`listJobs`/`countJobs`/`deleteJobsMany`，删 `clearFinishedJobs`）
- Test: `packages/core/src/storage/jobs.test.ts`

**Interfaces:**
- Produces: `type JobSortKey = "created_at" | "type" | "status" | "duration"`；`listJobs(opts: { type?; status?; limit; offset; sort?: JobSortKey; order?: "asc" | "desc" })`；status 聚合值 `"active"`（running|paused|pending）与 `"finished"`（终态四种）；`deleteJobsMany(ids: number[]): number`（只删终态，返回实际删除数）。
- Removes: `clearFinishedJobs()`（Task 5 起无调用方）。

- [ ] **Step 1: 写失败测试**

追加到 `packages/core/src/storage/jobs.test.ts`：

```ts
/** 造三个任务：a 论坛成功、b 书库失败、c 论坛暂停中（makeStore 的 now 每次 +1） */
function seedThree(store: Store) {
  const a = store.createJob("archive_posts", null)
  store.markRunning(a.id)
  store.markFinished(a.id, "succeeded", { pages: 1 }, null)
  const b = store.createJob("archive_books", null)
  store.markRunning(b.id)
  store.markFinished(b.id, "failed", null, "boom")
  const c = store.createJob("archive_posts", null)
  store.markRunning(c.id)
  store.markPaused(c.id)
  return { a, b, c }
}

test("listJobs 默认 created_at desc；order=asc 反转", () => {
  const { store, dir } = makeStore()
  const { a, b, c } = seedThree(store)
  const desc = store.listJobs({ limit: 10, offset: 0 })
  expect(desc.map((j) => j.id)).toEqual([c.id, b.id, a.id])
  const asc = store.listJobs({ limit: 10, offset: 0, order: "asc" })
  expect(asc.map((j) => j.id)).toEqual([a.id, b.id, c.id])
  rmSync(dir, { recursive: true, force: true })
})

test("status 聚合 active/finished：list 与 count 一致", () => {
  const { store, dir } = makeStore()
  const { a, b, c } = seedThree(store)
  const active = store.listJobs({ status: "active", limit: 10, offset: 0 })
  expect(active.map((j) => j.id)).toEqual([c.id])
  expect(store.countJobs({ status: "active" })).toBe(1)
  const finished = store.listJobs({ status: "finished", limit: 10, offset: 0 })
  expect(finished.map((j) => j.id)).toEqual([b.id, a.id])
  expect(store.countJobs({ status: "finished" })).toBe(2)
  expect(store.countJobs({ type: "archive_posts", status: "finished" })).toBe(1)
  rmSync(dir, { recursive: true, force: true })
})

test("sort=duration：进行中按 now 计，同耗时 tie-break created_at desc，NULL 排最后", () => {
  const { store, dir } = makeStore()
  const { a, b, c } = seedThree(store)
  const d = store.createJob("archive_posts", null) // pending：started_at NULL
  const rows = store.listJobs({ limit: 10, offset: 0, sort: "duration" })
  // c 进行中（now - started_at 最大）；a/b 终态同为 1ms → created_at desc（b 后建）在前；d NULL 末尾
  expect(rows.map((j) => j.id)).toEqual([c.id, b.id, a.id, d.id])
  rmSync(dir, { recursive: true, force: true })
})

test("sort=type（asc）与 sort=status 生效", () => {
  const { store, dir } = makeStore()
  const { a, b, c } = seedThree(store)
  const byType = store.listJobs({
    limit: 10,
    offset: 0,
    sort: "type",
    order: "asc",
  })
  expect(byType.map((j) => j.type)).toEqual([
    "archive_books",
    "archive_posts",
    "archive_posts",
  ])
  // status 序：running(0) > paused(1) > pending(2) > interrupted(3) > failed(4) > aborted(5) > succeeded(6)
  const byStatus = store.listJobs({ limit: 10, offset: 0, sort: "status" })
  expect(byStatus.map((j) => j.id)).toEqual([c.id, b.id, a.id])
  expect(byStatus.map((j) => j.status)).toEqual([
    "paused",
    "failed",
    "succeeded",
  ])
  rmSync(dir, { recursive: true, force: true })
})

test("deleteJobsMany 只删终态，removed 不计 CASCADE 日志", () => {
  const { store, dir } = makeStore()
  const { a, b, c } = seedThree(store)
  store.appendJobLog(a.id, "info", "log line") // FK CASCADE 行不计入 removed
  expect(store.deleteJobsMany([])).toBe(0)
  expect(store.deleteJobsMany([a.id, b.id])).toBe(2)
  expect(store.getJob(a.id)).toBeNull()
  expect(store.listJobLogs(a.id, { limit: 10, offset: 0 })).toEqual([])
  expect(store.deleteJobsMany([c.id])).toBe(0) // paused 不删
  expect(store.getJob(c.id)!.status).toBe("paused")
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/storage/jobs.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`packages/core/src/storage/types.ts` 加：

```ts
/** jobs 列表排序键（API 层白名单校验，store 对未知值回退 created_at） */
export type JobSortKey = "created_at" | "type" | "status" | "duration"
```

`packages/core/src/storage/store.ts` — jobs 区顶部加模块级常量与 helper（放 class 外）：

```ts
/** status 聚合值 → 展开集合；单值仍占位符绑定（不拼值进 SQL） */
const JOB_STATUS_AGGREGATES: Record<string, string[]> = {
  active: ["running", "paused", "pending"],
  finished: ["succeeded", "failed", "interrupted", "aborted"],
}

/** 终态白名单（批量删除；固定字面量，安全拼接） */
const JOB_TERMINAL_SQL = "('succeeded','failed','interrupted','aborted')"

/** type/status → WHERE 片段与绑定参数（listJobs/countJobs 共用） */
function jobFilterSql(opts: { type?: string; status?: string }): {
  where: string
  binds: string[]
} {
  const conds: string[] = []
  const binds: string[] = []
  if (opts.type) {
    conds.push("type = ?")
    binds.push(opts.type)
  }
  if (opts.status) {
    const agg = JOB_STATUS_AGGREGATES[opts.status]
    if (agg) {
      conds.push(`status IN (${agg.map(() => "?").join(",")})`)
      binds.push(...agg)
    } else {
      conds.push("status = ?")
      binds.push(opts.status)
    }
  }
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", binds }
}
```

`listJobs` 整体替换为：

```ts
listJobs(opts: {
  type?: string
  status?: string
  limit: number
  offset: number
  sort?: JobSortKey
  order?: "asc" | "desc"
}): Job[] {
  const dir = opts.order === "asc" ? "ASC" : "DESC"
  const nowMs = this.now()
  const statusRank =
    "CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'pending' THEN 2 WHEN 'interrupted' THEN 3 WHEN 'failed' THEN 4 WHEN 'aborted' THEN 5 ELSE 6 END"
  // duration：进行中按当前时间计；started_at 为 NULL 排最后（两段排序）
  const orderSql =
    opts.sort === "type"
      ? `ORDER BY type ${dir}, created_at DESC, id DESC`
      : opts.sort === "status"
        ? `ORDER BY ${statusRank} ${dir}, created_at DESC, id DESC`
        : opts.sort === "duration"
          ? `ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END ASC, (COALESCE(finished_at, ${nowMs}) - started_at) ${dir}, created_at DESC, id DESC`
          : `ORDER BY created_at ${dir}, id ${dir}`
  const { where, binds } = jobFilterSql(opts)
  const rows = this.db
    .query(`SELECT * FROM jobs ${where} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...binds, opts.limit, opts.offset) as (Omit<Job, "status"> & {
    status: string
  })[]
  return rows.map((r) => ({ ...r, status: r.status as JobStatus }))
}
```

`countJobs` 替换（与 list 同一过滤构造）：

```ts
countJobs(opts: { type?: string; status?: string }): number {
  const { where, binds } = jobFilterSql(opts)
  const row = this.db
    .query(`SELECT COUNT(*) AS n FROM jobs ${where}`)
    .get(...binds) as { n: number }
  return Number(row.n ?? 0)
}
```

`clearFinishedJobs` 整个删除，原位置换成（`changes()` 会把 FK CASCADE 的 `job_logs` 计入——沿用 clearFinishedJobs 的「先 COUNT 再删」）：

```ts
/** 批量删除（只删终态；活动行由 API 层先检查 409） */
deleteJobsMany(ids: number[]): number {
  if (ids.length === 0) return 0
  const ph = ids.map(() => "?").join(",")
  const row = this.db
    .query(
      `SELECT COUNT(*) AS n FROM jobs WHERE id IN (${ph}) AND status IN ${JOB_TERMINAL_SQL}`
    )
    .get(...ids) as { n: number }
  this.db
    .query(
      `DELETE FROM jobs WHERE id IN (${ph}) AND status IN ${JOB_TERMINAL_SQL}`
    )
    .run(...ids)
  return Number(row.n ?? 0)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/storage`
Expected: PASS（archive.test.ts 等若引用 clearFinishedJobs 需一并修正——先 `grep -rn "clearFinishedJobs" packages apps`，测试里对应用例改为 `deleteJobsMany` 或删除）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/store.ts packages/core/src/storage/jobs.test.ts
git commit -m "feat(core): job list status aggregates, sort/order, batch delete"
```

---

### Task 3: Runner checkpoint + pause/resume

**Files:**
- Modify: `packages/core/src/jobs/handler.ts`（`JobContext.checkpoint`）
- Modify: `packages/core/src/jobs/runner.ts`
- Test: `packages/core/src/jobs/runner.test.ts`

**Interfaces:**
- Produces: `JobContext.checkpoint(): Promise<void>`；`runner.pause(jobId): boolean`；`runner.resume(jobId): boolean`。
- 语义：checkpoint 在 abort 时 **resolve 不抛**（与 `sleep` 一致），handler 循环随后看 `signal.aborted` 自行退出。

- [ ] **Step 1: 写失败测试**

追加到 `packages/core/src/jobs/runner.test.ts`（沿用 `makeRunner`）：

```ts
class PausableHandler implements JobHandler {
  type = "pausable"
  ticks = 0
  async run(ctx: JobContext): Promise<JobResult> {
    for (let i = 0; i < 4; i++) {
      await ctx.checkpoint()
      if (ctx.signal.aborted) break
      await sleep(5)
      this.ticks++
      ctx.reportProgress({ ticks: this.ticks })
    }
    return { ticks: this.ticks }
  }
}

test("pause → resume → succeeded；暂停期间进度不动", async () => {
  const { runner, store, dir } = makeRunner()
  runner.register(new PausableHandler())
  const job = await runner.start("pausable")
  await sleep(12)
  expect(runner.pause(job.id)).toBe(true)
  expect(store.getJob(job.id)!.status).toBe("paused")
  expect(runner.pause(job.id)).toBe(false)
  const ticksAtPause = (
    JSON.parse(store.getJob(job.id)!.result ?? "{}") as { ticks?: number }
  ).ticks
  await sleep(40)
  const ticksLater = (
    JSON.parse(store.getJob(job.id)!.result ?? "{}") as { ticks?: number }
  ).ticks
  expect(ticksLater).toBe(ticksAtPause)
  expect(runner.resume(job.id)).toBe(true)
  expect(store.getJob(job.id)!.status).toBe("running")
  await sleep(80)
  expect(store.getJob(job.id)!.status).toBe("succeeded")
  rmSync(dir, { recursive: true, force: true })
})

test("pause → stop → aborted（checkpoint 被 abort 唤醒且不抛）", async () => {
  const { runner, store, dir } = makeRunner()
  runner.register(new PausableHandler())
  const job = await runner.start("pausable")
  await sleep(12)
  expect(runner.pause(job.id)).toBe(true)
  expect(runner.stop(job.id)).toBe(true)
  await sleep(50)
  const done = store.getJob(job.id)!
  expect(done.status).toBe("aborted")
  rmSync(dir, { recursive: true, force: true })
})

test("pause → resume → 再 pause → stop → aborted（二次挂起仍可被唤醒）", async () => {
  const { runner, store, dir } = makeRunner()
  runner.register(new PausableHandler())
  const job = await runner.start("pausable")
  await sleep(12)
  expect(runner.pause(job.id)).toBe(true)
  expect(runner.resume(job.id)).toBe(true)
  await sleep(10)
  expect(runner.pause(job.id)).toBe(true)
  await sleep(20) // 已挂起在第二个 checkpoint
  expect(runner.stop(job.id)).toBe(true)
  await sleep(50)
  expect(store.getJob(job.id)!.status).toBe("aborted")
  rmSync(dir, { recursive: true, force: true })
})

test("暂停中同类型 start → 409", async () => {
  const { runner, store, dir } = makeRunner()
  runner.register(new PausableHandler())
  const job = await runner.start("pausable")
  await sleep(12)
  expect(runner.pause(job.id)).toBe(true)
  try {
    await runner.start("pausable")
    expect.unreachable()
  } catch (e) {
    expect((e as ExtractorError).statusCode).toBe(409)
  }
  rmSync(dir, { recursive: true, force: true })
})

test("暂停中 abortAll → aborted，waitForIdle 不超时", async () => {
  const { runner, store, dir } = makeRunner()
  runner.register(new PausableHandler())
  const job = await runner.start("pausable")
  await sleep(12)
  runner.pause(job.id)
  runner.abortAll()
  expect(await runner.waitForIdle(5000)).toBe(true)
  expect(store.getJob(job.id)!.status).toBe("aborted")
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/core/src/jobs/runner.test.ts`
Expected: FAIL（`ctx.checkpoint is not a function` / `runner.pause is not a function`）。

- [ ] **Step 3: 实现**

`packages/core/src/jobs/handler.ts` — `JobContext` 加：

```ts
export interface JobContext {
  jobId: number
  log(level: "info" | "warn" | "error", message: string): void
  /** 运行中写入中间进度到 jobs.result，供列表轮询展示 */
  reportProgress(progress: JobResult): void
  signal: AbortSignal
  payload: Record<string, unknown>
  /**
   * 暂停检查点：未暂停直通；暂停则挂起直到 resume 或 abort。
   * abort 时 resolve 不抛（与 sleep 协作取消一致），循环随后看 signal.aborted 退出。
   */
  checkpoint(): Promise<void>
}
```

`packages/core/src/jobs/runner.ts`：

1. `running` Map 的值类型改为句柄对象：

```ts
interface RunningHandle {
  controller: AbortController
  paused: boolean
  wake: (() => void) | null
}

private running = new Map<number, RunningHandle>()
```

`start` 里 `const controller = new AbortController()` 改为创建句柄并 `this.running.set(job.id, { controller, paused: false, wake: null })`。

2. `stop`/`abortAll`/`waitForIdle` 里的取值同步改（`h.controller.abort()`）；`runJob` finally 的 `this.running.delete(jobId)` 不变。

3. 新增公开方法（放 `stop` 之后）：

```ts
/** running → 挂起：写 DB 状态，handler 在下一个 checkpoint 处挂起 */
pause(jobId: number): boolean {
  const h = this.running.get(jobId)
  if (!h || h.paused) return false
  if (!this.store.markPaused(jobId)) return false
  h.paused = true
  return true
}

/** 恢复挂起任务：写回 running 并唤醒 checkpoint */
resume(jobId: number): boolean {
  const h = this.running.get(jobId)
  if (!h || !h.paused) return false
  if (!this.store.markResumed(jobId)) return false
  h.paused = false
  const wake = h.wake
  h.wake = null
  wake?.()
  return true
}
```

4. `runJob` 的 ctx 构造加 `checkpoint`。**不在 checkpoint 里注册 abort listener**——每次挂起注册的 listener 闭包持有各自的 resolve，二次暂停后旧 listener 会把新 `h.wake` 置空、调用已 resolve 过的旧 resolve，新挂起永远无人唤醒（handler 卡死、`waitForIdle` 超时）。改为：唤醒只来自 `resume()` / `stop()` / `abortAll()` 显式调用当前 `h.wake`：

```ts
const ctx: JobContext = {
  jobId,
  payload,
  signal,
  log: (level, message) => this.store.appendJobLog(jobId, level, message),
  reportProgress: (progress) => this.store.setJobResult(jobId, progress),
  checkpoint: () =>
    new Promise<void>((resolve) => {
      const h = this.running.get(jobId)
      // 未暂停直通；signal 已 aborted（stop 落在挂起之前，如 handler 还在当前页里）也直通，
      // 循环随后的 signal.aborted 检查会退出
      if (!h || !h.paused || signal.aborted) return resolve()
      h.wake = () => {
        h.wake = null
        resolve()
      }
    }),
}
```

5. `stop` / `abortAll` 在 abort 之后显式唤醒挂起的 checkpoint：

```ts
stop(jobId: number): boolean {
  const h = this.running.get(jobId)
  if (!h) return false
  h.controller.abort()
  h.wake?.() // 唤醒可能挂起的 checkpoint（resolve 不抛）
  return true
}

abortAll(): void {
  for (const h of this.running.values()) {
    h.controller.abort()
    h.wake?.()
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/core/src/jobs/runner.test.ts`
Expected: PASS 全绿（含原有用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/jobs/handler.ts packages/core/src/jobs/runner.ts packages/core/src/jobs/runner.test.ts
git commit -m "feat(core): job runner pause/resume via cooperative checkpoint"
```

---

### Task 4: 三个 handler 接入 checkpoint

**Files:**
- Modify: `packages/core/src/jobs/handlers/archive_posts.ts:105`
- Modify: `packages/core/src/jobs/handlers/archive_books.ts:98`
- Modify: `packages/core/src/jobs/handlers/archive_auto_group.ts:52,130`
- Test: 修改三个 `*.test.ts` 的 ctx 假体

**Interfaces:**
- Consumes: `JobContext.checkpoint()`（Task 3）。
- 测试假体 ctx 需补 `checkpoint: () => Promise.resolve()`。

- [ ] **Step 1: 给测试假体补 checkpoint**

`grep -n "signal: controller.signal" packages/core/src/jobs/handlers/*.test.ts` 找到三处 `makeCtx` 类工厂，在 ctx 对象里各加一行：

```ts
checkpoint: () => Promise.resolve(),
```

- [ ] **Step 2: 插入 checkpoint（跟随现有让出点）**

`archive_posts.ts` 第 105 行页循环开头：

```ts
while (!ctx.signal.aborted) {
  await ctx.checkpoint()
  if (ctx.signal.aborted) break
  // ...原有 fetchPage...
```

`archive_books.ts` 第 98 行 `while (!ctx.signal.aborted) {` 同样在循环开头加同样的两行。

`archive_auto_group.ts` 两处现有让出点，`await ctx.checkpoint()` 放在 `sleep` 之前：

```ts
// 扫库段（原 scanned % 100 === 0 分支）
if (scanned % 100 === 0) {
  await ctx.checkpoint()
  if (ctx.signal.aborted) {
    ctx.log("warn", "aborted during bucket scan")
    break
  }
  await sleep(0, ctx.signal)
}
```

注意：原分支是 `sleep(0, signal)` 后查 aborted；改为 checkpoint + 查 aborted + sleep（sleep 保留让出语义）。upsert 段同理：

```ts
if (i % 3 === 0) {
  await ctx.checkpoint()
  if (ctx.signal.aborted) break
  await sleep(0, ctx.signal)
}
```

- [ ] **Step 3: 跑 handler 测试**

Run: `bun test packages/core/src/jobs`
Expected: PASS（现有用例全部通过；若 auto_group 测试断言日志顺序，按新日志/顺序微调断言——不改行为语义，只对齐让出点顺序）。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/jobs/handlers
git commit -m "feat(core): archive handlers honor pause checkpoints at yield points"
```

---

### Task 5: API 路由（pause/resume/stop/删除/排序）

**Files:**
- Modify: `apps/api/src/index.ts`（`jobsListQuery`、`handleJobStop`、`handleJobDelete`、新增 pause/resume/batchDelete、路由正则与分发，删 `handleJobsClear`）

**Interfaces:**
- Consumes: `store.markPaused/markResumed/deleteJobsMany/listJobs(sort/order)`、`runner.pause/resume`。
- Produces（API 面向 Task 6 前端）:
  - `POST /api/me/jobs/:id/pause`（非 running 409 `cannot pause job in status: …`）
  - `POST /api/me/jobs/:id/resume`（非 paused 409）
  - `POST /api/me/jobs/:id/stop`（running|paused 可停，其余 409）
  - `DELETE /api/me/jobs/:id`（仅终态可删，否则 409 `cannot delete job in status: …; stop it first`）
  - `DELETE /api/me/jobs` body `{ ids: number[] }`（含活动任务整批 409；`{ ok, removed }`）
  - `GET /api/me/jobs?sort=&order=&status=active|finished|…`

- [ ] **Step 1: 扩路由正则与子资源分发**

`apps/api/src/index.ts:1554` 正则改为：

```ts
const jobsSub = pathname.match(
  /^\/api\/me\/jobs\/(\d+)(?:\/(logs|stop|pause|resume))?$/
)
```

分发分支里（`sub === "stop"` 之后）加：

```ts
if (sub === "pause") {
  if (req.method !== "POST") {
    throw new ExtractorError("method not allowed", 405)
  }
  return handleJobPause(id)
}
if (sub === "resume") {
  if (req.method !== "POST") {
    throw new ExtractorError("method not allowed", 405)
  }
  return handleJobResume(id)
}
```

- [ ] **Step 2: 新增/修改 handlers**

`handleJobStop`（替换 `index.ts:1352` 附近）：

```ts
function handleJobStop(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status !== "running" && job.status !== "paused") {
    return jsonError(`cannot stop job in status: ${job.status}`, 409)
  }
  runner.stop(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function handleJobPause(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status !== "running") {
    return jsonError(`cannot pause job in status: ${job.status}`, 409)
  }
  if (!runner.pause(id)) {
    return jsonError(
      `cannot pause job in status: ${store.getJob(id)?.status ?? "unknown"}`,
      409
    )
  }
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function handleJobResume(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status !== "paused") {
    return jsonError(`cannot resume job in status: ${job.status}`, 409)
  }
  if (!runner.resume(id)) {
    return jsonError(
      `cannot resume job in status: ${store.getJob(id)?.status ?? "unknown"}`,
      409
    )
  }
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}
```

`handleJobDelete` 改终态白名单：

```ts
function handleJobDelete(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (
    job.status !== "succeeded" &&
    job.status !== "failed" &&
    job.status !== "interrupted" &&
    job.status !== "aborted"
  ) {
    return jsonError(
      `cannot delete job in status: ${job.status}; stop it first`,
      409
    )
  }
  store.deleteJob(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}
```

`handleJobsClear` 整个删除，替换为：

```ts
async function handleJobsBatchDelete(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  const ids =
    body && typeof body === "object" && "ids" in body ? body.ids : null
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0)
  ) {
    throw new ExtractorError("ids must be a non-empty number[]", 400)
  }
  const active = ids
    .map((id) => store.getJob(id))
    .filter((j): j is Job => j !== null)
    .find(
      (j) =>
        j.status === "running" || j.status === "paused" || j.status === "pending"
    )
  if (active) {
    return jsonError(
      `cannot delete job ${active.id} in status: ${active.status}; stop it first`,
      409
    )
  }
  const removed = store.deleteJobsMany(ids)
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}
```

`/api/me/jobs` 分发行 `if (req.method === "DELETE") return handleJobsClear()` 改为 `return await handleJobsBatchDelete(req)`。

`jobsListQuery` 加排序与 status 白名单解析（放 limit/offset 之后；status 走白名单，store 侧单值保持占位符绑定，不拼值进 SQL）：

```ts
const sortRaw = url.searchParams.get("sort") ?? "created_at"
const orderRaw = url.searchParams.get("order") ?? "desc"
const SORT_KEYS = new Set(["created_at", "type", "status", "duration"])
if (!SORT_KEYS.has(sortRaw)) throw new ExtractorError("invalid sort", 400)
if (orderRaw !== "asc" && orderRaw !== "desc") {
  throw new ExtractorError("invalid order", 400)
}
const statusRaw = url.searchParams.get("status")
const STATUS_VALUES = new Set([
  "pending",
  "running",
  "paused",
  "succeeded",
  "failed",
  "interrupted",
  "aborted",
  "active",
  "finished",
])
if (statusRaw && !STATUS_VALUES.has(statusRaw)) {
  throw new ExtractorError("invalid status", 400)
}
```

返回对象改为 `{ type, status: statusRaw ?? undefined, limit, offset, sort: sortRaw as JobSortKey, order: orderRaw }`（顶部从 `@workspace/core` 导入 `JobSortKey`，若 core 未导出则在 core `index.ts` 补导出）。`handleJobsList` 的 `store.listJobs(q)` 已带新参数，无需改。

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `bun run typecheck && bun run test`
Expected: 通过（`clearFinishedJobs` 残余引用清零：`grep -rn "clearFinishedJobs\|handleJobsClear" apps packages`）。

- [ ] **Step 4: 用临时数据目录起 API 验证路由**

```bash
TMPDATA=$(mktemp -d)
DATA_DIR="$TMPDATA" PORT=3101 bun run dev:api &
sleep 2
curl -s "http://127.0.0.1:3101/api/me/jobs?sort=bogus"        # 期望 {"error":"invalid sort"}
curl -s "http://127.0.0.1:3101/api/me/jobs?status=bogus"      # 期望 {"error":"invalid status"}
curl -s "http://127.0.0.1:3101/api/me/jobs?sort=duration&order=asc" # 期望 {"items":[],"total":0,...}
curl -s "http://127.0.0.1:3101/api/me/jobs?status=active"     # 期望 {"items":[],"total":0,...}
curl -s -X POST "http://127.0.0.1:3101/api/me/jobs/1/pause"   # 期望 404 job not found
curl -s -X POST "http://127.0.0.1:3101/api/me/jobs/1/resume"  # 期望 404
curl -s -X DELETE -H 'content-type: application/json' -d '{"ids":[]}' "http://127.0.0.1:3101/api/me/jobs" # 期望 400
kill %1; rm -rf "$TMPDATA"
```

（不要在默认 `./data` 上跑——那是真实库；也不要 POST 创建真实任务，避免打上游。）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/index.ts packages/core/src/index.ts
git commit -m "feat(api): job pause/resume endpoints, batch delete, list sort/order"
```

---

### Task 6: 前端 API 层 lib/jobs.ts

**Files:**
- Modify: `apps/web/src/lib/jobs.ts`

**Interfaces:**
- Produces（Task 7–10 依赖）:
  - `JobStatus` 含 `"paused"`；`STATUS_LABEL.paused = "已暂停"`；`JOB_TYPE_LABEL` 改为 `{ archive_posts: "论坛归档", archive_books: "书库归档", archive_auto_group: "自动分组" }`
  - `type JobSortKey = "created_at" | "type" | "status" | "duration"`
  - `listJobs(opts?: { type?; status?; page?; limit?; sort?: JobSortKey; order?: "asc" | "desc" })`
  - `pauseJob(id): Promise<void>`、`resumeJob(id): Promise<void>`、`deleteJobsMany(ids): Promise<number>`
  - `TERMINAL_JOB_STATUSES: JobStatus[]`、`isTerminalJob(j: Job): boolean`
  - 删除：`clearFinishedJobs`、`POLL_MS_KEY`/`POLL_OPTIONS`/`getPollMs`/`setPollMs`；`formatJobProgress` 删 `nextMtid` 段。

- [ ] **Step 1: 改类型与常量**

```ts
export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "succeeded",
  "failed",
  "interrupted",
  "aborted",
]

export function isTerminalJob(j: Job): boolean {
  return TERMINAL_JOB_STATUSES.includes(j.status)
}
```

`STATUS_LABEL` 加 `paused: "已暂停"`；`JOB_TYPE_LABEL`/`ARCHIVE_MODE_LABEL` 按上面 Produces 改。

- [ ] **Step 2: 改函数**

`formatJobProgress` 删除这三行（`jobs.ts:93-95`）：

```ts
if (typeof result.nextMtid === "string" && result.nextMtid) {
  parts.push(`游标 ${result.nextMtid}`)
}
```

`listJobs` 扩参：

```ts
export async function listJobs(opts?: {
  type?: string
  status?: string
  page?: number
  limit?: number
  sort?: JobSortKey
  order?: "asc" | "desc"
}): Promise<{ items: Job[]; nextPage?: number; total: number }> {
  const params = new URLSearchParams()
  const page = Math.max(1, opts?.page ?? 1)
  const limit = opts?.limit ?? 20
  params.set("limit", String(limit))
  params.set("offset", String((page - 1) * limit))
  if (opts?.type) params.set("type", opts.type)
  if (opts?.status) params.set("status", opts.status)
  if (opts?.sort) params.set("sort", opts.sort)
  if (opts?.order) params.set("order", opts.order)
  // ...其余不变
}
```

新增（旧导出 `clearFinishedJobs`、`POLL_MS_KEY`/`POLL_OPTIONS`/`getPollMs`/`setPollMs` **本任务先保留**，`JobsPage`/`job-row` 还在引用；Task 10 页面重写后统一删除）：

```ts
export async function pauseJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/pause`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function resumeJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/resume`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function deleteJobsMany(ids: number[]): Promise<number> {
  const res = await fetch(api.meJobs, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  await throwIfNotOk(res)
  const json = (await res.json()) as { removed: number }
  return json.removed
}
```

- [ ] **Step 3: 类型检查（必须全绿——旧导出保留，页面未动）**

Run: `bun run typecheck`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/jobs.ts
git commit -m "feat(web): jobs lib paused status, sort/order, pause/resume/batch-delete"
```

---

### Task 7: JobLogPanel 级别筛选 + active 轮询

**Files:**
- Modify: `apps/web/src/components/job-log-panel.tsx`

**Interfaces:**
- Produces: `JobLogPanel({ jobId, active, pollMs }: { jobId: number; active: boolean; pollMs: number })`（prop `running` 更名 `active`，running|paused 都轮询）；级别筛选三档 `"" | "warn" | "error"` 精确匹配。

- [ ] **Step 1: 改组件**

关键改动（其余渲染不动）：

```tsx
const [level, setLevel] = useState<"" | "warn" | "error">("")
// poll 里 getJobLogs(jobId, { order: "desc", limit, level: level || undefined })
// 轮询条件 running → active
```

头部加筛选 UI（对齐现有 `text-[11px]` 小字风格）：

```tsx
<div className="flex items-center gap-1.5">
  {(
    [
      { v: "", label: "全部" },
      { v: "warn", label: "warn" },
      { v: "error", label: "error" },
    ] as const
  ).map((o) => (
    <button
      key={o.v}
      type="button"
      onClick={() => setLevel(o.v)}
      className={
        "rounded px-1.5 py-0.5 text-[11px] " +
        (level === o.v
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60")
      }
    >
      {o.label}
    </button>
  ))}
</div>
```

`useEffect` 依赖数组 `[jobId, active, pollMs, level]`。

- [ ] **Step 2: 更新现有调用点**

`grep -rn "JobLogPanel" apps/web/src` — `job-row.tsx` 调用点传 `running={running}` 改为 `active={running}`（该文件 Task 10 会整体替换，此处只求 typecheck 过）。

- [ ] **Step 3: 验证 + 提交**

Run: `bun run typecheck`
Expected: 全绿

```bash
git add apps/web/src/components/job-log-panel.tsx apps/web/src/components/job-row.tsx
git commit -m "feat(web): job log panel level filter, poll on active"
```

---

### Task 8: CreateJobModal 组件

**Files:**
- Create: `apps/web/src/components/create-job-modal.tsx`

**Interfaces:**
- Consumes: `startJob`、`ArchiveStatus`、`useConfirm`。
- Produces: `CreateJobModal({ open, onClose, statuses, hasActive, onStarted }: { open: boolean; onClose: () => void; statuses: Record<SiteId, ArchiveStatus | null>; hasActive: boolean; onStarted: () => void })`。

- [ ] **Step 1: 写组件**

```tsx
import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import {
  startJob,
  type ArchiveMode,
  type ArchiveStatus,
} from "@/lib/jobs"
import type { SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

type JobKind = "archive_posts" | "archive_books" | "archive_auto_group"

const KINDS: { value: JobKind; label: string; desc: string }[] = [
  {
    value: "archive_posts",
    label: "论坛归档",
    desc: "同步论坛主帖目录到本地",
  },
  { value: "archive_books", label: "书库归档", desc: "同步书库收录到本地" },
  {
    value: "archive_auto_group",
    label: "自动分组",
    desc: "按书名把多章帖子归入分组",
  },
]

const MODES: { value: ArchiveMode; label: string; desc: string }[] = [
  { value: "incremental", label: "增量", desc: "只补比库内新的内容（日常）" },
  { value: "full", label: "全量", desc: "从头扫全站，可能要一个多小时" },
  { value: "resume", label: "续跑", desc: "从上次中断处接着扫" },
]

/** 游标可续：next_mtid 存在且 status !== done（全站唯一判定，UI 不展示游标值） */
function cursorResumable(s: ArchiveStatus | null): boolean {
  return !!s?.cursor?.next_mtid && s.cursor.status !== "done"
}

export function CreateJobModal({
  open,
  onClose,
  statuses,
  hasActive,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  statuses: Record<SiteId, ArchiveStatus | null>
  hasActive: boolean
  onStarted: () => void
}) {
  const confirm = useConfirm()
  const [step, setStep] = useState<1 | 2>(1)
  const [kind, setKind] = useState<JobKind>("archive_posts")
  const [mode, setMode] = useState<ArchiveMode>("incremental")
  const [minMembers, setMinMembers] = useState(2)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setStep(1)
      setMode("incremental")
      setError("")
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const isAutoGroup = kind === "archive_auto_group"
  const site: SiteId = kind === "archive_books" ? "2" : "1"
  const resumable = cursorResumable(statuses[site])

  const submit = async () => {
    if (hasActive) return
    if (!isAutoGroup && mode === "full") {
      const ok = await confirm({
        title: "全量归档？",
        description:
          "会从头扫全站目录，耗时可能很长；日常同步用「增量」即可。",
        confirmLabel: "开始全量",
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    setError("")
    try {
      if (isAutoGroup) {
        await startJob("archive_auto_group", {
          site: "1",
          minMembers: Math.min(50, Math.max(2, Math.floor(minMembers) || 2)),
        })
      } else {
        await startJob(kind, { site, mode })
      }
      onStarted()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="创建任务"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold text-foreground">
          创建任务{step === 2 ? " · 选择参数" : ""}
        </h2>

        {step === 1 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  kind === k.value
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <div className="text-sm font-medium text-foreground">
                  {k.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {k.desc}
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 &&
          (kind === "archive_auto_group" ? (
            <label className="mt-4 block text-sm text-muted-foreground">
              最少章节数（2–50）
              <input
                type="number"
                min={2}
                max={50}
                value={minMembers}
                onChange={(e) => setMinMembers(Number(e.target.value))}
                className="mt-1 h-10 w-28 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          ) : (
            <div className="mt-4">
              {/* 模式：单行 segmented control（规格要求），选中态对所有模式生效（含续跑） */}
              <div className="flex gap-1.5">
                {MODES.map((m) => {
                  const disabled = m.value === "resume" && !resumable
                  return (
                    <button
                      key={m.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(m.value)}
                      className={cn(
                        "min-h-10 flex-1 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-40",
                        mode === m.value
                          ? "border-primary bg-accent text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent/50"
                      )}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {mode === "resume" && !resumable
                  ? "没有可续跑的进度"
                  : mode === "resume"
                    ? `从中断处接着扫（已记 ${statuses[site]?.cursor?.pages ?? 0} 页）`
                    : MODES.find((m) => m.value === mode)!.desc}
              </p>
            </div>
          ))}

        {hasActive && step === 2 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} /> 已有任务进行中或已暂停
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 underline underline-offset-2"
            >
              查看进行中任务
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-xl px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || hasActive}
              className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {busy ? "启动中…" : "启动"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `bun run typecheck`
Expected: 全绿

```bash
git add apps/web/src/components/create-job-modal.tsx
git commit -m "feat(web): two-step create job modal"
```

---

### Task 9: 统计卡 + 进行中条组件

**Files:**
- Create: `apps/web/src/components/job-stats-cards.tsx`
- Create: `apps/web/src/components/jobs-active-strip.tsx`

**Interfaces:**
- Consumes: `Job`、`ArchiveStatus`、`formatJobProgress`、`pauseJob/resumeJob/stopJob`、`JobLogPanel`、`SITES`、`routes`。
- Produces:
  - `JobStatsCards({ statuses, groupTotal, lastByType, activeStates }: { statuses: Record<SiteId, ArchiveStatus | null>; groupTotal: number | null; lastByType: Record<string, Job | undefined>; activeStates: Map<string, string> })`——`activeStates` 是 `type → job status`（来自 active 列表），卡片据此区分「进行中 / 已暂停」
  - `JobsActiveStrip({ jobs, onChanged }: { jobs: Job[]; onChanged: () => void })`（onChanged = 操作后让页面 silent 刷新）

- [ ] **Step 1: JobStatsCards**

```tsx
import { Link } from "react-router-dom"
import { formatJobProgress, type ArchiveStatus, type Job } from "@/lib/jobs"
import { routes, SITES, type SiteId } from "@/lib/routes"

function lastSummary(job: Job | undefined): string {
  if (!job) return "还没跑过"
  if (job.status === "succeeded") return `上次：${formatJobProgress(job.result) || "成功"}`
  return "上次未完成"
}

function Card({
  to,
  title,
  value,
  sub,
  state,
}: {
  to: string
  title: string
  value: string
  sub: string
  state: string
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm transition-colors hover:bg-accent/50"
    >
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      <div className="mt-2 text-xs font-medium text-foreground/80">{state}</div>
    </Link>
  )
}

export function JobStatsCards({
  statuses,
  groupTotal,
  lastByType,
  activeStates,
}: {
  statuses: Record<SiteId, ArchiveStatus | null>
  groupTotal: number | null
  lastByType: Record<string, Job | undefined>
  activeStates: Map<string, string>
}) {
  const siteState = (type: string, s: ArchiveStatus | null) => {
    // 活动态优先：区分「进行中 / 已暂停」（与验收清单、进行中条一致）
    const active = activeStates.get(type)
    if (active === "running" || active === "pending") return "进行中"
    if (active === "paused") return "已暂停"
    // 可续判定统一为一条：next_mtid 存在且 status !== done（UI 不展示游标值）
    if (s?.cursor?.next_mtid && s.cursor.status !== "done") {
      return "可从中断处接着扫"
    }
    if (s?.cursor?.status === "done") return "已扫完"
    return "—"
  }
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card
        to={routes.archive}
        title={SITES["1"].label}
        value={statuses["1"] ? `库内 ${statuses["1"].total} 条` : "—"}
        sub={lastSummary(lastByType["archive_posts"])}
        state={siteState("archive_posts", statuses["1"])}
      />
      <Card
        to={`${routes.archive}?site=2`}
        title={SITES["2"].label}
        value={statuses["2"] ? `库内 ${statuses["2"].total} 条` : "—"}
        sub={lastSummary(lastByType["archive_books"])}
        state={siteState("archive_books", statuses["2"])}
      />
      <Card
        to={routes.groups}
        title="自动分组"
        value={groupTotal != null ? `${groupTotal} 组` : "—"}
        sub={lastSummary(lastByType["archive_auto_group"])}
        state={siteState("archive_auto_group", null)}
      />
    </div>
  )
}
```

- [ ] **Step 2: JobsActiveStrip**

```tsx
import { useState } from "react"
import { Pause, Play, Square } from "lucide-react"
import {
  formatJobProgress,
  jobTypeLabel,
  pauseJob,
  resumeJob,
  stopJob,
  type Job,
} from "@/lib/jobs"
import { JobLogPanel } from "@/components/job-log-panel"

const POLL_MS = 1500

export function JobsActiveStrip({
  jobs,
  onChanged,
}: {
  jobs: Job[]
  onChanged: () => void
}) {
  const [openLog, setOpenLog] = useState<number | null>(null)
  if (jobs.length === 0) return null
  return (
    <section
      aria-label="进行中"
      className="mb-4 space-y-2 rounded-2xl border border-blue-500/25 bg-blue-500/10 px-3.5 py-3"
    >
      {jobs.map((job) => {
        const paused = job.status === "paused"
        return (
          <div key={job.id} className="text-sm text-blue-700 dark:text-blue-300">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {jobTypeLabel(job.type)}
                {paused ? "（已暂停）" : ""}
              </span>
              <span className="text-xs opacity-90 tabular-nums">
                {formatJobProgress(job.result) || "启动中…"}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {paused ? (
                  <button
                    type="button"
                    title="继续"
                    onClick={() => {
                      void resumeJob(job.id).then(onChanged)
                    }}
                    className="rounded-lg p-1.5 hover:bg-blue-500/15"
                  >
                    <Play size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="暂停"
                    onClick={() => {
                      void pauseJob(job.id).then(onChanged)
                    }}
                    className="rounded-lg p-1.5 hover:bg-blue-500/15"
                  >
                    <Pause size={14} />
                  </button>
                )}
                <button
                  type="button"
                  title="停止"
                  onClick={() => {
                    void stopJob(job.id).then(onChanged)
                  }}
                  className="rounded-lg p-1.5 hover:bg-blue-500/15"
                >
                  <Square size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenLog(openLog === job.id ? null : job.id)}
                  className="rounded-lg px-2 py-1 text-xs underline underline-offset-2"
                >
                  {openLog === job.id ? "收起日志" : "日志"}
                </button>
              </span>
            </div>
            {openLog === job.id && (
              <div className="mt-2 rounded-xl bg-background/60 p-2">
                <JobLogPanel
                  jobId={job.id}
                  active={job.status === "running" || job.status === "paused"}
                  pollMs={POLL_MS}
                />
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `bun run typecheck`
Expected: 全绿

```bash
git add apps/web/src/components/job-stats-cards.tsx apps/web/src/components/jobs-active-strip.tsx
git commit -m "feat(web): jobs stats cards and active strip components"
```

---

### Task 10: JobsPage 重写 + 任务表格，收尾删除

**Files:**
- Modify: `apps/web/src/pages/JobsPage.tsx`（整体重写）
- Create: `apps/web/src/components/jobs-table.tsx`
- Delete: `apps/web/src/components/job-row.tsx`
- Modify: `AGENTS.md`（jobs API 表）

**Interfaces:**
- Consumes: Task 6 lib、Task 7–9 组件、`Pager`/`AsyncBody`/`FilterTabs`/`useConfirm`、`api.meGroups`。
- Produces: 页面 `?type=&status=&sort=&order=&page=`；`JobsTable({ jobs, sort, order, onSortChange, selected, onSelectedChange, onDeleted }: { jobs: Job[]; sort: JobSortKey; order: "asc" | "desc"; onSortChange: (k: JobSortKey) => void; selected: number[]; onSelectedChange: (ids: number[]) => void; onDeleted: () => void })`（删除确认在表内 `useConfirm`，单删+批量删走 `deleteJob`/`deleteJobsMany`）。

- [ ] **Step 1: 写 JobsTable 组件**

```tsx
import { useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronUp, ExternalLink, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { JobLogPanel } from "@/components/job-log-panel"
import {
  deleteJob,
  deleteJobsMany,
  formatJobDuration,
  formatJobProgress,
  isTerminalJob,
  jobTypeLabel,
  STATUS_LABEL,
  type Job,
  type JobSortKey,
} from "@/lib/jobs"
import { routes, siteUrl } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

const POLL_MS = 1500

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  paused: "bg-blue-500/15 text-blue-500 dark:text-blue-300",
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
  aborted: "bg-muted text-muted-foreground",
}

function archiveSite(job: Job): string {
  if (typeof job.payload?.site === "string") return job.payload.site
  return job.type === "archive_books" ? "2" : "1"
}

function paramSummary(job: Job): string {
  const site = archiveSite(job) === "2" ? "书库" : "论坛"
  const mode = job.payload?.mode
  const modeLabel =
    mode === "full" ? "全量" : mode === "resume" ? "续跑" : mode === "incremental" ? "增量" : ""
  return [site, modeLabel].filter(Boolean).join(" · ")
}

function jumpTo(job: Job): string {
  if (job.type === "archive_auto_group") return routes.groups
  return siteUrl(routes.archive, archiveSite(job))
}

/** 可排序表头 */
function Th({
  label, sortKey, sort, order, onSortChange, className,
}: {
  label: string
  sortKey?: JobSortKey
  sort: JobSortKey
  order: "asc" | "desc"
  onSortChange: (k: JobSortKey) => void
  className?: string
}) {
  if (!sortKey) {
    return <th className={cn("px-3 py-2 text-left text-xs font-medium text-muted-foreground", className)}>{label}</th>
  }
  const active = sort === sortKey
  return (
    <th className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
        {active && <span className="text-[10px]">{order === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  )
}

export function JobsTable({
  jobs, sort, order, onSortChange, selected, onSelectedChange, onDeleted,
}: {
  jobs: Job[]
  sort: JobSortKey
  order: "asc" | "desc"
  onSortChange: (k: JobSortKey) => void
  selected: number[]
  onSelectedChange: (ids: number[]) => void
  onDeleted: () => void
}) {
  const confirm = useConfirm()
  const [openLog, setOpenLog] = useState<number | null>(null)
  const terminalIds = jobs.filter(isTerminalJob).map((j) => j.id)
  const allSelected = terminalIds.length > 0 && terminalIds.every((id) => selected.includes(id))

  const toggle = (id: number) => {
    onSelectedChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    )
  }

  const onDeleteOne = async (job: Job) => {
    if (!(await confirm({
      title: "删除该任务？",
      description: "任务记录及其日志将被永久删除。",
      confirmLabel: "删除",
      destructive: true,
    }))) return
    await deleteJob(job.id)
    onSelectedChange(selected.filter((s) => s !== job.id))
    onDeleted()
  }

  const onDeleteMany = async () => {
    if (selected.length === 0) return
    if (!(await confirm({
      title: `删除所选 ${selected.length} 条任务？`,
      description: "任务记录及其日志将被永久删除。",
      confirmLabel: "删除",
      destructive: true,
    }))) return
    await deleteJobsMany(selected)
    onSelectedChange([])
    onDeleted()
  }

  const logRow = (job: Job) => (
    <div className="py-2">
      {job.error && <p className="mb-2 break-all text-xs text-destructive">{job.error}</p>}
      <JobLogPanel
        jobId={job.id}
        active={job.status === "running" || job.status === "paused"}
        pollMs={POLL_MS}
      />
    </div>
  )

  return (
    <div>
      {selected.length > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-sm">
          <span className="text-sm text-muted-foreground">已选 {selected.length} 条</span>
          <button
            type="button"
            onClick={() => void onDeleteMany()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={13} /> 删除所选
          </button>
          <button
            type="button"
            onClick={() => onSelectedChange([])}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            取消选择
          </button>
        </div>
      )}

      {/* 手机：<sm 卡片行 */}
      <ul className="space-y-2.5 sm:hidden">
        {jobs.map((job) => {
          const terminal = isTerminalJob(job)
          return (
            <li key={job.id} className="rounded-2xl border border-border/80 bg-card/80 px-3 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                {terminal && (
                  <input
                    type="checkbox"
                    checked={selected.includes(job.id)}
                    onChange={() => toggle(job.id)}
                    className="size-4"
                  />
                )}
                <span className={cn("rounded-lg px-2 py-0.5 text-xs font-medium", STATUS_BADGE[job.status])}>
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="text-sm font-medium text-foreground">{jobTypeLabel(job.type)}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatJobDuration(job)}
                </span>
              </div>
              {formatJobProgress(job.result) && (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatJobProgress(job.result)}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1 text-xs">
                <Link to={jumpTo(job)} className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                  查看
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenLog(openLog === job.id ? null : job.id)}
                  className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {openLog === job.id ? "收起日志" : "日志"}
                </button>
                {terminal && (
                  <button
                    type="button"
                    onClick={() => void onDeleteOne(job)}
                    className="ml-auto rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    删除
                  </button>
                )}
              </div>
              {openLog === job.id && <div className="mt-2 border-t border-border/60 pt-2">{logRow(job)}</div>}
            </li>
          )
        })}
      </ul>

      {/* 手机行操作 ≤3 个平铺；若将来超过 3 个，收进「…」菜单（规格 #16） */}

      {/* 桌面：sm+ 表格 */}
      <table className="hidden w-full border-collapse sm:table">
        <thead>
          <tr className="border-b border-border">
            <th className="w-8 px-3 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectedChange(allSelected ? [] : terminalIds)}
                aria-label="全选本页已结束任务"
                className="size-4"
              />
            </th>
            <Th label="状态" sortKey="status" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="类型" sortKey="type" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="参数" sort={sort} order={order} onSortChange={onSortChange} className="hidden lg:table-cell" />
            <Th label="进度 / 结果" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="耗时" sortKey="duration" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="创建时间" sortKey="created_at" sort={sort} order={order} onSortChange={onSortChange} className="hidden lg:table-cell" />
            <Th label="操作" sort={sort} order={order} onSortChange={onSortChange} />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const terminal = isTerminalJob(job)
            const open = openLog === job.id
            return (
              <>
                <tr key={job.id} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="px-3 py-2.5">
                    {terminal ? (
                      <input
                        type="checkbox"
                        checked={selected.includes(job.id)}
                        onChange={() => toggle(job.id)}
                        className="size-4"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("rounded-lg px-2 py-0.5 text-xs font-medium", STATUS_BADGE[job.status])}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-foreground">{jobTypeLabel(job.type)}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground lg:table-cell">{paramSummary(job)}</td>
                  <td className="max-w-64 truncate px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                    {formatJobProgress(job.result)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{formatJobDuration(job)}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground tabular-nums lg:table-cell">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Link
                        to={jumpTo(job)}
                        title="查看"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ExternalLink size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setOpenLog(open ? null : job.id)}
                        title={open ? "收起日志" : "展开日志"}
                        aria-expanded={open}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {terminal && (
                        <button
                          type="button"
                          onClick={() => void onDeleteOne(job)}
                          title="删除"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {open && (
                  <tr key={`${job.id}-log`}>
                    <td colSpan={8} className="px-3 pb-3">{logRow(job)}</td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

（React fragment 内 key：`<>` 不能带 key，改用 `<Fragment key={job.id}>`，从 react 导入 `Fragment`。）

- [ ] **Step 2: 重写 JobsPage**

```tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Download, Plus, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { PageShell, Pager } from "@/components/page-shell"
import { useScrollTop } from "@/components/form-controls"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { JobStatsCards } from "@/components/job-stats-cards"
import { JobsActiveStrip } from "@/components/jobs-active-strip"
import { JobsTable } from "@/components/jobs-table"
import { CreateJobModal } from "@/components/create-job-modal"
import { ME_PAGE_SIZE, totalPages as calcTotalPages } from "@/lib/list-meta"
import {
  downloadBackup,
  formatJobProgress,
  getArchiveStatus,
  getJob,
  listJobs,
  type ArchiveStatus,
  type Job,
  type JobSortKey,
} from "@/lib/jobs"
import { api, parsePage, SITES, type SiteId } from "@/lib/routes"

const POLL_MS = 1500
const JOB_TYPES = ["archive_posts", "archive_books", "archive_auto_group"] as const

export default function JobsPage() {
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams)
  const type = searchParams.get("type") ?? ""
  const status = searchParams.get("status") ?? ""
  const sort = (searchParams.get("sort") ?? "created_at") as JobSortKey
  const order = searchParams.get("order") === "asc" ? "asc" : "desc"

  const [jobs, setJobs] = useState<Job[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<number[]>([])

  const [active, setActive] = useState<Job[]>([])
  const [statuses, setStatuses] = useState<Record<SiteId, ArchiveStatus | null>>({ "1": null, "2": null })
  const [groupTotal, setGroupTotal] = useState<number | null>(null)
  const [lastByType, setLastByType] = useState<Record<string, Job | undefined>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState("")
  const prevActiveRef = useRef<Set<number>>(new Set())

  /** 筛选/排序/翻页写 URL；改筛选或排序时 page 重置 */
  function update(next: {
    page?: number
    type?: string
    status?: string
    sort?: string
    order?: string
  }) {
    const params = new URLSearchParams(searchParams)
    let resetPage = false
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") params.delete(k)
      else params.set(k, v)
      if (k !== "page") resetPage = true
    }
    if (resetPage) params.delete("page")
    else if (next.page === 1) params.delete("page")
    setSearchParams(params, { replace: true })
  }

  const loadTable = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError("")
      try {
        const data = await listJobs({
          page,
          type: type || undefined,
          status: status || undefined,
          sort,
          order,
        })
        setJobs(data.items)
        setNextPage(data.nextPage)
        setTotal(data.total)
        setSelected((prev) => prev.filter((id) => data.items.some((j) => j.id === id)))
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, type, status, sort, order]
  )

  /** 进行中条 + 统计卡数据（与表格筛选无关，独立请求） */
  const loadSide = useCallback(async () => {
    const [activeRes, s1, s2, groupsRes, ...lasts] = await Promise.all([
      listJobs({ status: "active", limit: 10, sort: "created_at", order: "desc" }),
      getArchiveStatus("1"),
      getArchiveStatus("2"),
      fetch(`${api.meGroups}?limit=1`).then((r) => r.json() as Promise<{ total?: number }>),
      ...JOB_TYPES.map((t) =>
        listJobs({ type: t, status: "finished", limit: 1, sort: "created_at", order: "desc" })
      ),
    ])
    setActive(activeRes.items)
    setStatuses({ "1": s1, "2": s2 })
    setGroupTotal(typeof groupsRes.total === "number" ? groupsRes.total : null)
    const byType: Record<string, Job | undefined> = {}
    lasts.forEach((res, i) => {
      byType[JOB_TYPES[i]] = res.items[0]
    })
    setLastByType(byType)

    // 结束通知：active 集合从非空变空（running→paused 不算结束）
    const prev = prevActiveRef.current
    const now = new Set(activeRes.items.map((j) => j.id))
    if (prev.size > 0 && now.size === 0) {
      for (const id of prev) {
        try {
          const job = await getJob(id)
          if (job && job.status !== "running" && job.status !== "paused" && job.status !== "pending") {
            const title =
              job.status === "succeeded"
                ? "任务已完成"
                : job.status === "aborted"
                  ? "任务已停止"
                  : job.status === "failed"
                    ? "任务失败"
                    : "任务已结束"
            const detail = formatJobProgress(job.result) || job.error || ""
            setToast(detail ? `${title}：${detail}` : title)
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                new Notification(title, { body: detail || undefined })
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // 任务可能已被删除
        }
      }
    }
    prevActiveRef.current = now
  }, [])

  useEffect(() => {
    void loadTable()
  }, [loadTable])
  useEffect(() => {
    void loadSide()
  }, [loadSide])

  // 越界回退
  useEffect(() => {
    if (loading || error || total <= 0) return
    const maxPage = calcTotalPages(total, ME_PAGE_SIZE)
    if (page > maxPage) update({ page: maxPage })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only
  }, [loading, error, total, page])

  useScrollTop([page])

  // active 存在时 1.5s 轮询（绑实例级 active，不绑当前页表格）
  const hasActive = active.length > 0
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => {
      void loadTable(true)
      void loadSide()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [hasActive, loadTable, loadSide])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const onClearCache = async () => {
    if (!(await confirm({
      title: "清空内容缓存？",
      description: "将删除所有正文/书库 HTML 与回复 JSON 缓存，不影响历史、收藏与标签。",
      confirmLabel: "清空",
      destructive: true,
    }))) return
    const res = await fetch(api.meCache, { method: "DELETE" })
    const json = (await res.json()) as { cleared?: number; error?: string }
    setToast(res.ok ? `已清除 ${json.cleared ?? 0} 个缓存文件` : json.error || "清空失败")
  }

  return (
    <PageShell maxWidth="xwide">
      <PageHeader
        title="任务"
        description="同步目录、自动分组与备份"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission()
                }
                setModalOpen(true)
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus size={14} /> 创建任务
            </button>
            <button
              type="button"
              onClick={() => downloadBackup()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Download size={14} /> 导出备份
            </button>
            <button
              type="button"
              onClick={() => void onClearCache()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Trash2 size={14} /> 清空缓存
            </button>
          </div>
        }
      />

      {toast && (
        <div role="status" className="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          {toast}
        </div>
      )}

      <JobStatsCards
        statuses={statuses}
        groupTotal={groupTotal}
        lastByType={lastByType}
        activeStates={new Map(active.map((j) => [j.type, j.status] as const))}
      />
      <JobsActiveStrip jobs={active} onChanged={() => { void loadSide(); void loadTable(true) }} />

      {/* 筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => update({ type: e.target.value })}
          aria-label="类型筛选"
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">全部类型</option>
          <option value="archive_posts">论坛归档</option>
          <option value="archive_books">书库归档</option>
          <option value="archive_auto_group">自动分组</option>
        </select>
        <select
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          aria-label="状态筛选"
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">全部状态</option>
          <option value="running">运行中</option>
          <option value="paused">已暂停</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="interrupted">中断</option>
          <option value="aborted">已停止</option>
        </select>
      </div>

      <AsyncBody loading={loading} error={error} empty={jobs.length === 0} onRetry={() => void loadTable()} emptyText="暂无任务记录">
        <JobsTable
          jobs={jobs}
          sort={sort}
          order={order}
          onSortChange={(k) => update({ sort: k, order: k === sort && order === "desc" ? "asc" : "desc" })}
          selected={selected}
          onSelectedChange={setSelected}
          onDeleted={() => {
            void loadTable(true)
            void loadSide()
          }}
        />
        {(total > ME_PAGE_SIZE || nextPage !== undefined) && (
          <Pager
            page={page}
            hasNext={nextPage !== undefined}
            totalPages={calcTotalPages(total, ME_PAGE_SIZE)}
            total={total}
            onPrev={() => update({ page: Math.max(1, page - 1) })}
            onNext={() => nextPage !== undefined && update({ page: nextPage })}
            onPage={(n) => update({ page: n })}
            disabled={loading}
          />
        )}
      </AsyncBody>

      <CreateJobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        statuses={statuses}
        hasActive={hasActive}
        onStarted={() => {
          void loadSide()
          void loadTable(true)
        }}
      />
    </PageShell>
  )
}
```

实现时以编译器为准修正小问题（如 `SITES` 若未用到则去掉 import；`parsePage` 签名核对 `lib/routes.ts`）。

- [ ] **Step 3: 删除 job-row.tsx 与 lib/jobs.ts 遗留导出，确认无引用**

```bash
rm apps/web/src/components/job-row.tsx
grep -rn "job-row\|JobRow" apps/web/src   # 期望无输出
```

同时删除 Task 6 暂留的 `apps/web/src/lib/jobs.ts` 旧导出：`clearFinishedJobs`、`POLL_MS_KEY`、`POLL_OPTIONS`、`getPollMs`、`setPollMs`（页面已不再引用）：

```bash
grep -rn "clearFinishedJobs\|POLL_OPTIONS\|getPollMs\|setPollMs" apps/web/src   # 期望无输出
bun run typecheck   # 全绿
```

- [ ] **Step 4: 更新 AGENTS.md API 表**

jobs 相关行改为（保持表格列结构）：

- `GET /api/me/jobs`：参数补 `sort（created_at|type|status|duration 默认 created_at）`、`order（asc|desc 默认 desc）`；`status` 支持 `active`（running|paused|pending）与 `finished`（终态）聚合值。
- `POST /api/me/jobs`：不变。
- `DELETE /api/me/jobs`：body `{ ids: number[] }` 批量删除已结束任务 `{ ok, removed }`；含活动任务整批 409。
- 单条 `DELETE /api/me/jobs/:id`：仅终态可删，否则 409。
- 新增两行：`POST /api/me/jobs/:id/pause`（仅 running，`{ ok }`；非 running 409）、`POST /api/me/jobs/:id/resume`（仅 paused，`{ ok }`；非 paused 409）。
- `POST /api/me/jobs/:id/stop` 行为改为「running/paused 可停」。

- [ ] **Step 5: 全仓验证**

Run: `bun run typecheck && bun run test && bun run build`
Expected: 全部通过。

- [ ] **Step 6: 手工验收（Chrome，dev 双起）**

```bash
bun run dev
```

浏览器（桌面 1280 + 手机 390 各一遍）核对清单：

1. 创建任务：modal 两步、全量确认框、占用时无「启动」按钮。
2. 进行中条：暂停 → 卡片「已暂停」、进度停走；继续 → 进度恢复；停止 → 条消失、toast 响。
3. `?status=succeeded` 筛选下暂停/停止入口仍在（进行中条）。
4. 表格：四列排序、筛选变化 page 重置、勾选批量删除、日志 accordion、active 行无操作按钮。
5. 手机 390：卡片行、操作不溢出；桌面：表格列完整。
6. 重启 API：running/paused 变「中断」，论坛任务 modal 出现「续跑（已记 N 页）」。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(web): jobs page redesign - stats cards, active strip, create modal, sortable table"
```

---

## Self-Review 结果

- 规格覆盖：暂停/继续（T1–T5）、排序/批量删除（T2/T5）、统计卡数据源（T9）、进行中条与轮询/toast（T9/T10）、创建 modal（T8）、表格响应式与批量（T10）、日志级别筛选（T7）、移除项（T6 暂留 + T10 Step 3 统一删）、AGENTS.md（T10）、重启边界（既有行为，T10 验收 6）——均有对应任务。
- 类型一致性：`JobSortKey`/`markPaused`/`markResumed`/`deleteJobsMany`/`checkpoint`/`pauseJob`/`resumeJob`/组件 props 各任务间签名一致；`JobLogPanel` prop 统一为 `active`；统计卡统一为 `activeStates: Map<string, string>`（区分进行中/已暂停）。
- Plan-review 修订（第二轮）：checkpoint 唤醒改为 resume/stop/abortAll 显式调 `h.wake`（无 abort listener 闭包，二次挂起可唤醒，含回归测试）；`deleteJobsMany` 先 COUNT 再删（`changes()` 计入 CASCADE 日志）；Task 2 排序断言与 SQL 一致（type 用 asc、duration tie-break、status 三态）；store 过滤全部占位符绑定 + API status 白名单；Task 6–9 每任务 typecheck 全绿（旧导出暂留至 T10 删）；modal 续跑选中态、去掉编造的 78 分钟、segmented 单行 + 「查看进行中任务」按钮；前端 import 统一 `react-router-dom`。
