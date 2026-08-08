import type { Store } from "../../storage/store"
import { parseListTitle } from "../../title-parse"
import type { JobContext, JobHandler, JobResult } from "../handler"

/** 与 web book-groups 同源：剥尾随章节标记后再做 key */
function stripTrailingChapterMarker(title: string): string {
  return title.replace(/(?:[（(][^）)]{1,24}[）)]\s*)+$/, "")
}

function normalizeTitleKey(title: string): string {
  return stripTrailingChapterMarker(
    title.replace(/^[《【［[]+|[》】］\]]+$/g, "")
  )
    .trim()
    .toLowerCase()
}

/**
 * 从归档目录按书名自动 upsert 分组（≥ minMembers 章才建组）。
 * 与前端折叠分组 / groups key 规则一致。
 */
export class ArchiveAutoGroupJob implements JobHandler {
  type = "archive_auto_group"

  constructor(private store: Store) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const site = String(ctx.payload.site ?? "1")
    if (site !== "1") {
      throw new Error("auto group only supports forum archive (site=1)")
    }
    const rawMin = Number(ctx.payload.minMembers)
    const minMembers =
      Number.isFinite(rawMin) && rawMin >= 2 && rawMin <= 50
        ? Math.floor(rawMin)
        : 2

    const posts = this.store.listAllArchivePosts(site)
    ctx.log("info", `scanned ${posts.length} archive posts (minMembers=${minMembers})`)

    type Bucket = {
      key: string
      title: string
      author: string | null
      genre: string | null
      items: Array<{ tid: string; title: string }>
      seen: Set<string>
    }
    const buckets = new Map<string, Bucket>()

    let scanned = 0
    for (const p of posts) {
      scanned++
      // 分桶阶段也可中止，避免大库扫完才响应 stop
      if (scanned % 500 === 0 && ctx.signal.aborted) {
        ctx.log("warn", "aborted during bucket scan")
        break
      }
      const parsed = parseListTitle(p.title)
      const key = normalizeTitleKey(parsed.title)
      if (!key) continue
      let b = buckets.get(key)
      if (!b) {
        b = {
          key,
          title: stripTrailingChapterMarker(parsed.title || p.title).trim() || key,
          author: parsed.author,
          genre: parsed.genre,
          items: [],
          seen: new Set(),
        }
        buckets.set(key, b)
      } else {
        if (!b.author && parsed.author) b.author = parsed.author
        if (!b.genre && parsed.genre) b.genre = parsed.genre
      }
      // 同 tid 去重（保留先出现的 title）
      if (!b.seen.has(p.tid)) {
        b.seen.add(p.tid)
        b.items.push({ tid: p.tid, title: p.title })
      }
    }

    let groupsUpserted = 0
    let membersLinked = 0
    let skippedSingles = 0
    let i = 0
    const eligible = [...buckets.values()].filter(
      (b) => b.items.length >= minMembers
    )
    skippedSingles = buckets.size - eligible.length

    for (const b of eligible) {
      if (ctx.signal.aborted) {
        ctx.log("warn", "aborted by user")
        break
      }
      b.items.sort((a, c) => Number(a.tid) - Number(c.tid))
      this.store.upsertGroup({
        key: b.key,
        title: b.title,
        items: b.items,
        author: b.author,
        genre: b.genre,
      })
      groupsUpserted++
      membersLinked += b.items.length
      i++
      if (i % 25 === 0 || i === eligible.length) {
        ctx.log(
          "info",
          `grouped ${i}/${eligible.length} (members=${membersLinked})`
        )
        ctx.reportProgress({
          scanned: posts.length,
          groupsUpserted,
          membersLinked,
          skippedSingles,
          site,
        })
      }
    }

    const result: JobResult = {
      scanned: posts.length,
      buckets: buckets.size,
      groupsUpserted,
      membersLinked,
      skippedSingles,
      minMembers,
      site,
      aborted: ctx.signal.aborted,
    }
    ctx.log(
      "info",
      `done: upserted ${groupsUpserted} groups, ${membersLinked} members, skipped ${skippedSingles} singles`
    )
    return result
  }
}
