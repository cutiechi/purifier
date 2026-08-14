import { resolveSite } from "../../extractor"
import type { HomePage } from "../../extractor"
import type { Store } from "../../storage/store"
import { sleep } from "../sleep"
import { withRetry } from "../retry"
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
      await ctx.checkpoint()
      if (ctx.signal.aborted) break
      let page: HomePage
      try {
        // 网络抖动重试（指数退避 + jitter），避免单次失败就整轮作废
        page = await withRetry(() => this.fetchPage(mtid, ctx.signal), {
          attempts: 3,
          baseDelayMs: 500,
          signal: ctx.signal,
          onRetry: (attempt, errMsg) =>
            ctx.log(
              "warn",
              `page ${pages + 1} attempt ${attempt} failed: ${errMsg}; retrying`
            ),
        })
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
      // 固定延迟加 jitter：避免多实例/重跑形成确定性敲击模式
      await sleep(delayMs + Math.floor(Math.random() * 300), ctx.signal)
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
