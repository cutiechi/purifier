import { Database, type SQLQueryBindings } from "bun:sqlite"
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
  kind: string
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: number
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

  /** 成功访问（含 cache hit）：upsert items，title/url/last_visited_at 覆盖，visit_count+1，first_seen_at 保留 */
  recordVisit(kind: ItemKind, id: string, title: string, url: string): void {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO items (kind, id, title, url, first_seen_at, last_visited_at, visit_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)
         ON CONFLICT(kind, id) DO UPDATE SET
           title = excluded.title,
           url = excluded.url,
           last_visited_at = excluded.last_visited_at,
           visit_count = visit_count + 1`
      )
      .run(kind, id, title, url, now)
  }

  /** 单对象状态；items 中不存在返回 null */
  getState(kind: ItemKind, id: string): ItemState | null {
    const row = this.db
      .query(
        `SELECT title, url, first_seen_at, last_visited_at, visit_count
         FROM items WHERE kind = ?1 AND id = ?2`
      )
      .get(kind, id) as {
      title: string
      url: string
      first_seen_at: number
      last_visited_at: number
      visit_count: number
    } | null
    if (!row) return null
    const fav = this.db
      .query("SELECT 1 FROM favorites WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    const tagRows = this.db
      .query(
        "SELECT tag FROM tags WHERE kind = ?1 AND id = ?2 ORDER BY created_at, rowid"
      )
      .all(kind, id) as { tag: string }[]
    return {
      kind,
      id,
      title: row.title,
      url: row.url,
      first_seen_at: row.first_seen_at,
      last_visited_at: row.last_visited_at,
      visit_count: row.visit_count,
      favorited: !!fav,
      tags: tagRows.map((r) => r.tag),
    }
  }

  /** 收藏；对象必须已存在于 items，否则返回 false（API 层映射 404） */
  addFavorite(kind: ItemKind, id: string): boolean {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    if (!exists) return false
    this.db
      .query(
        "INSERT OR IGNORE INTO favorites (kind, id, favorited_at) VALUES (?1, ?2, ?3)"
      )
      .run(kind, id, this.now())
    return true
  }

  removeFavorite(kind: ItemKind, id: string): void {
    this.db
      .query("DELETE FROM favorites WHERE kind = ?1 AND id = ?2")
      .run(kind, id)
  }

  /** 整体替换标签；对象不存在返回 null（API 层映射 404）；返回实际落库的标签 */
  setTags(kind: ItemKind, id: string, tags: string[]): string[] | null {
    const exists = this.db
      .query("SELECT 1 FROM items WHERE kind = ?1 AND id = ?2")
      .get(kind, id)
    if (!exists) return null
    const normalized = normalizeTags(tags)
    const created = this.now()
    const run = this.db.transaction(() => {
      this.db
        .query("DELETE FROM tags WHERE kind = ?1 AND id = ?2")
        .run(kind, id)
      const insert = this.db.query(
        "INSERT INTO tags (kind, id, tag, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
      for (const tag of normalized) insert.run(kind, id, tag, created)
    })
    run()
    return normalized
  }

  /** 历史：全量，最近访问倒序；q 匹配标题子串（NOCASE）或标签精确；kind 可筛选 */
  listHistory(query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const page = Math.max(1, query.page ?? 1)
    return this.runList(
      `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM items i
       WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?3 OFFSET ?4`,
      [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
      page
    )
  }

  /** 收藏列表：按收藏时间倒序，支持同样搜索 */
  // 排序：favorited_at DESC + f.rowid DESC 兜底 —— 生产同毫秒收藏时按插入顺序倒序，符合「后收藏在前」预期
  listFavorites(query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const page = Math.max(1, query.page ?? 1)
    return this.runList(
      `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              f.favorited_at, 1 AS favorited
       FROM favorites f
       JOIN items i ON i.kind = f.kind AND i.id = f.id
       WHERE (?1 = '' OR i.title LIKE '%' || ?1 || '%' COLLATE NOCASE
              OR EXISTS(SELECT 1 FROM tags t
                        WHERE t.kind = i.kind AND t.id = i.id AND t.tag = ?1))
         AND (?2 IS NULL OR i.kind = ?2)
       ORDER BY f.favorited_at DESC, f.rowid DESC
       LIMIT ?3 OFFSET ?4`,
      [q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
      page
    )
  }

  /** 全部标签及计数：数量倒序，同数按字母序，无分页 */
  listTags(): TagCount[] {
    const rows = this.db
      .query(
        "SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC"
      )
      .all() as { tag: string; count: number }[]
    return rows.map((r) => ({ tag: r.tag, count: r.count }))
  }

  /** 按标签精确筛选对象；q/kind 在结果内继续过滤 */
  // 注意：GROUP BY i.kind, i.id 下 i.title/i.url/i.last_visited_at/i.visit_count 是 bare column；
  // 组内由 items 主键 (kind,id) 唯一确定，取任意行结果恒等，安全。不要「修复」成 GROUP BY 全列。
  listByTag(tag: string, query: ListQuery): ListResult {
    const q = query.q ?? ""
    const kind = query.kind || null
    const page = Math.max(1, query.page ?? 1)
    return this.runList(
      `SELECT i.kind, i.id, i.title, i.url, i.last_visited_at, i.visit_count,
              (EXISTS(SELECT 1 FROM favorites f
                      WHERE f.kind = i.kind AND f.id = i.id)) AS favorited
       FROM tags t
       JOIN items i ON i.kind = t.kind AND i.id = t.id
       WHERE t.tag = ?1
         AND (?2 = '' OR i.title LIKE '%' || ?2 || '%' COLLATE NOCASE)
         AND (?3 IS NULL OR i.kind = ?3)
       GROUP BY i.kind, i.id
       ORDER BY i.last_visited_at DESC, i.rowid DESC
       LIMIT ?4 OFFSET ?5`,
      [tag, q, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
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
        kind: r.kind as ItemKind,
        id: r.id,
        title: r.title,
        url: r.url,
        visit_count: r.visit_count,
        favorited: r.favorited === 1,
        tags: [],
      }
      if (r.last_visited_at != null) item.last_visited_at = r.last_visited_at
      if (r.favorited_at != null) item.favorited_at = r.favorited_at
      return item
    })
    const tagMap = this.tagsFor(items.map((i) => [i.kind, i.id]))
    for (const item of items) {
      item.tags = tagMap.get(`${item.kind}:${item.id}`) ?? []
    }
    const hasMore = items.length > PAGE_SIZE
    return {
      items: hasMore ? items.slice(0, PAGE_SIZE) : items,
      nextPage: hasMore ? page + 1 : undefined,
    }
  }

  /** 一次 SQL 聚合整页 tags，避免 N+1 */
  // 已知：SQL 文本随页内容变化，bun:sqlite 的 prepared statement 缓存命中率为 0；
  // 单用户量级无害，接受即可，不必优化（历史增长后如需要可改 (kind,id) IN (VALUES ...)）。
  private tagsFor(kindIds: Array<[ItemKind, string]>): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (kindIds.length === 0) return map
    const clauses = kindIds
      .map((_, i) => `(kind = ?${i * 2 + 1} AND id = ?${i * 2 + 2})`)
      .join(" OR ")
    const params = kindIds.flat()
    const rows = this.db
      .query(
        `SELECT kind, id, tag FROM tags WHERE ${clauses} ORDER BY created_at, rowid`
      )
      .all(...params) as { kind: ItemKind; id: string; tag: string }[]
    for (const r of rows) {
      const key = `${r.kind}:${r.id}`
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
