import { Database } from "bun:sqlite"
import { ItemKind, ItemState } from "./types"

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

  close(): void {
    this.db.close()
  }
}
