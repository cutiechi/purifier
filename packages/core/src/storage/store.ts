import { Database, type SQLQueryBindings } from "bun:sqlite"
import type { SiteId } from "../extractor"
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

  /** 在事务内删除单条 items + favorites + tags（不另开事务） */
  private purgeItem(site: SiteId, kind: ItemKind, id: string): void {
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

  /** 清空历史（items + favorites + tags）；site 省略跨站全清；返回删除的 items 数 */
  clearHistory(site?: SiteId): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM items WHERE ?1 IS NULL OR site = ?1")
      .get(site ?? null) as { n: number }
    const run = this.db.transaction(() => {
      this.db
        .query("DELETE FROM tags WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      this.db
        .query("DELETE FROM favorites WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
      this.db
        .query("DELETE FROM items WHERE ?1 IS NULL OR site = ?1")
        .run(site ?? null)
    })
    run()
    return Number(row.n ?? 0)
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

  listGroups(q?: string): Group[] {
    const rows = this.db
      .query(
        `SELECT id, key, title, author, genre, favorited, favorited_at, created_at, updated_at
         FROM groups
         WHERE (?1 = '' OR title LIKE '%' || ?1 || '%' COLLATE NOCASE)
         ORDER BY updated_at DESC, id DESC`
      )
      .all(q ?? "") as {
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
    const items = this.db
      .query(
        "SELECT group_id, tid, title FROM group_items ORDER BY added_at, rowid"
      )
      .all() as { group_id: number; tid: string; title: string }[]
    const byGroup = new Map<number, GroupMember[]>()
    for (const it of items) {
      const arr = byGroup.get(it.group_id)
      if (arr) arr.push({ tid: it.tid, title: it.title })
      else byGroup.set(it.group_id, [{ tid: it.tid, title: it.title }])
    }
    return rows.map((r) => ({
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
    }))
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
      const insert = this.db.query(
        "INSERT OR IGNORE INTO group_items (group_id, tid, title, added_at) VALUES (?1, ?2, ?3, ?4)"
      )
      for (const it of input.items) insert.run(row.id, it.tid, it.title, now)
      return row.id
    })
    const id = run()
    return this.listGroups().find((g) => g.id === id)!
  }

  deleteGroup(id: number): void {
    const run = this.db.transaction(() => {
      this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
      this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
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
        this.db.query("DELETE FROM group_items WHERE group_id = ?1").run(id)
        this.db.query("DELETE FROM groups WHERE id = ?1").run(id)
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
  }): Job[] {
    const rows = this.db
      .query(
        `SELECT * FROM jobs
         WHERE (?1 IS NULL OR type = ?1)
           AND (?2 IS NULL OR status = ?2)
         ORDER BY created_at DESC, id DESC
         LIMIT ?3 OFFSET ?4`
      )
      .all(
        opts.type ?? null,
        opts.status ?? null,
        opts.limit,
        opts.offset
      ) as (Omit<Job, "status"> & { status: string })[]
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

  /** 运行中更新中间进度（仅 running 行） */
  setJobResult(id: number, result: Record<string, unknown>): void {
    this.db
      .query(
        `UPDATE jobs SET result=?2 WHERE id=?1 AND status='running'`
      )
      .run(id, JSON.stringify(result))
  }

  hasRunningOfType(type: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM jobs WHERE type=?1 AND status='running' LIMIT 1")
      .get(type)
    return !!row
  }

  clearFinishedJobs(): number {
    // 注意：bun:sqlite 的 changes() 会计入 FK CASCADE 删掉的 job_logs 行，
    // 直接返回 changes 会多算；先数终态 job 行数再删，返回删除的 job 数。
    const row = this.db
      .query(
        "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('succeeded','failed','interrupted','aborted')"
      )
      .get() as { n: number }
    this.db
      .query(
        `DELETE FROM jobs WHERE status IN ('succeeded','failed','interrupted','aborted')`
      )
      .run()
    return Number(row.n ?? 0)
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
    const where = `site=?1 AND (?2 = '' OR title LIKE '%' || ?2 || '%' COLLATE NOCASE)`
    const totalRow = this.db
      .query(`SELECT COUNT(*) AS n FROM archive_posts WHERE ${where}`)
      .get(site, q) as { n: number }
    const total = Number(totalRow.n ?? 0)
    const rows = this.db
      .query(
        `SELECT * FROM archive_posts
         WHERE ${where}
         ORDER BY ${sortCol} ${order.toUpperCase()}, tid ${order.toUpperCase()}
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

  close(): void {
    this.db.close()
  }
}
