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
