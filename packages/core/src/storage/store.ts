import { Database, type SQLQueryBindings } from "bun:sqlite"
import type { SiteId } from "../extractor"
import {
  ItemKind,
  ItemState,
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
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.site = i.site AND f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM items i
       WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.site = i.site AND t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
         AND (?5 IS NULL OR i.site = ?5)
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?3 OFFSET ?4`,
      [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE, site],
      page
    )
  }

  /** 收藏列表：按收藏时间倒序，支持同样搜索 */
  // 排序：favorited_at DESC + f.rowid DESC 兜底 —— 生产同毫秒收藏时按插入顺序倒序，符合「后收藏在前」预期
  listFavorites(query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const site = query.site ?? null
    const page = Math.max(1, query.page ?? 1)
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter, f.favorited_at, 1 AS favorited
       FROM favorites f
       JOIN items i ON i.site = f.site AND i.kind = f.kind AND i.id = f.id
       WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.site = i.site AND t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
         AND (?5 IS NULL OR i.site = ?5)
       ORDER BY f.favorited_at DESC, f.rowid DESC
       LIMIT ?3 OFFSET ?4`,
      [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE, site],
      page
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
    return this.runList(
      `SELECT i.site, i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              i.read_progress, i.last_chapter,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.site = i.site AND f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM tags t
       JOIN items i ON i.site = t.site AND i.kind = t.kind AND i.id = t.id
       WHERE t.tag = ?1
         AND (?2 = '' OR i.title LIKE '%' || ?2 || '%' COLLATE NOCASE)
         AND (?3 IS NULL OR i.kind = ?3)
         AND (?6 IS NULL OR i.site = ?6)
       GROUP BY i.site, i.kind, i.id
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?4 OFFSET ?5`,
      [tag, q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE, site],
      page
    )
  }

  private runList(
    sql: string,
    params: SQLQueryBindings[],
    page: number
  ): ListResult {
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

  close(): void {
    this.db.close()
  }
}
