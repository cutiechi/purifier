# 书库全量目录（归档模式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给书库站（site=2, xbookcn）加对等的「目录」：新增 `archive_books` 归档 job 把 `/novels/{n}` 全站书目抓进现有 `archive_posts` 表，前端 ArchivePage / JobsPage 解除 site=1 限制并做书库适配。

**Architecture:** 完全复用现有 `archive_posts` 表、`/api/me/archive*` API 与 ArchivePage 数据流（Store 归档方法全部按 site 通用，`archive_cursors` 主键即 site）。只新增一个独立 handler（`ArchiveBooksJob`，参照 `ArchivePostsJob`，游标语义为页码递增，从第 1 页 `"1"` 起扫），并在 API 启动处注册一行。前端按 `useSite()` 分流：书库站排序默认 archived_at+asc、隐藏「按 tid」、条目走 `/book/:cid`、不做标题分组、任务页切换 job type。

**Tech Stack:** Bun + TypeScript（strict）、SQLite（bun:sqlite）、React 19 + React Router 7 + Tailwind 4、Vite。

## Global Constraints

- 不改 `archive_posts` / `archive_cursors` schema；不加新 API 路由；不动论坛 `ArchivePostsJob`（含其 site=1 限制）；不做书库自动分组。
- 新 job `type = "archive_books"`；payload 默认 `{ site: "2" }`；`site !== "2"` 抛错（与 archive_posts 的 site 校验对称）。
- 页码游标从 `"1"` 起（`"0"` 是首页时间线，卡片语义不同，不得作为起始页）。
- `delayMs` 默认 800（200–5000 内有效，否则回落 800）；`maxPages` 可选（1–100_000）。
- progress 字段 shape 与 `archive_posts` 一致（`mode/pages/inserted/updated/site/mtid/nextMtid/stopReason`），`formatJobProgress` 直接复用、零改动。
- 前端书库站：隐藏「按 tid」排序；`archived_at` 排序显式传 `order=asc`（最新收录在前）；条目链接走 `bookPath`（`/book/:cid`）；不调用 `groupBooks`；「更新目录 / 返回目录 / 查看归档 / 打开归档目录」链接一律带 `site` 参数。
- 代码风格：Prettier（无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`）；TS strict；页面导入 `@/` 别名。
- 测试在 `packages/core`（`bun test`）；改动后用 `bun run test`、`bun run typecheck`、`bun run build` 验证。

**对 spec 公式的三处修正（均已代码验证，实施时按本计划，不复刻 spec 原文）：**

1. **增量停止条件用 `pages > savedDepth`（spec 写 `>=`）**。推演：残缺归档（已存第 1..N 页、游标 interrupted、pages=N）下，若用 `>=`，扫到第 N 页（全已存在、inserted=0、N>=N）就停，第 N+1..末页的未归档缺口永远补不上，与 spec 测试 4「最终翻到末页」（自愈）直接矛盾；`>` 会越过旧深度扫进未归档区域（inserted>0），追到末页或遇到越过深度的空增页才停。完整归档（savedDepth=末页）下两者差异仅一页（779 vs 780），可忽略。
2. **停滞检测用 `Number(page.nextMtid) <= Number(mtid)`（spec 写 `>=`）**。书库 `nextMtid` 是页码+1（"2" ≥ "1" 恒真），照抄 cool18 的 `>=`（tid 递减语义）会在第 1 页就误判停滞。
3. **`apps/api/src/index.ts` 需加一行 `runner.register(new ArchiveBooksJob(store))`**。spec 说「API 层零改动」成立的是路由层；handler 注册表在 API 启动代码里（`index.ts:47-49`），不注册则 `POST /api/me/jobs` 返回 400 unknown job type。

---

### Task 1: ArchiveBooksJob（core handler + 注册 + 测试）

**Files:**
- Create: `packages/core/src/jobs/handlers/archive_books.ts`
- Create: `packages/core/src/jobs/handlers/archive_books.test.ts`
- Modify: `packages/core/src/jobs/index.ts:4-5`（加一行 export）
- Modify: `apps/api/src/index.ts:14-15`（import）、`:48-49`（register 一行）

**Interfaces:**
- Consumes: `resolveSite("2").fetchHomeLinks(mtid, signal): Promise<HomePage>`（`xbookcn.ts:254-275`，mtid="1" → `/novels/1`）；`Store.upsertArchivePosts(site, items, ts): { inserted, updated }`；`Store.getArchiveCursor(site): ArchiveCursor | null`；`Store.setArchiveCursor(site, { next_mtid, mode, status, pages })`；`sleep(ms, signal)`；`JobContext { log, reportProgress, signal, payload }`。
- Produces: `class ArchiveBooksJob implements JobHandler`（`type = "archive_books"`，可覆盖实例方法 `fetchPage(mtid, signal)` 作为测试 seam，构造函数 `(store: Store, now?: () => number)`）；`JobResult` 含 `pages/inserted/updated/site/mode/stopReason/nextMtid`。测试文件自带 `link()/page()/makeJob()/makeCtx()` 工厂（结构与 `archive_posts.test.ts:11-46` 一致）。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/jobs/handlers/archive_books.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "../../storage/db"
import { Store } from "../../storage/store"
import type { ChapterLink, HomePage } from "../../extractor"
import { ArchiveBooksJob } from "./archive_books"
import type { JobContext } from "../handler"

/** ChapterLink 必填 index；工厂补默认 0（handler 不读 index） */
function link(tid: string, title: string): ChapterLink {
  return { index: 0, tid, title }
}

function page(links: ChapterLink[], nextMtid: string | null): HomePage {
  return { links, nextMtid }
}

function makeJob() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-archive-books-"))
  const db = openDatabase(dir)
  let t = 10_000
  const store = new Store(db, () => t++)
  const job = new ArchiveBooksJob(store, () => t++)
  return { job, store, dir }
}

function makeCtx(payload: Record<string, unknown> = {}): {
  ctx: JobContext
  logs: Array<{ level: string; message: string }>
  progress: Array<Record<string, unknown>>
  controller: AbortController
} {
  const controller = new AbortController()
  const logs: Array<{ level: string; message: string }> = []
  const progress: Array<Record<string, unknown>> = []
  const ctx: JobContext = {
    jobId: 1,
    log: (level, message) => logs.push({ level, message }),
    reportProgress: (p) => progress.push(p),
    signal: controller.signal,
    payload,
  }
  return { ctx, logs, controller, progress }
}

describe("ArchiveBooksJob", () => {
  test("full：从第 1 页翻到末页，游标推进正确", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("MjI4Nzg", "新书 A"), link("MjI4Nzc", "新书 B")], "2"),
      page([link("MjI4NzY", "旧书 C")], null),
    ]
    const fetched: string[] = []
    job.fetchPage = async (mtid) => {
      fetched.push(mtid)
      return pages[Number(mtid) - 1] ?? page([], null)
    }
    const { ctx } = makeCtx({ delayMs: 200 })
    const result = await job.run(ctx)
    expect(fetched).toEqual(["1", "2"])
    expect(result.pages).toBe(2)
    expect(result.inserted).toBe(3)
    expect(result.site).toBe("2")
    expect(result.mode).toBe("full")
    expect(result.stopReason).toBe("end")
    const list = store.listArchivePosts("2", {
      page: 1,
      limit: 10,
      sort: "title",
    })
    // title 升序：新(65B0) < 旧(65E7)
    expect(list.items.map((x) => x.tid)).toEqual([
      "MjI4Nzg",
      "MjI4Nzc",
      "MjI4NzY",
    ])
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("resume：从游标页继续到末页", async () => {
    const { job, store, dir } = makeJob()
    const pages: HomePage[] = [
      page([link("A1", "a")], "2"),
      page([link("A2", "b")], "3"),
      page([link("A3", "c")], null),
    ]
    job.fetchPage = async (mtid) => pages[Number(mtid) - 1] ?? page([], null)
    // 先跑 maxPages=1，留下续跑点
    await job.run(makeCtx({ delayMs: 200, maxPages: 1 }).ctx)
    const cur = store.getArchiveCursor("2")
    expect(cur?.status).toBe("interrupted")
    expect(cur?.next_mtid).toBe("2")
    // resume 从第 2 页继续
    const result = await job.run(makeCtx({ delayMs: 200, mode: "resume" }).ctx)
    expect(result.pages).toBe(2)
    expect(result.inserted).toBe(2) // A2、A3
    expect(
      store
        .listArchivePosts("2", { page: 1, limit: 10, sort: "title" })
        .items.map((x) => x.tid)
    ).toEqual(["A1", "A2", "A3"])
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("incremental × 完整归档且站点扩容：越过旧深度后空增页即停", async () => {
    const { job, store, dir } = makeJob()
    // 完整归档：5 页各 1 本入库，游标 done、pages=5
    store.upsertArchivePosts(
      "2",
      [
        { tid: "P1A", title: "old" },
        { tid: "P2A", title: "old" },
        { tid: "P3A", title: "old" },
        { tid: "P4A", title: "old" },
        { tid: "P5A", title: "old" },
      ],
      1_000
    )
    store.setArchiveCursor("2", {
      next_mtid: null,
      mode: "full",
      status: "done",
      pages: 5,
    })
    // 2 本新书置顶，旧书各下移一页 → 站点扩容到 6 页；第 6 页只剩已归档的 P5A
    // （末页恰好等于旧深度的数据在 `>` 下永远触发不到越过条件，只会走 "end"，
    //   无法验证 incremental_caught_up 分支——见 review.md B1）
    const pages: HomePage[] = [
      page([link("NEW1", "新书"), link("NEW2", "新书2")], "2"),
      page([link("P1A", "old")], "3"),
      page([link("P2A", "old")], "4"),
      page([link("P3A", "old")], "5"),
      page([link("P4A", "old")], "6"),
      page([link("P5A", "old")], null), // 越过旧深度(5)的第 6 页：全已入库 → inserted=0
    ]
    let i = 0
    job.fetchPage = async () => pages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200, mode: "incremental" }).ctx)
    expect(i).toBe(6) // 翻到第 6 页（旧深度+1）空增即停，不扫第 7 页
    expect(result.inserted).toBe(2) // 只补 2 本新书
    expect(result.stopReason).toBe("incremental_caught_up")
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("incremental × 部分归档（回归）：不停在第 1 页，追到末页自愈", async () => {
    const { job, store, dir } = makeJob()
    // 先跑 full：maxPages=2 中断 → 已存第 1、2 页，游标 interrupted pages=2
    const oldPages: HomePage[] = [
      page([link("P1A", "old"), link("P1B", "old")], "2"),
      page([link("P2A", "old"), link("P2B", "old")], "3"),
      page([link("P3A", "old")], null),
    ]
    job.fetchPage = async (mtid) => oldPages[Number(mtid) - 1] ?? page([], null)
    await job.run(makeCtx({ delayMs: 200, maxPages: 2 }).ctx)
    expect(store.getArchiveCursor("2")?.status).toBe("interrupted")
    expect(store.getArchiveCursor("2")?.pages).toBe(2)

    // 新书到达 + 旧页下移：第 1 页混入 NEW1/NEW2，第 2 页全已在库，第 3 页是未归档区（P4A 更旧）
    const nowPages: HomePage[] = [
      page([link("NEW1", "新书"), link("NEW2", "新书2"), link("P1A", "old"), link("P1B", "old")], "2"),
      page([link("P2A", "old"), link("P2B", "old")], "3"),
      page([link("P3A", "old"), link("P4A", "更旧")], null),
    ]
    let i = 0
    job.fetchPage = async () => nowPages[i++] ?? page([], null)
    const result = await job.run(makeCtx({ delayMs: 200, mode: "incremental" }).ctx)
    expect(i).toBe(3) // 关键：不停在第 1/2 页（旧实现 inserted=0 即停），翻到末页
    // 首轮 maxPages=2 只归档第 1、2 页，第 3 页从未入库 → P3A、P4A 全新补入
    expect(result.inserted).toBe(4) // NEW1、NEW2、P3A、P4A（review.md B2）
    expect(result.stopReason).toBe("end")
    expect(store.getArchiveCursor("2")?.status).toBe("done")
    rmSync(dir, { recursive: true, force: true })
  })

  test("resume 跨站隔离：site=2 游标不影响 site=1", async () => {
    const { job, store, dir } = makeJob()
    job.fetchPage = async () => page([link("B1", "b")], "2")
    await job.run(makeCtx({ delayMs: 200, maxPages: 1 }).ctx)
    expect(store.getArchiveCursor("2")?.status).toBe("interrupted")
    expect(store.getArchiveCursor("1")).toBeNull()
    expect(
      store.listArchivePosts("1", { page: 1, limit: 10, sort: "title" }).items
    ).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test("site !== '2' → 抛错", async () => {
    const { job, dir } = makeJob()
    const { ctx } = makeCtx({ site: "1" })
    await expect(job.run(ctx)).rejects.toThrow(/site: 1/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test`
Expected: FAIL — `archive_books.test.ts` 报模块找不到 `./archive_books`（handler 尚未创建）。

- [ ] **Step 3: 写实现**

创建 `packages/core/src/jobs/handlers/archive_books.ts`：

```ts
import { resolveSite } from "../../extractor"
import type { HomePage } from "../../extractor"
import type { Store } from "../../storage/store"
import { sleep } from "../sleep"
import type { JobContext, JobHandler, JobResult } from "../handler"

export type ArchiveMode = "full" | "resume" | "incremental"

export class ArchiveBooksJob implements JobHandler {
  type = "archive_books"

  /**
   * 测试 seam：默认走真实 xbookcn fetchHomeLinks；测试可覆盖。
   * 生产代码用 this.run 里的实现，这里给个可覆盖的实例方法。
   */
  fetchPage = async (
    mtid: string,
    signal?: AbortSignal
  ): Promise<HomePage> => {
    const extractor = resolveSite("2")
    return extractor.fetchHomeLinks(mtid, signal)
  }

  constructor(
    private store: Store,
    private now: () => number = Date.now
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const site = String(ctx.payload.site ?? "2")
    // v2 仅 xbookcn（site=2）：/novels/{n} 页码递增、小说卡片。
    if (site !== "2") {
      throw new Error(`book archive not supported for site: ${site}`)
    }

    const mode = parseMode(ctx.payload.mode)
    const rawDelay = Number(ctx.payload.delayMs)
    const delayMs =
      Number.isFinite(rawDelay) && rawDelay >= 200 && rawDelay <= 5000
        ? rawDelay
        : 800
    const rawMaxPages = Number(ctx.payload.maxPages)
    const maxPages =
      Number.isFinite(rawMaxPages) && rawMaxPages >= 1 && rawMaxPages <= 100_000
        ? Math.floor(rawMaxPages)
        : null

    // 起始页：页码从 "1" 起（"0" 是首页时间线，卡片语义不同）
    let mtid = "1"
    if (mode === "resume") {
      const cur = this.store.getArchiveCursor(site)
      if (cur?.next_mtid) {
        mtid = cur.next_mtid
        ctx.log("info", `resume from next_mtid=${mtid} (saved pages=${cur.pages})`)
      } else if (cur?.status === "done") {
        // 对齐 archive_posts.ts:56-58：有游标但已做完，别误报「无游标」（review.md M1）
        ctx.log("info", "cursor done; resume falls back to full from page 1")
        mtid = "1"
      } else {
        ctx.log("info", "no saved cursor; resume starts from page 1")
        mtid = "1"
      }
    } else if (
      typeof ctx.payload.fromMtid === "string" &&
      ctx.payload.fromMtid.trim()
    ) {
      mtid = ctx.payload.fromMtid.trim()
      ctx.log("info", `start from explicit fromMtid=${mtid}`)
    }

    // 增量停止深度：本次运行前已归档页数（无游标则 0）。
    // 注意用「越过」而非「到达」：残缺归档（interrupted、pages=N）下，
    // 第 1..N 页全已存在、本页 inserted=0，必须继续扫进未归档区（N+1..末页）才能自愈；
    // 到达旧深度就停（>=）会永远留下 N+1..末页的缺口（评审问题 1）。
    let savedDepth = 0
    if (mode === "incremental") {
      savedDepth = this.store.getArchiveCursor(site)?.pages ?? 0
      ctx.log(
        "info",
        `incremental: saved depth=${savedDepth} pages; stop when a page past depth has no new books`
      )
    }

    this.store.setArchiveCursor(site, {
      next_mtid: mtid,
      mode,
      status: "running",
      pages: 0,
    })

    let pages = 0
    let inserted = 0
    let updated = 0
    let lastError: string | null = null
    let stopReason = "completed"

    while (!ctx.signal.aborted) {
      let page: HomePage
      try {
        page = await this.fetchPage(mtid, ctx.signal)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        ctx.log("warn", `page ${pages + 1} failed: ${lastError}; stopping`)
        stopReason = "error"
        break
      }
      pages++
      if (page.links.length === 0) {
        ctx.log("info", `page ${pages}: empty, done`)
        stopReason = "empty"
        this.store.setArchiveCursor(site, {
          next_mtid: null,
          mode,
          status: "done",
          pages,
        })
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

      // 增量：本页无新书且已越过旧深度 → 追平，停
      if (mode === "incremental" && res.inserted === 0 && pages > savedDepth) {
        ctx.log(
          "info",
          `page ${pages}: no new books past saved depth ${savedDepth}, stop`
        )
        stopReason = "incremental_caught_up"
        this.store.setArchiveCursor(site, {
          next_mtid: page.nextMtid,
          mode,
          status: "done",
          pages,
        })
        ctx.reportProgress({
          pages,
          inserted,
          updated,
          site,
          mode,
          mtid,
          nextMtid: page.nextMtid,
          stopReason,
        })
        break
      }

      // 续跑游标：下一页入口
      this.store.setArchiveCursor(site, {
        next_mtid: page.nextMtid,
        mode,
        status: "running",
        pages,
      })
      ctx.reportProgress({
        pages,
        inserted,
        updated,
        site,
        mode,
        mtid,
        nextMtid: page.nextMtid,
      })

      if (!page.nextMtid) {
        ctx.log("info", `reached end (no nextMtid)`)
        stopReason = "end"
        this.store.setArchiveCursor(site, {
          next_mtid: null,
          mode,
          status: "done",
          pages,
        })
        break
      }
      // 页码递增语义：nextMtid 必须比当前页大才算推进；否则停（防卡死）
      // （cool18 的 tid 递减是 >= 停滞，书库页码递增要反过来）
      if (Number(page.nextMtid) <= Number(mtid)) {
        ctx.log(
          "info",
          `reached end (cursor not advancing: ${page.nextMtid} <= ${mtid})`
        )
        stopReason = "cursor_stuck"
        this.store.setArchiveCursor(site, {
          next_mtid: null,
          mode,
          status: "done",
          pages,
        })
        break
      }

      if (maxPages != null && pages >= maxPages) {
        ctx.log("info", `maxPages=${maxPages} reached; pause for resume`)
        stopReason = "max_pages"
        this.store.setArchiveCursor(site, {
          next_mtid: page.nextMtid,
          mode,
          status: "interrupted",
          pages,
        })
        break
      }

      mtid = page.nextMtid
      await sleep(delayMs, ctx.signal)
    }

    if (ctx.signal.aborted) {
      ctx.log("warn", "aborted by user")
      stopReason = "aborted"
      // 保留 next_mtid 供续跑（当前 mtid 是本页游标；下一页已写在 cursor）
      const cur = this.store.getArchiveCursor(site)
      this.store.setArchiveCursor(site, {
        next_mtid: cur?.next_mtid ?? mtid,
        mode,
        status: "interrupted",
        pages,
      })
    } else if (lastError) {
      const cur = this.store.getArchiveCursor(site)
      this.store.setArchiveCursor(site, {
        next_mtid: cur?.next_mtid ?? mtid,
        mode,
        status: "interrupted",
        pages,
      })
    }

    const result: JobResult = {
      pages,
      inserted,
      updated,
      site,
      mode,
      stopReason,
      nextMtid: this.store.getArchiveCursor(site)?.next_mtid ?? null,
    }
    if (lastError) {
      throw new Error(`book archive stopped on page error: ${lastError}`)
    }
    return result
  }
}

function parseMode(raw: unknown): ArchiveMode {
  if (raw === "resume" || raw === "incremental" || raw === "full") return raw
  return "full"
}
```

- [ ] **Step 4: 注册 handler**

`packages/core/src/jobs/index.ts`（`:4-5` 处，按现有顺序）：

```ts
export { ArchiveBooksJob } from "./handlers/archive_books"
```

`apps/api/src/index.ts`：

- `:14-15` 的 `@workspace/core` import 块中，在 `ArchiveAutoGroupJob,` 之后加 `ArchiveBooksJob,`（保持字母序：`ArchiveAutoGroupJob, ArchiveBooksJob, ArchivePostsJob`）。
- `:48-49` 之后加一行：

```ts
runner.register(new ArchiveBooksJob(store))
```

- [ ] **Step 5: 运行测试，确认全过**

Run: `bun run test`
Expected: PASS — 新增 6 个测试全部通过（含既有测试不回归）。

- [ ] **Step 6: 类型检查**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/jobs/handlers/archive_books.ts packages/core/src/jobs/handlers/archive_books.test.ts packages/core/src/jobs/index.ts apps/api/src/index.ts
git commit -m "feat(core): add archive_books job for xbookcn catalog"
```

---

### Task 2: ArchivePage 解除 site 限制 + 书库适配

**Files:**
- Modify: `apps/web/src/lib/routes.ts`（加 `siteUrl` 导出）
- Modify: `apps/web/src/pages/ArchivePage.tsx`

**Interfaces:**
- Consumes: `useSite(): SiteId`；`useAllTabs(activePath)`（签名不变，内部行为 Task 3 改）；`api.meArchive`；`readPath(tid, site)` / `bookPath(cid, { site })`（`routes.ts:112-128` 已有）；`groupBooks`、`CollapsibleBookGroup`（仅论坛用）。
- Produces: `siteUrl(path: string, site?: SiteId): string`（routes.ts 新导出，默认站返回原路径）；ArchivePage 在 site=2 下渲染书库列表（不分组、archived_at asc、无「按 tid」、条目 `/book/:cid`）。

- [ ] **Step 1: routes.ts 加 `siteUrl`**

在 `apps/web/src/lib/routes.ts` 的 `withSite`（`:108-110`）之后加：

```ts
/** 站点参数拼接到路径（默认站不加参数） */
export function siteUrl(path: string, site?: SiteId): string {
  if (!site || site === DEFAULT_SITE) return path
  return `${path}?site=${site}`
}
```

- [ ] **Step 2: ArchivePage 适配**

修改 `apps/web/src/pages/ArchivePage.tsx`，按下列 diff 逐块进行（行号为当前文件）：

1. 顶部 import（`:1-2`）：`Navigate` 删除；`:26` 改为：

```ts
import {
  api,
  bookPath,
  parsePage,
  parseQuery,
  readPath,
  routes,
  siteUrl,
  type SiteId,
} from "@/lib/routes"
```

2. `parseSort`（`:44-47`）改为按站解析，书库默认 archived_at：

```ts
function parseSort(raw: string | null, site: SiteId): SortKey {
  if (raw === "title" || raw === "archived_at") return raw
  // 书库 tid 是 base64 cid（CAST(tid AS INTEGER) 恒 0），按 tid 排序无意义
  return site === "2" ? "archived_at" : "tid"
}
```

3. 组件体内（`:50-56`）：`const site = useSite()` 之后加：

```ts
  const isBooks = site === "2"
  const defaultSort: SortKey = isBooks ? "archived_at" : "tid"
  const sort = parseSort(searchParams.get("sort"), site)
```

4. `reload`（`:70-101`）：`params.set("site", site)` + 书库 order=asc，并补依赖：

```ts
      const params = new URLSearchParams()
      params.set("sort", sort)
      params.set("page", String(page))
      // 评审问题 2：不带 site 会拉到默认站（1）的数据
      params.set("site", site)
      if (q) params.set("q", q)
      // 评审问题 4：书库 archived_at 默认 desc（最旧在前），要最新收录在前必须显式 asc
      if (isBooks && sort === "archived_at") params.set("order", "asc")
```

   末尾 `}, [sort, page, q])` → `}, [sort, page, q, site, isBooks])`。

5. `update`（`:109-128`）默认排序按站：

```ts
    if (next.sort !== undefined) {
      if (next.sort === defaultSort) params.delete("sort")
      else params.set("sort", next.sort)
    }
```

6. `grouped`（`:138-147`）书库不做标题分组（评审问题 8：书库每条本身是一本书，同名不同 cid 会误折叠）：

```ts
  const { isExpanded, toggle } = useExpandedBooks("archive")
  const grouped = useMemo(() => {
    if (isBooks) return null
    return groupBooks(
      items,
      (it) => it.title,
      (it) => it.tid
    )
  }, [items, isBooks])
```

7. 删除 site 重定向（`:149-152`）：

```ts
  // 全站目录仅论坛；带 ?site=2 时清回默认站
  if (site !== "1") {
    return <Navigate to={routes.archive} replace />
  }
```

8. 条目链接分流（评审问题 3：书库 cid 走 `/read/:tid` 会 404）。在 `return` 前加：

```ts
  function itemHref(it: ArchivePost): string {
    return it.site === "2"
      ? bookPath(it.tid, { site: it.site })
      : readPath(it.tid, it.site)
  }
```

9. 头部描述与「更新目录」链接（`:156-167`）：

```tsx
      <PageHeader
        title="目录"
        description={
          isBooks ? "本地全站书库目录（由任务同步）" : "本地全站主帖目录（由任务同步）"
        }
        action={
          <Link
            to={siteUrl(routes.jobs, site)}
            className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            更新目录
          </Link>
        }
      />
      <PageSiteTabs sites={["1", "2"]} />
```

10. 排序选项（`:38-42` 的 `SORT_OPTIONS` 保持不变），组件内加（放 `defaultSort` 附近）：

```ts
  const sortOptions = useMemo(() => {
    if (!isBooks) return SORT_OPTIONS
    return SORT_OPTIONS.filter((o) => o.value !== "tid").map((o) =>
      o.value === "archived_at"
        ? { ...o, title: "最新收录在前（第 1 页先入库）" }
        : o
    )
  }, [isBooks])
```

   `FilterTabs`（`:178-183`）的 `options={SORT_OPTIONS}` → `options={sortOptions}`。

11. 空态文案（`:202-219`）按站区分：

```tsx
        emptyText={
          <>
            {q ? (
              "没有匹配的归档"
            ) : (
              <>
                还没有归档，去
                <Link
                  to={siteUrl(routes.jobs, site)}
                  className="text-foreground underline underline-offset-2"
                >
                  任务
                </Link>
                {isBooks ? "开始一次全站书库归档" : "开始一次全站主帖归档"}
              </>
            )}
          </>
        }
```

12. 列表渲染（`:221-275`）：`grouped.map` 改为按 `grouped` 是否为空分流，两处 `readPath(g.item.tid, g.item.site)` / `readPath(it.tid, it.site)` 换成 `itemHref(...)`，书库行不显示 `#cid` 尾巴：

```tsx
        <PostList>
          {grouped
            ? grouped.map((g) =>
                g.type === "single" ? (
                  <ListPostCard
                    key={`${g.item.site}:${g.item.tid}`}
                    href={itemHref(g.item)}
                    rawTitle={g.item.title}
                    trailing={
                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                        #{g.item.tid}
                      </span>
                    }
                  />
                ) : (
                  <CollapsibleBookGroup
                    key={`group:${g.key}`}
                    title={g.title}
                    summary={
                      [g.author, g.genre].filter(Boolean).join(" · ") || undefined
                    }
                    count={g.items.length}
                    bookKey={g.key}
                    isExpanded={isExpanded(g.key)}
                    onToggle={() => toggle(g.key)}
                    trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                  >
                    {g.items.map((it) => {
                      const parsed = parseListTitle(it.title)
                      const sub = formatTitleMeta(
                        parsed.chapters ? { ...parsed, chapters: null } : parsed
                      )
                      return (
                        <Link
                          key={`${it.site}:${it.tid}`}
                          to={itemHref(it)}
                          className="flex min-h-11 items-center gap-2 border-t border-border/50 px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/40 sm:px-4"
                        >
                          <span className="min-w-0 flex-1 line-clamp-2 font-medium text-foreground">
                            {parsed.chapters || parsed.title}
                          </span>
                          {sub && (
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                              {sub}
                            </span>
                          )}
                          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
                            #{it.tid}
                          </span>
                        </Link>
                      )
                    })}
                  </CollapsibleBookGroup>
                )
              )
            : items.map((it) => (
                <ListPostCard
                  key={`${it.site}:${it.tid}`}
                  href={itemHref(it)}
                  rawTitle={it.title}
                />
              ))}
        </PostList>
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `bun run typecheck && bun run build:web`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/routes.ts apps/web/src/pages/ArchivePage.tsx
git commit -m "feat(web): open archive page to book site with book-specific sorting"
```

---

### Task 3: SectionTabs 站点适配（书库站无「分组」Tab）

**Files:**
- Modify: `apps/web/src/lib/routes.ts`（`ALL_TABS`）
- Modify: `apps/web/src/lib/hub-tabs.ts`

**Interfaces:**
- Consumes: `siteUrl(path, site)`（Task 2 产出）；`useSite()`；`ALL_TABS`；`SectionTab`。
- Produces: `useAllTabs(activePath)` 按当前站过滤并给 `to` 拼 site 参数；书库站只显示「目录」，论坛站显示「目录 / 分组」。

- [ ] **Step 1: routes.ts 扩 `ALL_TABS`**

`:74-82`：

```ts
/** 目录页栏目（归档整理视图；书库站无分组） */
export const ALL_TABS: {
  href: string
  label: string
  sites: readonly SiteId[]
}[] = [
  { href: routes.archive, label: "目录", sites: ["1", "2"] },
  { href: routes.groups, label: "分组", sites: ["1"] },
]
```

- [ ] **Step 2: hub-tabs.ts 按站过滤 + 带 site**

`:1-11` import 改为（`DEFAULT_SITE` 不再使用）：

```ts
import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import {
  ALL_TABS,
  DISCOVER_TABS,
  ME_TABS,
  siteUrl,
  type SiteId,
} from "@/lib/routes"
import type { SectionTab } from "@/components/section-tabs"
```

删除本地 `withSite`（`:13-18`），`useDiscoverTabs` / `useMeTabs` 内 `withSite(t.href, site)` 两处改为 `siteUrl(t.href, site)`。`useAllTabs`（`:48-59`）改为：

```ts
/** 目录（归档/分组）：按站过滤；书库站无分组，只显示「目录」 */
export function useAllTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(
    () =>
      ALL_TABS.filter((t) => (t.sites as readonly SiteId[]).includes(site)).map(
        (t) => ({
          // 评审问题 5：不带 site 时书库站点 Tab 会丢参数
          to: siteUrl(t.href, site),
          label: t.label,
          active: activePath === t.href,
        })
      ),
    [site, activePath]
  )
}
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `bun run typecheck && bun run build:web`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/routes.ts apps/web/src/lib/hub-tabs.ts
git commit -m "feat(web): filter archive section tabs by site (no groups on book site)"
```

---

### Task 4: JobsPage / JobRow / JOB_TYPE_LABEL 适配书库

**Files:**
- Modify: `apps/web/src/lib/jobs.ts`（`JOB_TYPE_LABEL`）
- Modify: `apps/web/src/components/job-row.tsx`
- Modify: `apps/web/src/pages/JobsPage.tsx`

**Interfaces:**
- Consumes: `startJob(type, payload)` / `getArchiveStatus(site)`（`lib/jobs.ts:98-156` 已有，site 参数已通用）；`siteUrl`（Task 2 产出）；`job.payload`（含 `site`，由 Task 1 handler 写入）。
- Produces: 书库站可访问任务页；「全量 / 继续 / 增量」按站切 job type（论坛 `archive_posts`+site=1，书库 `archive_books`+site=2）；自动分组按钮仅论坛显示；所有归档链接带 site。

- [ ] **Step 1: JOB_TYPE_LABEL 补新类型**

`apps/web/src/lib/jobs.ts:33-36`：

```ts
export const JOB_TYPE_LABEL: Record<string, string> = {
  archive_posts: "全站主帖归档",
  archive_books: "书库归档",
  archive_auto_group: "归档自动分组",
}
```

- [ ] **Step 2: JobRow 认识 archive_books**

`apps/web/src/components/job-row.tsx`：

- `:11` `import { routes } from "@/lib/routes"` → `import { routes, siteUrl } from "@/lib/routes"`
- `:39-41`：

```ts
  const isArchive =
    job.type === "archive_posts" || job.type === "archive_books"
  // 链接按任务 payload 的 site 落站（书库任务看书库归档）
  const archiveSite =
    typeof job.payload?.site === "string" ? job.payload.site : "1"
  const showArchiveLink =
    isArchive && (job.status === "succeeded" || job.status === "running")
```

- `:87` `to={routes.archive}` → `to={siteUrl(routes.archive, archiveSite)}`

- [ ] **Step 3: JobsPage 适配书库**

修改 `apps/web/src/pages/JobsPage.tsx`，按下列 diff 逐块进行（行号为当前文件）：

1. `:1-2` import：`Navigate` 删除。`:39` 改为 `import { api, parsePage, routes, siteUrl } from "@/lib/routes"`。
2. `:43-45` 状态派生：

```ts
export default function JobsPage() {
  const site = useSite()
  const confirm = useConfirm()
  const isBooks = site === "2"
  const archiveJobType = isBooks ? "archive_books" : "archive_posts"
```

   （删除 `const archiveSupported = site === "1"`。）
3. `reload`（`:73-95`）：

```ts
  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      setError("")
      try {
        const [data, st] = await Promise.all([
          listJobs({ page }),
          getArchiveStatus(site),
        ])
        setJobs(data.items)
        setNextPage(data.nextPage)
        setTotal(data.total)
        if (st) setStatus(st)
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [site, page]
  )
```

4. `onStart`（`:185-198`）：

```ts
  const onStart = async (mode: ArchiveMode) => {
    setBusy(true)
    setError("")
    try {
      requestNotify()
      await startJob(archiveJobType, { site, mode })
      if (page !== 1) update({ page: 1 })
      else await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }
```

5. 状态派生（`:279-299`）：

```ts
  const runningJob = jobs.find((j) => j.status === "running")
  const hasRunning = !!runningJob
  const lastSuccess = jobs.find((j) => j.status === "succeeded")
  const startDisabled = busy || hasRunning
  const canResume =
    !!status?.cursor?.next_mtid &&
    (status.cursor.status === "interrupted" || status.cursor.status === "running")
  const resumeEnabled =
    !startDisabled &&
    !!status?.cursor?.next_mtid &&
    status.cursor.status !== "done"
  const startHint = hasRunning
    ? "已有任务在运行"
    : busy
      ? "启动中…"
      : undefined
```

6. `cursorHint`（`:301-317`）：书库 maxTid 是随机 base64 cid，不展示：

```ts
  const cursorHint = status
    ? [
        `库内 ${status.total} 条`,
        status.maxTid && !isBooks ? `最新 tid ${status.maxTid}` : null,
        status.cursor
          ? `游标 ${status.cursor.status}${
              status.cursor.next_mtid
                ? ` @ ${status.cursor.next_mtid}`
                : status.cursor.status === "done"
                  ? "（已完成）"
                  : ""
            } · 已记 ${status.cursor.pages} 页`
          : "尚无续跑游标",
      ]
        .filter(Boolean)
        .join(" · ")
    : null
```

7. 删除 site 重定向（`:319-322`）。
8. 头部（`:326-353`）：`description={isBooks ? "同步书库目录与备份" : "同步目录、自动分组与备份"}`；「返回目录」`to={siteUrl(routes.archive, site)}`；`PageSiteTabs sites={["1", "2"]}`。
9. 运行中横幅（`:378-389`）「打开归档目录」链接：

```tsx
            <Link
              to={
                runningJob.type === "archive_auto_group"
                  ? routes.groups
                  : siteUrl(routes.archive, site)
              }
              className="underline underline-offset-2"
            >
```

10. 「最近一次归档成功」的「查看归档」（`:400`）：`to={siteUrl(routes.archive, site)}`。
11. `cursorHint` 渲染条件（`:407`）：`{cursorHint && archiveSupported && (` → `{cursorHint && (`。
12. 启动按钮（`:415-445`）：

- 全量按钮 title（`:419`）：`title={startHint ?? (isBooks ? "从第 1 页（最新收录）往后扫" : "从最新帖往回全量扫描")}`
- resume 按钮 title（`:428-431`）：书库站用页码口径（review.md M2）：
```tsx
            title={
              resumeEnabled
                ? isBooks
                  ? `从第 ${status?.cursor?.next_mtid} 页继续`
                  : `从游标 ${status?.cursor?.next_mtid} 继续`
                : "没有可续跑的游标（先跑全量或中断后再试）"
            }
```
- 增量按钮 title（`:441`）：`title={isBooks ? "只补比库内更新收录的书" : "只扫比库内最新 tid 还新的帖子"}`
- 自动分组按钮（`:446-454`）包一层 `{!isBooks && ( ... )}`。
- `onAutoGroup`（`:205`）payload 用闭包 `site` 而非字面量 `"1"`（书库站按钮已隐藏、运行时必为 `"1"`，纯防御，review.md M3）：`startJob("archive_auto_group", { site, minMembers: 2 })`

13. 删除「当前站点不支持归档」提示块（`:481-485`）；`:486` `startHint && archiveSupported && hasRunning` → `startHint && hasRunning`。
14. 空态文案（`:500-515`）按站区分：

```tsx
        emptyText={
          isBooks ? (
            <>
              暂无任务。可用「全量归档」从第 1 页（最新收录）往后扫，「增量更新」只补新书；中断后用「继续归档」。完成后可在
              <Link
                to={siteUrl(routes.archive, site)}
                className="text-foreground underline underline-offset-2"
              >
                归档
              </Link>
              浏览，或点「导出备份」下载本地数据。
            </>
          ) : (
            <>
              暂无任务。可用「全量归档」扫全站，「增量更新」只补新帖；中断后用「继续归档」。完成后可在
              <Link
                to={siteUrl(routes.archive, site)}
                className="text-foreground underline underline-offset-2"
              >
                归档
              </Link>
              浏览，或点「导出备份」下载本地数据。
            </>
          )
        }
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `bun run typecheck && bun run build:web`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/jobs.ts apps/web/src/components/job-row.tsx apps/web/src/pages/JobsPage.tsx
git commit -m "feat(web): adapt jobs page and job rows to book archive jobs"
```

---

### Task 5: 全量验证 + 浏览器清单

**Files:** 无（仅验证）。

**Interfaces:** 无。

- [ ] **Step 1: 全仓验证**

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Expected: 全过。测试含 Task 1 的 6 个新用例；构建产物含新前端。

- [ ] **Step 2: 浏览器检查（需上游可达；上游不可达时先配 `HTTPS_PROXY`）**

用 chrome-devtools 打开 `bun run dev`（Vite :3000，/api 代理 :3001），按 spec「验证」清单逐项核对：

1. 书库站（`/archive?site=2`）「目录」可进入：不重定向、显示书库列表（先 `POST /api/me/jobs` 启动 `archive_books` 全量或少量 maxPages 跑出数据）、无「分组」Tab（SectionTabs 只显示「目录」）。
2. site=2 列表项点击进 `/book/:cid`（URL 含 site=2），不是 `/read/:tid`。
3. site=2 默认排序为归档时间序（`archived_at` asc，最新收录在前）。
4. site=2 不显示「按 tid」排序选项。
5. 搜索 / 分页可用；任务页（`/jobs?site=2`）可启动书库归档，任务行显示「书库归档」，成功后「查看归档」落书库站。
6. 论坛站（site=1）行为不回归：目录分组、按 tid 排序、任务页「归档自动分组」按钮均正常。

- [ ] **Step 3: 收尾确认**

若浏览器检查发现问题，回到对应 Task 修复并重跑 Step 1 验证；全部通过后提交任何遗留改动。

---

## Self-Review（自审记录）

- **Spec 覆盖**：① archive_books job → Task 1；② 增量深度停止条件 → Task 1（修正为 `>`，见 Global Constraints 修正 1）；③ ArchivePage 解除限制 + site 传参 + 书库链接 /book/:cid + 排序 + 不分组 + 文案 → Task 2；④ ALL_TABS / useAllTabs 按站过滤 → Task 3；⑤ JobsPage 按站切 job type + 链接带 site + 空态 + cursorHint → Task 4；⑥ JOB_TYPE_LABEL / JobRow → Task 4；spec「测试」5 项 → Task 1 测试 1-5（另加 site 校验）；spec「验证」→ Task 5。
- **占位符扫描**：无 TBD/TODO；所有步骤含可执行代码与命令。
- **类型一致性**：`ArchiveMode`（handler 与 `lib/jobs.ts` 各自定义，形状一致）；`JobResult` 字段 `pages/inserted/updated/site/mode/stopReason/nextMtid` 与 `formatJobProgress`（`lib/jobs.ts:71-96`）读取的字段一致；`setArchiveCursor` patch 形参与 `store.ts:1040-1068` 一致；`siteUrl(path, site)` 在 Task 2 定义、Task 2/3/4 复用；`itemHref` 只在 ArchivePage 内部。
- **与 spec 的差异**（已显式写入 Global Constraints）：增量停止 `>` vs `>=`、停滞检测 `<=` vs `>=`、API 注册一行。均为代码验证后的必要修正。
- **评审修订（review.md，已并入对应任务）**：B1 — Task 1 测试 3 按方案 B 扩到 6 页（站点扩容），使 `incremental_caught_up` 分支被真实触发（原 5 页数据在 `>` 下只会走 `end`，断言必失败）；B2 — Task 1 测试 4 的 `inserted` 断言改 4（首轮 `maxPages=2` 只归档第 1、2 页，P3A 从未入库，第 3 页 P3A+P4A 全新补入；原断言 3 与数据自相矛盾）；M1 — handler resume 补 `cursor done` 分支（日志文案对齐 archive_posts.ts:56-58）；M2 — 书库站 resume 按钮 tooltip 用「从第 N 页继续」；M3 — `onAutoGroup` payload 改用闭包 `site`。M4（abort / maxPages+incremental / 空标题用例）按评审意见不补：handler 与 archive_posts 同构、共享 `sleep`/`upsertArchivePosts` 路径，既有测试已覆盖同构分支。
