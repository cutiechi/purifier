import { resolveSite } from "../../extractor"
import type { HomePage } from "../../extractor"
import type { Store } from "../../storage/store"
import { sleep } from "../sleep"
import { withRetry } from "../retry"
import type { JobContext, JobHandler, JobResult } from "../handler"

export type ArchiveMode = "full" | "resume" | "incremental"

export class ArchivePostsJob implements JobHandler {
  type = "archive_posts"

  /**
   * 测试 seam：默认走真实 extractor.fetchHomeLinks；测试可覆盖。
   * 生产代码用 this.run 里的实现，这里给个可覆盖的实例方法。
   */
  fetchPage = async (
    mtid: string,
    signal?: AbortSignal
  ): Promise<HomePage> => {
    const extractor = resolveSite("1")
    return extractor.fetchHomeLinks(mtid, signal)
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

    // 起始游标
    let mtid = "0"
    if (mode === "resume") {
      const cur = this.store.getArchiveCursor(site)
      if (cur?.next_mtid) {
        mtid = cur.next_mtid
        ctx.log("info", `resume from next_mtid=${mtid} (saved pages=${cur.pages})`)
      } else if (cur?.status === "done") {
        ctx.log("info", "cursor done; resume falls back to full from mtid=0")
        mtid = "0"
      } else {
        ctx.log("info", "no saved cursor; resume starts from mtid=0")
        mtid = "0"
      }
    } else if (
      typeof ctx.payload.fromMtid === "string" &&
      ctx.payload.fromMtid.trim()
    ) {
      mtid = ctx.payload.fromMtid.trim()
      ctx.log("info", `start from explicit fromMtid=${mtid}`)
    } else {
      mtid = "0"
    }

    // 增量：停在库内最大 tid 及更旧区域
    let stopAtOrBelow: number | null = null
    if (mode === "incremental") {
      const maxTid = this.store.getArchiveMaxTid(site)
      if (maxTid != null && Number.isFinite(Number(maxTid))) {
        stopAtOrBelow = Number(maxTid)
        ctx.log(
          "info",
          `incremental: stop when page tids all ≤ ${maxTid}`
        )
      } else {
        ctx.log(
          "info",
          "incremental: archive empty → behaves like full scan"
        )
      }
    }

    this.store.setArchiveCursor(site, {
      next_mtid: mtid === "0" ? "0" : mtid,
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

      // 增量：本页全部 tid ≤ 已知最大 → 已扫到已知区域，停
      if (stopAtOrBelow != null && clean.length > 0) {
        const allKnown = clean.every(
          (l) =>
            Number.isFinite(Number(l.tid)) && Number(l.tid) <= stopAtOrBelow!
        )
        if (allKnown) {
          // 仍 upsert 一次，刷新同 tid 标题变更
          const res = this.store.upsertArchivePosts(site, clean, this.now())
          inserted += res.inserted
          updated += res.updated
          ctx.log(
            "info",
            `page ${pages}: reached known territory (all tid ≤ ${stopAtOrBelow}), stop (${res.inserted} new, ${res.updated} updated)`
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
      }

      const res = this.store.upsertArchivePosts(site, clean, this.now())
      inserted += res.inserted
      updated += res.updated
      ctx.log(
        "info",
        `page ${pages}: +${page.links.length} fetched (${res.inserted} new, ${res.updated} updated${dropped ? `, ${dropped} empty dropped` : ""}), nextMtid=${page.nextMtid}`
      )

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
      // 仅当游标未推进时停（防卡死）；首页 mtid="0" 不当上界；数值比较
      if (mtid !== "0" && Number(page.nextMtid) >= Number(mtid)) {
        ctx.log(
          "info",
          `reached end (cursor not advancing: ${page.nextMtid} >= ${mtid})`
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
        // keep actual mode (not force full) so status display stays correct
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
      throw new Error(`archive stopped on page error: ${lastError}`)
    }
    return result
  }
}

function parseMode(raw: unknown): ArchiveMode {
  if (raw === "resume" || raw === "incremental" || raw === "full") return raw
  return "full"
}
