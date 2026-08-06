import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const DDL = `
CREATE TABLE IF NOT EXISTS items (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  site TEXT NOT NULL DEFAULT '1',
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  read_progress REAL,
  last_chapter INTEGER,
  PRIMARY KEY (site, kind, id)
);

CREATE TABLE IF NOT EXISTS favorites (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  site TEXT NOT NULL DEFAULT '1',
  id TEXT NOT NULL,
  favorited_at INTEGER NOT NULL,
  PRIMARY KEY (site, kind, id)
);

CREATE TABLE IF NOT EXISTS tags (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  site TEXT NOT NULL DEFAULT '1',
  id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site, kind, id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);
CREATE INDEX IF NOT EXISTS idx_items_visited ON items (last_visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_time ON favorites (favorited_at DESC);
`

/** 打开（必要时创建）SQLite 库并确保表结构存在 */
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(DDL)
  // 1. 旧库补 read_progress（保留原幂等块，必须在 site 重建之前）
  const colsRp = db.query("PRAGMA table_info(items)").all() as {
    name: string
  }[]
  if (!colsRp.some((c) => c.name === "read_progress")) {
    db.exec("ALTER TABLE items ADD COLUMN read_progress REAL")
  }

  // 2. 检测是否需要重建：site 列缺失，或 PK 不含 site
  //    （半迁移库可能有 site 列但 PK 仍是 (kind,id)，只查列会漏判导致 ON CONFLICT(site,kind,id) 炸）
  const needRebuild = (() => {
    for (const table of ["items", "favorites", "tags"]) {
      const cols = db.query(`PRAGMA table_info(${table})`).all() as {
        name: string
      }[]
      if (!cols.some((c) => c.name === "site")) return true
      // PK 含 site？查 sqlite_master 的 CREATE 文本（读不到按需重建兜底）
      const meta = db
        .query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1")
        .get(table) as { sql: string } | null
      if (!meta || !/PRIMARY\s+KEY\s*\(\s*site/i.test(meta.sql)) return true
    }
    return false
  })()

  if (needRebuild) {
    for (const { table, newSql, migrate } of [
      {
        table: "items",
        newSql: `CREATE TABLE items_new (
          kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
          site TEXT NOT NULL DEFAULT '1',
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_visited_at INTEGER NOT NULL,
          visit_count INTEGER NOT NULL DEFAULT 1,
          read_progress REAL,
          last_chapter INTEGER,
          PRIMARY KEY (site, kind, id)
        )`,
        migrate: `INSERT INTO items_new
          (kind, site, id, title, url, first_seen_at, last_visited_at, visit_count, read_progress, last_chapter)
          SELECT kind, '1', id, title, url, first_seen_at, last_visited_at, visit_count, read_progress, NULL
          FROM items`,
      },
      {
        table: "favorites",
        newSql: `CREATE TABLE favorites_new (
          kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
          site TEXT NOT NULL DEFAULT '1',
          id TEXT NOT NULL,
          favorited_at INTEGER NOT NULL,
          PRIMARY KEY (site, kind, id)
        )`,
        migrate: `INSERT INTO favorites_new (kind, site, id, favorited_at)
          SELECT kind, '1', id, favorited_at FROM favorites`,
      },
      {
        table: "tags",
        newSql: `CREATE TABLE tags_new (
          kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
          site TEXT NOT NULL DEFAULT '1',
          id TEXT NOT NULL,
          tag TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (site, kind, id, tag)
        )`,
        migrate: `INSERT INTO tags_new (kind, site, id, tag, created_at)
          SELECT kind, '1', id, tag, created_at FROM tags`,
      },
    ]) {
      db.exec(newSql)
      db.exec(migrate)
      db.exec(`DROP TABLE ${table}`)
      db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`)
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)")
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_items_visited ON items (last_visited_at DESC)"
    )
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_favorites_time ON favorites (favorited_at DESC)"
    )
  }
  return db
}
