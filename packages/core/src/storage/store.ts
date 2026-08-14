import { Database, type SQLQueryBindings } from "bun:sqlite"
import type { SiteId } from "../extractor"
import { ExtractorError } from "../extractor/types"
import { isHue, pickHue } from "../character-highlight"
import {
  BOOKMARKS_PER_SCOPE_CAP,
  normalizeBookmarkNote,
  normalizeBookmarkQuote,
} from "../bookmarks"
import {
  AddBookmarkResult,
  ArchiveCursor,
  ArchiveCursorStatus,
  ArchivePost,
  Bookmark,
  CharacterCluster,
  CharacterScope,
  Group,
  GroupMember,
  ItemKind,
  ItemState,
  Job,
  JobLog,
  JobLogLevel,
  JobSortKey,
  JobStatus,
  ListItem,
  ListQuery,
  ListResult,
  ReadingSessionInput,
  StatsCalendarDay,
  StatsInventory,
  StatsRecentSession,
  StatsResult,
  StatsSummary,
  StatsTopItem,
  TagCount,
  PAGE_SIZE,
} from "./types"

interface RawItemRow {
  site: string
  kind: string
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: number
  read_progress?: number | null
  last_chapter?: number | null
}

/** bookmarks × items 联表行（mapBookmark 的输入） */
interface BookmarkRow {
  id: number
  site: string
  kind: string
  item_id: string
  title: string
  chapter: number | null
  quote: string
  note: string
  scroll_progress: number
  created_at: number
}

/** trim → 折叠连续空白 → 按码点截断 24 字符 → 空返回 null */
export function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/\s+/g, " ")
  const truncated = Array.from(cleaned).slice(0, 24).join("")
  return truncated.length === 0 ? null : truncated
}

/** 逐条 normalize + 去重，保持输入顺序 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/** 本地日期串 YYYY-MM-DD（按服务端本地 TZ） */
export function localDateStr(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD 的前一天 */
export function dayBefore(dateStr: string): string {
  const [y = 0, m = 1, d = 1] = dateStr.split("-").map(Number)
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
  let cur = set.has(today)
    ? today
    : set.has(dayBefore(today))
      ? dayBefore(today)
      : null
  while (cur !== null && set.has(cur)) {
    current++
    cur = dayBefore(cur)
  }
  return { currentStreak: current, longestStreak: longest }
}

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

export class Store {
  constructor(
    private db: Database,
    /** 注入时钟便于测试排序；默认真实时间 */
    private now: () => number = Date.now
  ) {}

  /**
   * 成功访问（含 cache hit）：upsert items，url/last_visited_at 覆盖，visit_count+1，first_seen_at 保留。
   * title 为 undefined（章节页无书名）时绑 SQL NULL：新行由 COALESCE(?4,?5) 用 url 兜底，
   * 已存在行由 COALESCE(?4, items.title) 保留旧 title。
   */
  recordVisit(
    site: SiteId,
    kind: ItemKind,
    id: string,
    title: string | undefined,
    url: string
  ): void {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO items (site, kind, id, title, url, first_seen_at, last_visited_at, visit_count)
         VALUES (?1, ?2, ?3, COALESCE(?4, ?5), ?5, ?6, ?6, 1)
         ON CONFLICT(site, kind, id) DO UPDATE SET
           title = COALESCE(?4, items.title),
           url = excluded.url,
           last_visited_at = excluded.last_visited_at,
           visit_count = visit_count + 1`
      )
      // title === undefined → 绑 null（SQL NULL）；新行由 COALESCE(?4,?5) 用 url 兜底
      .run(site, kind, id, title ?? null, url, now)
  }

  /** 写入阅读进度（clamp 到 0..1）；chapter 给定写 last_chapter；items 中不存在返回 false（API 层映射 404） */
  setProgress(
    site: SiteId,
    kind: ItemKind,
    id: string,
    progress: number,
    chapter?: number
  ): boolean {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .get(site, kind, id)
    if (!exists) return false
    const clamped = Math.max(0, Math.min(1, progress))
    if (chapter !== undefined) {
      this.db
        .query(
          "UPDATE items SET read_progress = ?4, last_chapter = ?5 WHERE site = ?1 AND kind = ?2 AND id = ?3"
        )
        .run(site, kind, id, clamped, chapter)
    } else {
      this.db
        .query(
          "UPDATE items SET read_progress = ?4 WHERE site = ?1 AND kind = ?2 AND id = ?3"
        )
        .run(site, kind, id, clamped)
    }
    return true
  }

  /** 单对象状态；items 中不存在返回 null */
  getState(site: SiteId, kind: ItemKind, id: string): ItemState | null {
    const row = this.db
      .query(
        `SELECT title, url, first_seen_at, last_visited_at, visit_count, read_progress, last_chapter
         FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3`
      )
      .get(site, kind, id) as {
      title: string
      url: string
      first_seen_at: number
      last_visited_at: number
      visit_count: number
      read_progress: number | null
      last_chapter: number | null
    } | null
    if (!row) return null
    const fav = this.db
      .query(
        "SELECT 1 FROM favorites WHERE site = ?1 AND kind = ?2 AND id = ?3"
      )
      .get(site, kind, id)
    const tagRows = this.db
      .query(
        "SELECT tag FROM tags WHERE site = ?1 AND kind = ?2 AND id = ?3 ORDER BY created_at, rowid"
      )
      .all(site, kind, id) as { tag: string }[]
    return {
      site,
      kind,
      id,
      title: row.title,
      url: row.url,
      first_seen_at: row.first_seen_at,
      last_visited_at: row.last_visited_at,
      visit_count: row.visit_count,
      favorited: !!fav,
      tags: tagRows.map((r) => r.tag),
      read_progress: row.read_progress,
      lastChapter: row.last_chapter,
    }
  }

  /** 记录一段真实阅读：durationS<3 丢弃（去噪），>300 clamp 到 300（防脏数据）。 */
  recordSession(input: ReadingSessionInput): void {
    if (input.durationS < 3) return
    const durationS = Math.min(input.durationS, 300)
    this.db
      .query(
        `INSERT INTO reading_sessions (site, kind, item_id, title, started_at, duration_s, estimated)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)`
      )
      .run(
        input.site,
        input.kind,
        input.itemId,
        input.title,
        input.startedAt,
        durationS
      )
  }

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
    const runScoped = <T>(sql: string, extra: SQLQueryBindings[] = []): T[] =>
      this.db.query(sql).all(...(site ? [site] : []), ...extra) as T[]

    // 日历窗对齐本地日边界（热力图按本地日渲染 365 格）：窗起点 = 今日本地零点 − 364 天
    const nowLocal = new Date(this.now())
    const todayMid = new Date(
      nowLocal.getFullYear(),
      nowLocal.getMonth(),
      nowLocal.getDate()
    )
    const sinceStart = new Date(todayMid)
    sinceStart.setDate(sinceStart.getDate() - 364)
    const sinceMs = sinceStart.getTime()

    // calendar（近 365 天）
    const calRows = runScoped<{
      d: string
      s: number
      est: number
    }>(
      `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS d,
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
      `SELECT strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS h,
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

    const sumDuration = (
      cond: string,
      extra: SQLQueryBindings[] = []
    ): number =>
      (
        runScoped<{ t: number }>(
          `SELECT COALESCE(SUM(duration_s), 0) AS t FROM reading_sessions ${scoped(cond)}`,
          extra
        )[0] ?? { t: 0 }
      ).t

    const totalDurationS = sumDuration("duration_s IS NOT NULL")
    const range = runScoped<{ mn: number | null; mx: number | null }>(
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
    const monthStartMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).getTime()
    const thisWeekS = sumDuration(
      "duration_s IS NOT NULL AND started_at >= ?",
      [weekStartMs]
    )
    const thisMonthS = sumDuration(
      "duration_s IS NOT NULL AND started_at >= ?",
      [monthStartMs]
    )

    // 活跃日集合（真实+回填）→ streak / activeDays
    const dayRows = runScoped<{ d: string }>(
      `SELECT DISTINCT date(started_at / 1000, 'unixepoch', 'localtime') AS d
       FROM reading_sessions ${scoped("")}`
    )
    const dates = dayRows.map((r) => r.d)
    const { currentStreak, longestStreak } = computeStreaks(
      dates,
      localDateStr(this.now())
    )

    // inventory：items/favorites/tags/bookmarks 按 site；groups/character_names 无 site 列 → 全局
    const countSite = (table: string): number =>
      site
        ? (
            this.db
              .query(`SELECT COUNT(*) AS n FROM ${table} WHERE site = ?`)
              .get(site) as {
              n: number
            }
          ).n
        : (
            this.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
              n: number
            }
          ).n
    const inventory: StatsInventory = {
      history: countSite("items"),
      favorites: countSite("favorites"),
      tags: site
        ? (
            this.db
              .query(
                "SELECT COUNT(*) AS n FROM (SELECT DISTINCT tag FROM tags WHERE site = ?)"
              )
              .get(site) as { n: number }
          ).n
        : (
            this.db
              .query(
                "SELECT COUNT(*) AS n FROM (SELECT DISTINCT tag FROM tags)"
              )
              .get() as {
              n: number
            }
          ).n,
      groups: (
        this.db.query("SELECT COUNT(*) AS n FROM groups").get() as { n: number }
      ).n,
      characters: (
        this.db.query("SELECT COUNT(*) AS n FROM character_names").get() as {
          n: number
        }
      ).n,
      bookmarks: countSite("bookmarks"),
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

  /** 收藏；对象必须已存在于 items，否则返回 false（API 层映射 404） */
  addFavorite(site: SiteId, kind: ItemKind, id: string): boolean {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .get(site, kind, id)
    if (!exists) return false
    this.db
      .query(
        "INSERT OR IGNORE INTO favorites (site, kind, id, favorited_at) VALUES (?1, ?2, ?3, ?4)"
      )
      .run(site, kind, id, this.now())
    return true
  }

  removeFavorite(site: SiteId, kind: ItemKind, id: string): void {
    this.db
      .query("DELETE FROM favorites WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .run(site, kind, id)
  }

  /**
   * 删除历史条目：连同 favorites / tags 一并清理。
   * 返回是否曾存在于 items（不存在也幂等成功）。
   */
  deleteItem(site: SiteId, kind: ItemKind, id: string): boolean {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .get(site, kind, id)
    if (!exists) return false
    const run = this.db.transaction(() => {
      this.purgeItem(site, kind, id)
    })
    run()
    return true
  }

  /** 批量删除历史；每条带自己的 site（跨站"清空本页"会混 site）；返回实际删除的 items 行数 */
  deleteItems(
    pairs: Array<{ site: SiteId; kind: ItemKind; id: string }>
  ): number {
    let removed = 0
    const run = this.db.transaction(() => {
      for (const { site, kind, id } of pairs) {
        const exists = this.db
          .query(
            "SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3"
          )
          .get(site, kind, id)
        if (!exists) continue
        this.purgeItem(site, kind, id)
        removed++
      }
    })
    run()
    return removed
  }

  /** 在事务内删除单条 items + favorites + tags + bookmarks（不另开事务） */
  private purgeItem(site: SiteId, kind: ItemKind, id: string): void {
    this.db
      .query(
        "DELETE FROM bookmarks WHERE site = ?1 AND kind = ?2 AND item_id = ?3"
      )
      .run(site, kind, id)
    this.db
      .query("DELETE FROM tags WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .run(site, kind, id)
    this.db
      .query("DELETE FROM favorites WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .run(site, kind, id)
    this.db
      .query("DELETE FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .run(site, kind, id)
  }

  /** 清空历史（items + favorites + tags + bookmarks）；site 省略跨站全清；返回删除的 items 数 */
  clearHistory(site?: SiteId): number {
    // 计数与删除同事务：避免 count-then-delete 之间并发写入导致返回值失真
    return this.db.transaction(() => {
      const row = this.db
        .query("SELECT COUNT(*) AS n FROM items WHERE ?1 IS NULL OR site = ?1")
        .get(site ?? null) as { n: number }
      this.db
        .query("DELETE FROM bookmarks WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      this.db
        .query("DELETE FROM tags WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      this.db
        .query("DELETE FROM favorites WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      this.db
        .query("DELETE FROM items WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      return Number(row.n ?? 0)
    })()
  }

  /** 书签；items 中不存在返回 not_found；quote 规范化后为空返回 invalid_quote；超出上限返回 full */
  addBookmark(input: {
    site: SiteId
    kind: ItemKind
    id: string
    quote: string
    note?: string
    chapter?: number | null
    scrollProgress: number
  }): AddBookmarkResult {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .get(input.site, input.kind, input.id)
    if (!exists) return { ok: false, reason: "not_found" }
    const quote = normalizeBookmarkQuote(input.quote)
    if (quote === null) return { ok: false, reason: "invalid_quote" }
    const chapter = input.chapter ?? null
    const count = this.db
      .query(
        "SELECT COUNT(*) AS n FROM bookmarks WHERE site = ?1 AND kind = ?2 AND item_id = ?3 AND chapter IS ?4"
      )
      .get(input.site, input.kind, input.id, chapter) as { n: number }
    if (Number(count.n) >= BOOKMARKS_PER_SCOPE_CAP)
      return { ok: false, reason: "full" }
    const res = this.db
      .query(
        `INSERT INTO bookmarks (site, kind, item_id, chapter, quote, note, scroll_progress, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .run(
        input.site,
        input.kind,
        input.id,
        chapter,
        quote,
        normalizeBookmarkNote(input.note ?? ""),
        Math.max(0, Math.min(1, input.scrollProgress)),
        this.now()
      )
    return { ok: true, bookmark: this.getBookmark(Number(res.lastInsertRowid))! }
  }

  /** 单篇/单章书签列表，最近收藏在前；chapter 默认 null（帖与整本 book） */
  listItemBookmarks(
    site: SiteId,
    kind: ItemKind,
    id: string,
    chapter?: number | null
  ): Bookmark[] {
    const rows = this.db
      .query(
        `${this.bookmarkSelectSql()}
         WHERE b.site = ?1 AND b.kind = ?2 AND b.item_id = ?3 AND b.chapter IS ?4
         ORDER BY b.created_at DESC`
      )
      .all(site, kind, id, chapter ?? null) as BookmarkRow[]
    return rows.map((r) => this.mapBookmark(r))
  }

  /** 跨站书签列表；q 匹配 quote / note / 标题（NOCASE），kind 可选；每页 PAGE_SIZE */
  listBookmarks(query: {
    q?: string
    kind?: string
    page?: number
  }): { items: Bookmark[]; nextPage: number | undefined; total: number } {
    const q = query.q ?? ""
    const kind = query.kind || null
    const page = Math.max(1, query.page ?? 1)
    const where = `WHERE (?1 = '' OR b.quote LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR b.note LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE)
         AND (?2 IS NULL OR b.kind = ?2)`
    const totalRow = this.db
      .query(
        `SELECT COUNT(*) AS n FROM bookmarks b
         JOIN items i ON i.site = b.site AND i.kind = b.kind AND b.item_id = i.id
         ${where}`
      )
      .get(q, kind) as { n: number }
    const total = Number(totalRow?.n ?? 0)
    const rows = this.db
      .query(
        `${this.bookmarkSelectSql()}
         ${where}
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT ?3 OFFSET ?4`
      )
      .all(q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE) as BookmarkRow[]
    const items = rows.map((r) => this.mapBookmark(r))
    const hasMore = items.length > PAGE_SIZE
    return {
      items: hasMore ? items.slice(0, PAGE_SIZE) : items,
      nextPage: hasMore ? page + 1 : undefined,
      total,
    }
  }

  /** 改写书签备注（规范化后落库）；不存在返回 false */
  updateBookmarkNote(id: number, note: string): boolean {
    const res = this.db
      .query("UPDATE bookmarks SET note = ?2 WHERE id = ?1")
      .run(id, normalizeBookmarkNote(note))
    return Number(res.changes) > 0
  }

  /** 删除书签；不存在返回 false */
  deleteBookmark(id: number): boolean {
    const res = this.db.query("DELETE FROM bookmarks WHERE id = ?1").run(id)
    return Number(res.changes) > 0
  }

  /** bookmarks × items 联表公共 SELECT（行交给 mapBookmark） */
  private bookmarkSelectSql(): string {
    return `SELECT b.id, b.site, b.kind, b.item_id, i.title, b.chapter, b.quote, b.note,
                   b.scroll_progress, b.created_at
            FROM bookmarks b
            JOIN items i ON i.site = b.site AND i.kind = b.kind AND b.item_id = i.id`
  }

  private getBookmark(id: number): Bookmark | null {
    const row = this.db
      .query(`${this.bookmarkSelectSql()} WHERE b.id = ?1`)
      .get(id) as BookmarkRow | null
    return row ? this.mapBookmark(row) : null
  }

  private mapBookmark(row: BookmarkRow): Bookmark {
    return {
      id: row.id,
      site: row.site,
      kind: row.kind as ItemKind,
      itemId: row.item_id,
      title: row.title,
      chapter: row.chapter,
      quote: row.quote,
      note: row.note,
      scrollProgress: row.scroll_progress,
      createdAt: row.created_at,
    }
  }

  /** 整体替换标签；对象不存在返回 null（API 层映射 404）；返回实际落库的标签 */
  setTags(
    site: SiteId,
    kind: ItemKind,
    id: string,
    tags: string[]
  ): string[] | null {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE site = ?1 AND kind = ?2 AND id = ?3")
      .get(site, kind, id)
    if (!exists) return null
    const normalized = normalizeTags(tags)
    const created = this.now()
    const run = this.db.transaction(() => {
      this.db
        .query("DELETE FROM tags WHERE site = ?1 AND kind = ?2 AND id = ?3")
        .run(site, kind, id)
      const insert = this.db.query(
        "INSERT INTO tags (site, kind, id, tag, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      for (const tag of normalized) insert.run(site, kind, id, tag, created)
    })
    run()
    return normalized
  }

  /** 移除标签；site 省略全局删（跨站），传 site 只删该站；返回删除行数（标签不存在则为 0） */
  deleteTag(site: SiteId | undefined, tag: string): number {
    const normalized = normalizeTag(tag)
    if (!normalized) return 0
    const result =
      site === undefined
        ? this.db.query("DELETE FROM tags WHERE tag = ?1").run(normalized)
        : this.db
            .query("DELETE FROM tags WHERE site = ?1 AND tag = ?2")
            .run(site, normalized)
    return Number(result.changes ?? 0)
  }

  /** 历史：全量，最近访问倒序；q 匹配标题子串（NOCASE）或标签精确；kind/site 可筛选 */
  listHistory(query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const site = query.site ?? null
    const page = Math.max(1, query.page ?? 1)
    const where = `WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.site = i.site AND t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
         AND (?3 IS NULL OR i.site = ?3)`
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.site = i.site AND f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM items i
       ${where}
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?4 OFFSET ?5`,
      [q, kind, site, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
      page,
      `SELECT COUNT(*) AS n FROM items i ${where}`,
      [q, kind, site]
    )
  }

  /** 收藏列表：按收藏时间倒序，支持同样搜索 */
  // 排序：favorited_at DESC + f.rowid DESC 兜底 —— 生产同毫秒收藏时按插入顺序倒序，符合「后收藏在前」预期
  listFavorites(query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const site = query.site ?? null
    const page = Math.max(1, query.page ?? 1)
    const where = `WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.site = i.site AND t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
         AND (?3 IS NULL OR i.site = ?3)`
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter, f.favorited_at, 1 AS favorited
       FROM favorites f
       JOIN items i ON i.site = f.site AND i.kind = f.kind AND i.id = f.id
       ${where}
       ORDER BY f.favorited_at DESC, f.rowid DESC
       LIMIT ?4 OFFSET ?5`,
      [q, kind, site, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
      page,
      `SELECT COUNT(*) AS n FROM favorites f
       JOIN items i ON i.site = f.site AND i.kind = f.kind AND i.id = f.id
       ${where}`,
      [q, kind, site]
    )
  }

  /** 全部标签及计数：数量倒序，同数按字母序，无分页；site 省略跨站统计 */
  listTags(site?: SiteId): TagCount[] {
    const rows = (
      site === undefined
        ? this.db
            .query(
              "SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC"
            )
            .all()
        : this.db
            .query(
              "SELECT tag, COUNT(*) AS count FROM tags WHERE site = ?1 GROUP BY tag ORDER BY count DESC, tag ASC"
            )
            .all(site)
    ) as { tag: string; count: number }[]
    return rows.map((r) => ({ tag: r.tag, count: r.count }))
  }

  /** 按标签精确筛选对象；q/kind/site 在结果内继续过滤 */
  // 注意：GROUP BY i.site, i.kind, i.id 下 i.title/i.url/i.last_visited_at/i.visit_count 是 bare column；
  // 组内由 items 主键 (site,kind,id) 唯一确定，取任意行结果恒等，安全。不要「修复」成 GROUP BY 全列。
  listByTag(tag: string, query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const site = query.site ?? null
    const page = Math.max(1, query.page ?? 1)
    const where = `WHERE t.tag = ?1
         AND (?2 = '' OR i.title LIKE '%' || ?2 || '%' COLLATE NOCASE)
         AND (?3 IS NULL OR i.kind = ?3)
         AND (?4 IS NULL OR i.site = ?4)`
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.site = i.site AND f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM tags t
       JOIN items i ON i.site = t.site AND i.kind = t.kind AND i.id = t.id
       ${where}
       GROUP BY i.site, i.kind, i.id
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?5 OFFSET ?6`,
      [tag, q, kind, site, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
      page,
      `SELECT COUNT(*) AS n FROM (
         SELECT i.site, i.kind, i.id
         FROM tags t
         JOIN items i ON i.site = t.site AND i.kind = t.kind AND i.id = t.id
         ${where}
         GROUP BY i.site, i.kind, i.id
       )`,
      [tag, q, kind, site]
    )
  }

  private runList(
    sql: string,
    params: SQLQueryBindings[],
    page: number,
    countSql: string,
    countParams: SQLQueryBindings[]
  ): ListResult {
    const totalRow = this.db.query(countSql).get(...countParams) as {
      n: number
    }
    const total = Number(totalRow?.n ?? 0)
    const rows = this.db.query(sql).all(...params) as RawItemRow[]
    const items: ListItem[] = rows.map((r) => {
      const item: ListItem = {
        site: r.site,
        kind: r.kind as ItemKind,
        id: r.id,
        title: r.title,
        url: r.url,
        visit_count: r.visit_count,
        favorited: r.favorited === 1,
        read_progress: r.read_progress ?? null,
        lastChapter: r.last_chapter ?? null,
        tags: [],
      }
      if (r.last_visited_at != null) item.last_visited_at = r.last_visited_at
      if (r.favorited_at != null) item.favorited_at = r.favorited_at
      return item
    })
    const tagMap = this.tagsFor(
      items.map((i) => [i.site, i.kind, i.id] as [SiteId, ItemKind, string])
    )
    for (const item of items) {
      item.tags = tagMap.get(`${item.site}:${item.kind}:${item.id}`) ?? []
    }
    const hasMore = items.length > PAGE_SIZE
    return {
      items: hasMore ? items.slice(0, PAGE_SIZE) : items,
      nextPage: hasMore ? page + 1 : undefined,
      total,
    }
  }

  /** 一次 SQL 聚合整页 tags，避免 N+1 */
  // 已知：SQL 文本随页内容变化，bun:sqlite 的 prepared statement 缓存命中率为 0；
  // 单用户量级无害，接受即可，不必优化（历史增长后如需要可改 (site,kind,id) IN (VALUES ...)）。
  private tagsFor(
    triples: Array<[SiteId, ItemKind, string]>
  ): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (triples.length === 0) return map
    const clauses = triples
      .map(
        (_, i) =>
          `(site = ?${i * 3 + 1} AND kind = ?${i * 3 + 2} AND id = ?${i * 3 + 3})`
      )
      .join(" OR ")
    const params = triples.flat()
    const rows = this.db
      .query(
        `SELECT site, kind, id, tag FROM tags WHERE ${clauses} ORDER BY created_at, rowid`
      )
      .all(...params) as {
      site: string
      kind: ItemKind
      id: string
      tag: string
    }[]
    for (const r of rows) {
      const key = `${r.site}:${r.kind}:${r.id}`
      const arr = map.get(key)
      if (arr) arr.push(r.tag)
      else map.set(key, [r.tag])
    }
    return map
  }

  /**
   * 全量分组（导出 / 兼容旧调用）。量大时优先 listGroupsPage。
   */
  listGroups(q?: string): Group[] {
    return this.listGroupsPage({
      q,
      page: 1,
      limit: 100_000,
    }).items
  }

  /**
   * 分组分页列表：q 匹配 title/author/genre/成员标题；
   * sort=updated|title|chapters；favorited 只看已收藏。
   */
  listGroupsPage(opts: {
    q?: string
    page?: number
    limit?: number
    favorited?: boolean
    sort?: "updated" | "title" | "chapters"
  }): { items: Group[]; nextPage?: number; total: number } {
    const q = opts.q?.trim() ?? ""
    const page = Math.max(1, opts.page ?? 1)
    const limit = Math.min(100, Math.max(1, opts.limit ?? PAGE_SIZE))
    const sort = opts.sort ?? "updated"
    const favOnly = opts.favorited === true

    const where = `
      WHERE (?1 = '' OR
        g.title LIKE '%' || ?1 || '%' COLLATE NOCASE OR
        IFNULL(g.author,'') LIKE '%' || ?1 || '%' COLLATE NOCASE OR
        IFNULL(g.genre,'') LIKE '%' || ?1 || '%' COLLATE NOCASE OR
        EXISTS (
          SELECT 1 FROM group_items gi
          WHERE gi.group_id = g.id
            AND gi.title LIKE '%' || ?1 || '%' COLLATE NOCASE
        )
      )
      AND (?2 = 0 OR g.favorited = 1)`

    const orderSql =
      sort === "title"
        ? "g.title COLLATE NOCASE ASC, g.id ASC"
        : sort === "chapters"
          ? `(SELECT COUNT(*) FROM group_items gi2 WHERE gi2.group_id = g.id) DESC, g.updated_at DESC, g.id DESC`
          : // updated：收藏优先 + 最近更新
            "g.favorited DESC, g.updated_at DESC, g.id DESC"

    const totalRow = this.db
      .query(`SELECT COUNT(*) AS n FROM groups g ${where}`)
      .get(q, favOnly ? 1 : 0) as { n: number }
    const total = Number(totalRow.n ?? 0)

    const rows = this.db
      .query(
        `SELECT g.id, g.key, g.title, g.author, g.genre, g.favorited, g.favorited_at,
                g.created_at, g.updated_at
         FROM groups g
         ${where}
         ORDER BY ${orderSql}
         LIMIT ?3 OFFSET ?4`
      )
      .all(q, favOnly ? 1 : 0, limit + 1, (page - 1) * limit) as {
      id: number
      key: string
      title: string
      author: string | null
      genre: string | null
      favorited: number
      favorited_at: number | null
      created_at: number
      updated_at: number
    }[]

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const byGroup = this.membersForGroupIds(pageRows.map((r) => r.id))

    return {
      items: pageRows.map((r) => ({
        id: r.id,
        key: r.key,
        title: r.title,
        author: r.author,
        genre: r.genre,
        favorited: r.favorited === 1,
        favorited_at: r.favorited_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        items: byGroup.get(r.id) ?? [],
      })),
      nextPage: hasMore ? page + 1 : undefined,
      total,
    }
  }

  private membersForGroupIds(ids: number[]): Map<number, GroupMember[]> {
    const map = new Map<number, GroupMember[]>()
    if (ids.length === 0) return map
    const placeholders = ids.map(() => "?").join(",")
    const rows = this.db
      .query(
        `SELECT group_id, tid, title FROM group_items
         WHERE group_id IN (${placeholders})
         ORDER BY added_at, rowid`
      )
      .all(...ids) as { group_id: number; tid: string; title: string }[]
    for (const it of rows) {
      const arr = map.get(it.group_id)
      if (arr) arr.push({ tid: it.tid, title: it.title })
      else map.set(it.group_id, [{ tid: it.tid, title: it.title }])
    }
    return map
  }

  /** 单组查询（含成员），避免 upsert 后 listGroups 全表重建 */
  getGroup(id: number): Group | null {
    const r = this.db
      .query(
        `SELECT id, key, title, author, genre, favorited, favorited_at, created_at, updated_at
         FROM groups WHERE id = ?1`
      )
      .get(id) as {
      id: number
      key: string
      title: string
      author: string | null
      genre: string | null
      favorited: number
      favorited_at: number | null
      created_at: number
      updated_at: number
    } | null
    if (!r) return null
    const items = this.db
      .query(
        "SELECT tid, title FROM group_items WHERE group_id = ?1 ORDER BY added_at, rowid"
      )
      .all(id) as { tid: string; title: string }[]
    return {
      id: r.id,
      key: r.key,
      title: r.title,
      author: r.author,
      genre: r.genre,
      favorited: r.favorited === 1,
      favorited_at: r.favorited_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      items,
    }
  }

  upsertGroup(input: {
    key: string
    title: string
    items: GroupMember[]
    author?: string | null
    genre?: string | null
  }): Group {
    if (input.items.length === 0) {
      throw new Error("items must not be empty")
    }
    const now = this.now()
    const run = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO groups (key, title, author, genre, favorited, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
           ON CONFLICT(key) DO UPDATE SET
             title      = excluded.title,
             author     = COALESCE(groups.author, excluded.author),
             genre      = COALESCE(groups.genre,  excluded.genre),
             updated_at = excluded.updated_at`
        )
        .run(
          input.key,
          input.title,
          input.author ?? null,
          input.genre ?? null,
          now
        )
      // ON CONFLICT DO UPDATE 路径下 last_insert_rowid() 不可靠，统一按 key 回查
      const row = this.db
        .query("SELECT id FROM groups WHERE key = ?1")
        .get(input.key) as { id: number }
      // 一帖一组：tid 已属于其它组 → 409，抛错使整个事务回滚（同请求未冲突 tid 一并回滚）
      for (const it of input.items) {
        const other = this.db
          .query(
            `SELECT group_id FROM group_items
             WHERE tid = ?1 AND group_id <> ?2`
          )
          .get(it.tid, row.id) as { group_id: number } | null
        if (other) {
          throw new ExtractorError("tid already in another group", 409)
        }
      }
      const insert = this.db.query(
        "INSERT OR IGNORE INTO group_items (group_id, tid, title, added_at) VALUES (?1, ?2, ?3, ?4)"
      )
      for (const it of input.items) insert.run(row.id, it.tid, it.title, now)
      return row.id
    })
    const id = run()
    return this.getGroup(id)!
  }

  deleteGroup(id: number): void {
    const run = this.db.transaction(() => {
      this.deleteGroupCascade(id)
    })
    run()
  }

  removeGroupItems(
    id: number,
    tids: string[]
  ): { removed: number; deleted: boolean } {
    let removed = 0
    const run = this.db.transaction(() => {
      // 组不存在 → 不删任何东西，避免「COUNT=0 误判为空组自动删组」的假阳性
      const exists = this.db.query("SELECT 1 FROM groups WHERE id = ?1").get(id)
      if (!exists) return false
      const del = this.db.query(
        "DELETE FROM group_items WHERE group_id = ?1 AND tid = ?2"
      )
      for (const tid of tids) removed += Number(del.run(id, tid).changes ?? 0)
      const remaining = this.db
        .query("SELECT COUNT(*) AS n FROM group_items WHERE group_id = ?1")
        .get(id) as { n: number }
      if (Number(remaining.n ?? 0) === 0) {
        this.deleteGroupCascade(id)
        return true
      }
      this.db
        .query("UPDATE groups SET updated_at = ?2 WHERE id = ?1")
        .run(id, this.now())
      return false
    })
    // 注意：先执行事务再取 removed——对象字面量按源码顺序求值，
    // `{ removed, deleted: run() }` 会在 run() 修改 removed 之前就读取到 0
    const deleted = run()
    return { removed, deleted }
  }

  // --- Characters ---

  resolveCharacterScope(kind: ItemKind, id: string): CharacterScope {
    if (kind === "book") return { type: "book", id }
    const row = this.db
      .query("SELECT group_id FROM group_items WHERE tid = ?1 LIMIT 1")
      .get(id) as { group_id: number } | null
    if (row) return { type: "group", id: String(row.group_id) }
    return { type: "post", id }
  }

  pruneEmptyClusters(scope?: CharacterScope): void {
    if (scope) {
      this.db
        .query(
          `DELETE FROM character_clusters
         WHERE scope_type = ?1 AND scope_id = ?2
           AND id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
        )
        .run(scope.type, scope.id)
    } else {
      this.db.exec(
        `DELETE FROM character_clusters
         WHERE id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
      )
    }
  }

  listClusters(scope: CharacterScope): CharacterCluster[] {
    const rows = this.db
      .query(
        `SELECT c.id, c.hue, n.name
       FROM character_clusters c
       JOIN character_names n ON n.cluster_id = c.id
       WHERE c.scope_type = ?1 AND c.scope_id = ?2
       ORDER BY c.created_at, c.id, n.rowid`
      )
      .all(scope.type, scope.id) as { id: number; hue: number; name: string }[]
    const map = new Map<number, CharacterCluster>()
    const order: number[] = []
    for (const r of rows) {
      let c = map.get(r.id)
      if (!c) {
        c = { id: r.id, hue: r.hue, names: [] }
        map.set(r.id, c)
        order.push(r.id)
      }
      c.names.push(r.name)
    }
    return order.map((id) => map.get(id)!)
  }

  getCluster(scope: CharacterScope, clusterId: number): CharacterCluster {
    const all = this.listClusters(scope)
    const hit = all.find((c) => c.id === clusterId)
    if (!hit) throw new ExtractorError("cluster not found", 404)
    return hit
  }

  addCharacter(
    scope: CharacterScope,
    name: string,
    clusterId?: number
  ): CharacterCluster {
    const existing = this.db
      .query(
        `SELECT cluster_id FROM character_names
         WHERE scope_type = ?1 AND scope_id = ?2 AND name = ?3`
      )
      .get(scope.type, scope.id, name) as { cluster_id: number } | null
    if (existing) {
      if (clusterId === undefined || clusterId === existing.cluster_id) {
        return this.getCluster(scope, existing.cluster_id)
      }
      throw new ExtractorError("character belongs to another cluster", 409)
    }
    if (clusterId !== undefined) {
      this.getCluster(scope, clusterId)
      this.db
        .query(
          `INSERT INTO character_names
             (scope_type, scope_id, name, cluster_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`
        )
        .run(scope.type, scope.id, name, clusterId, this.now())
      return this.getCluster(scope, clusterId)
    }
    const used = this.listClusters(scope).map((c) => c.hue)
    const hue = pickHue(used)
    const inserted = this.db
      .query(
        `INSERT INTO character_clusters (scope_type, scope_id, hue, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .run(scope.type, scope.id, hue, this.now())
    const newId = Number(inserted.lastInsertRowid)
    this.db
      .query(
        `INSERT INTO character_names
           (scope_type, scope_id, name, cluster_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .run(scope.type, scope.id, name, newId, this.now())
    return this.getCluster(scope, newId)
  }

  removeCharacter(scope: CharacterScope, name: string): number {
    const changes = Number(
      this.db
        .query(
          `DELETE FROM character_names
           WHERE scope_type = ?1 AND scope_id = ?2 AND name = ?3`
        )
        .run(scope.type, scope.id, name).changes ?? 0
    )
    this.pruneEmptyClusters(scope)
    return changes
  }

  requireHue(hue: number): number {
    if (!isHue(hue)) throw new ExtractorError("invalid hue", 400)
    return hue
  }

  mergeClusters(
    scope: CharacterScope,
    clusterIds: number[],
    hue: number
  ): CharacterCluster[] {
    const h = this.requireHue(hue)
    const uniq = [...new Set(clusterIds)]
    if (uniq.length < 2) throw new ExtractorError("invalid clusterIds", 400)
    const clusters = uniq.map((id) => this.getCluster(scope, id))
    const targetId = Math.min(...clusters.map((c) => c.id))
    this.db.transaction(() => {
      for (const id of uniq) {
        if (id === targetId) continue
        this.db
          .query(
            `UPDATE character_names SET cluster_id = ?1
           WHERE cluster_id = ?2 AND scope_type = ?3 AND scope_id = ?4`
          )
          .run(targetId, id, scope.type, scope.id)
      }
      this.db
        .query(`UPDATE character_clusters SET hue = ?1 WHERE id = ?2`)
        .run(h, targetId)
      this.pruneEmptyClusters(scope)
    })()
    return this.listClusters(scope)
  }

  splitCharacter(
    scope: CharacterScope,
    clusterId: number,
    name: string
  ): CharacterCluster[] {
    const c = this.getCluster(scope, clusterId)
    if (!c.names.includes(name))
      throw new ExtractorError("cluster not found", 404)
    if (c.names.length < 2)
      throw new ExtractorError("cannot split singleton", 400)
    const hue = pickHue(this.listClusters(scope).map((x) => x.hue))
    this.db.transaction(() => {
      const r = this.db
        .query(
          `INSERT INTO character_clusters (scope_type, scope_id, hue, created_at)
         VALUES (?1, ?2, ?3, ?4)`
        )
        .run(scope.type, scope.id, hue, this.now())
      this.db
        .query(
          `UPDATE character_names SET cluster_id = ?1
         WHERE scope_type = ?2 AND scope_id = ?3 AND name = ?4`
        )
        .run(Number(r.lastInsertRowid), scope.type, scope.id, name)
    })()
    return this.listClusters(scope)
  }

  recolorCluster(
    scope: CharacterScope,
    clusterId: number,
    hue: number
  ): CharacterCluster[] {
    const h = this.requireHue(hue)
    this.getCluster(scope, clusterId)
    this.db
      .query(`UPDATE character_clusters SET hue = ?1 WHERE id = ?2`)
      .run(h, clusterId)
    return this.listClusters(scope)
  }

  deleteGroupCascade(id: number): void {
    const sid = String(id)
    this.db
      .query(
        `DELETE FROM character_clusters WHERE scope_type = 'group' AND scope_id = ?1`
      )
      .run(sid)
    this.db
      .query(
        `DELETE FROM character_names WHERE scope_type = 'group' AND scope_id = ?1`
      )
      .run(sid)
    this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
    this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
  }

  setGroupFavorite(id: number, favorited: boolean): boolean {
    const exists = this.db.query("SELECT 1 FROM groups WHERE id = ?1").get(id)
    if (!exists) return false
    if (favorited) {
      this.db
        .query(
          "UPDATE groups SET favorited = 1, favorited_at = ?2 WHERE id = ?1"
        )
        .run(id, this.now())
    } else {
      this.db
        .query(
          "UPDATE groups SET favorited = 0, favorited_at = NULL WHERE id = ?1"
        )
        .run(id)
    }
    return true
  }

  // --- Jobs ---

  createJob(type: string, payload: Record<string, unknown> | null): Job {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO jobs (type, status, payload, result, error, started_at, finished_at, created_at)
         VALUES (?1, 'pending', ?2, NULL, NULL, NULL, NULL, ?3)`
      )
      .run(type, payload === null ? null : JSON.stringify(payload), now)
    const id = Number(
      (this.db.query("SELECT last_insert_rowid() AS i").get() as { i: number })
        .i
    )
    return this.getJob(id)!
  }

  getJob(id: number): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?1").get(id) as
      (Omit<Job, "status"> & { status: string }) | null
    if (!row) return null
    return { ...row, status: row.status as JobStatus }
  }

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
    // status 排序键：固定状态序 running 最前（键值最大，默认 desc 即固定序）
    const statusRank =
      "CASE status WHEN 'running' THEN 6 WHEN 'paused' THEN 5 WHEN 'pending' THEN 4 WHEN 'interrupted' THEN 3 WHEN 'failed' THEN 2 WHEN 'aborted' THEN 1 ELSE 0 END"
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

  /** jobs 总数（与 listJobs 同样的 type/status 过滤） */
  countJobs(opts: { type?: string; status?: string }): number {
    const { where, binds } = jobFilterSql(opts)
    const row = this.db
      .query(`SELECT COUNT(*) AS n FROM jobs ${where}`)
      .get(...binds) as { n: number }
    return Number(row.n ?? 0)
  }

  markRunning(id: number): boolean {
    const res = this.db
      .query(
        "UPDATE jobs SET status='running', started_at=?2 WHERE id=?1 AND status='pending'"
      )
      .run(id, this.now())
    return Number(res.changes ?? 0) > 0
  }

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

  /** 运行中更新中间进度（仅 running 行） */
  setJobResult(id: number, result: Record<string, unknown>): void {
    this.db
      .query(`UPDATE jobs SET result=?2 WHERE id=?1 AND status='running'`)
      .run(id, JSON.stringify(result))
  }

  hasRunningOfType(type: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM jobs WHERE type=?1 AND status IN ('running','paused') LIMIT 1")
      .get(type)
    return !!row
  }

  /** 批量删除（只删终态；活动行由 API 层先检查 409；返回删除的 job 数，不计 CASCADE 日志） */
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

  deleteJob(id: number): void {
    this.db.query("DELETE FROM jobs WHERE id=?1").run(id)
  }

  markStaleJobsInterrupted(): number {
    const now = this.now()
    // 两条 UPDATE 同事务：jobs 与 archive_cursors 状态一致（都标 interrupted），
    // 避免崩溃在两条之间时一边 interrupted、一边残留 running
    return this.db.transaction(() => {
      const res = this.db
        .query(
          `UPDATE jobs SET status='interrupted', finished_at=?1
           WHERE status IN ('running','pending','paused')`
        )
        .run(now)
      // 崩溃后归档游标可能残留 running，一并标 interrupted（续跑仍靠 next_mtid）
      this.db
        .query(
          `UPDATE archive_cursors SET status='interrupted', updated_at=?1
           WHERE status='running'`
        )
        .run(now)
      return Number(res.changes ?? 0)
    })()
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
      .all(jobId, opts.level ?? null, opts.limit, opts.offset) as JobLog[]
  }

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
  ): { items: ArchivePost[]; nextPage?: number; total: number } {
    const SORT_COL: Record<typeof opts.sort, string> = {
      title: "title COLLATE NOCASE",
      // tid 为 TEXT；按数值排，避免 5/6 位跨位数字典序颠倒
      tid: "CAST(tid AS INTEGER)",
      archived_at: "archived_at",
    }
    const sortCol = SORT_COL[opts.sort]
    if (!sortCol) throw new Error(`invalid sort: ${opts.sort}`)
    // 默认 order：title→asc、tid/archived_at→desc
    const order = opts.order ?? (opts.sort === "title" ? "asc" : "desc")
    if (order !== "asc" && order !== "desc") {
      throw new Error(`invalid order: ${order}`)
    }
    const page = Math.max(1, opts.page)
    const q = opts.q?.trim() ?? ""
    const where = `site=?1 AND (?2 = '' OR title LIKE '%' || ?2 || '%' COLLATE NOCASE)`
    const totalRow = this.db
      .query(`SELECT COUNT(*) AS n FROM archive_posts WHERE ${where}`)
      .get(site, q) as { n: number }
    const total = Number(totalRow.n ?? 0)
    // 次级排序也用数值 tid，与主排序一致
    const rows = this.db
      .query(
        `SELECT * FROM archive_posts
         WHERE ${where}
         ORDER BY ${sortCol} ${order.toUpperCase()}, CAST(tid AS INTEGER) ${order.toUpperCase()}
         LIMIT ?3 OFFSET ?4`
      )
      .all(site, q, opts.limit + 1, (page - 1) * opts.limit) as ArchivePost[]
    const hasMore = rows.length > opts.limit
    const items = hasMore ? rows.slice(0, opts.limit) : rows
    return {
      items,
      nextPage: hasMore ? page + 1 : undefined,
      total,
    }
  }

  /** 导出/任务用：某站全部归档帖（无分页） */
  listAllArchivePosts(site: string): ArchivePost[] {
    return this.db
      .query("SELECT * FROM archive_posts WHERE site = ?1")
      .all(site) as ArchivePost[]
  }

  /** 归档库内最大 tid（按数值比较；无数据返回 null） */
  getArchiveMaxTid(site: string): string | null {
    const row = this.db
      .query(
        `SELECT tid FROM archive_posts
         WHERE site = ?1
         ORDER BY CAST(tid AS INTEGER) DESC
         LIMIT 1`
      )
      .get(site) as { tid: string } | null
    return row?.tid ?? null
  }

  getArchiveCursor(site: string): ArchiveCursor | null {
    const row = this.db
      .query("SELECT * FROM archive_cursors WHERE site = ?1")
      .get(site) as {
      site: string
      next_mtid: string | null
      mode: string
      status: string
      pages: number
      updated_at: number
    } | null
    if (!row) return null
    return {
      site: row.site,
      next_mtid: row.next_mtid,
      mode: row.mode,
      status: row.status as ArchiveCursorStatus,
      pages: row.pages,
      updated_at: row.updated_at,
    }
  }

  setArchiveCursor(
    site: string,
    patch: {
      next_mtid: string | null
      mode: string
      status: ArchiveCursorStatus
      pages: number
    }
  ): void {
    this.db
      .query(
        `INSERT INTO archive_cursors (site, next_mtid, mode, status, pages, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(site) DO UPDATE SET
           next_mtid = excluded.next_mtid,
           mode = excluded.mode,
           status = excluded.status,
           pages = excluded.pages,
           updated_at = excluded.updated_at`
      )
      .run(
        site,
        patch.next_mtid,
        patch.mode,
        patch.status,
        patch.pages,
        this.now()
      )
  }

  getArchiveStatus(site: string): {
    total: number
    maxTid: string | null
    cursor: ArchiveCursor | null
  } {
    const totalRow = this.db
      .query("SELECT COUNT(*) AS n FROM archive_posts WHERE site = ?1")
      .get(site) as { n: number }
    return {
      total: Number(totalRow.n ?? 0),
      maxTid: this.getArchiveMaxTid(site),
      cursor: this.getArchiveCursor(site),
    }
  }

  /**
   * 导出本地数据快照（备份用）。archive 可能较大，一次 JSON 足够个人库量级。
   */
  exportBackup(): {
    version: 3
    exportedAt: number
    items: unknown[]
    favorites: unknown[]
    tags: unknown[]
    bookmarks: Bookmark[]
    groups: Group[]
    archive_posts: ArchivePost[]
    archive_cursors: ArchiveCursor[]
    character_names: Array<{
      scope_type: string
      scope_id: string
      name: string
      cluster_id: number
      created_at: number
    }>
    character_clusters: Array<{
      id: number
      scope_type: string
      scope_id: string
      hue: number
      created_at: number
    }>
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
  } {
    const items = this.db.query("SELECT * FROM items").all()
    const favorites = this.db.query("SELECT * FROM favorites").all()
    const tags = this.db.query("SELECT * FROM tags").all()
    const groups = this.listGroups()
    const archive_posts = this.db
      .query("SELECT * FROM archive_posts ORDER BY site, tid")
      .all() as ArchivePost[]
    const cursors = this.db
      .query("SELECT * FROM archive_cursors")
      .all() as Array<{
      site: string
      next_mtid: string | null
      mode: string
      status: string
      pages: number
      updated_at: number
    }>
    const character_names = this.db
      .query(
        "SELECT * FROM character_names ORDER BY scope_type, scope_id, name"
      )
      .all() as Array<{
      scope_type: string
      scope_id: string
      name: string
      cluster_id: number
      created_at: number
    }>
    const character_clusters = this.db
      .query("SELECT * FROM character_clusters ORDER BY id")
      .all() as Array<{
      id: number
      scope_type: string
      scope_id: string
      hue: number
      created_at: number
    }>
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
    const bookmarks = this.db
      .query(`${this.bookmarkSelectSql()} ORDER BY b.id`)
      .all() as BookmarkRow[]
    return {
      version: 3,
      exportedAt: this.now(),
      items,
      favorites,
      tags,
      bookmarks: bookmarks.map((r) => this.mapBookmark(r)),
      groups,
      archive_posts,
      archive_cursors: cursors.map((r) => ({
        site: r.site,
        next_mtid: r.next_mtid,
        mode: r.mode,
        status: r.status as ArchiveCursorStatus,
        pages: r.pages,
        updated_at: r.updated_at,
      })),
      character_names,
      character_clusters,
      reading_sessions,
    }
  }

  close(): void {
    this.db.close()
  }
}
