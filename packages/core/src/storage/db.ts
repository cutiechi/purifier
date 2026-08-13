import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { LEGACY_SLOT_HUE } from "../character-highlight"

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

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  genre TEXT,
  favorited INTEGER NOT NULL DEFAULT 0,
  favorited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_items (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  tid TEXT NOT NULL,
  title TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, tid)
);

CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  payload       TEXT,
  result        TEXT,
  error         TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_type_created_idx ON jobs(type, created_at DESC);

CREATE TABLE IF NOT EXISTS job_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS job_logs_job_created_idx ON job_logs(job_id, created_at);

CREATE TABLE IF NOT EXISTS archive_posts (
  site          TEXT    NOT NULL,
  tid           TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  first_seen_at INTEGER NOT NULL,
  archived_at   INTEGER NOT NULL,
  PRIMARY KEY (site, tid)
);
CREATE INDEX IF NOT EXISTS archive_posts_site_title_idx
  ON archive_posts(site, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS archive_posts_site_archived_idx
  ON archive_posts(site, archived_at DESC);

CREATE TABLE IF NOT EXISTS archive_cursors (
  site       TEXT PRIMARY KEY,
  next_mtid  TEXT,
  mode       TEXT NOT NULL DEFAULT 'full',
  status     TEXT NOT NULL DEFAULT 'idle',
  pages      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  hue INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_names (
  scope_type  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  cluster_id  INTEGER NOT NULL REFERENCES character_clusters(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id, name)
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL DEFAULT '1',
  kind        TEXT    NOT NULL CHECK (kind IN ('post', 'book')),
  item_id     TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  duration_s  INTEGER,
  estimated   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_item    ON reading_sessions (site, kind, item_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  item_id TEXT NOT NULL,
  chapter INTEGER,
  quote TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  scroll_progress REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_item
  ON bookmarks (site, kind, item_id, chapter, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created
  ON bookmarks (created_at DESC);
`

/** 打开（必要时创建）SQLite 库并确保表结构存在 */
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec(DDL)
  // 1. character_names color_index → clusters（旧库迁移）
  //    旧库 character_names 有 color_index、无 cluster_id；CREATE TABLE IF NOT EXISTS 会跳过，
  //    故按行迁移：每行建一个 character_clusters（hue 按 LEGACY_SLOT_HUE 映射），再指向它。
  //    新库 DDL 已带 cluster_id，此块跳过。索引必须在其后无条件创建，新旧库都保证存在。
  const charCols = db.query("PRAGMA table_info(character_names)").all() as {
    name: string
  }[]
  if (charCols.some((c) => c.name === "color_index")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS character_clusters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          hue INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE character_names_new (
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          name TEXT NOT NULL,
          cluster_id INTEGER NOT NULL
            REFERENCES character_clusters(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (scope_type, scope_id, name)
        );
      `)
      const old = db
        .query(
          `SELECT scope_type, scope_id, name, color_index, created_at
           FROM character_names`
        )
        .all() as Array<{
        scope_type: string
        scope_id: string
        name: string
        color_index: number
        created_at: number
      }>
      const insC = db.query(
        `INSERT INTO character_clusters (scope_type, scope_id, hue, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      const insN = db.query(
        `INSERT INTO character_names_new
           (scope_type, scope_id, name, cluster_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      for (const row of old) {
        const slot = ((row.color_index % 6) + 6) % 6
        const hue = LEGACY_SLOT_HUE[slot]!
        const r = insC.run(row.scope_type, row.scope_id, hue, row.created_at)
        insN.run(
          row.scope_type,
          row.scope_id,
          row.name,
          Number(r.lastInsertRowid),
          row.created_at
        )
      }
      db.exec(`DROP TABLE character_names`)
      db.exec(`ALTER TABLE character_names_new RENAME TO character_names`)
      console.log(`migrated ${old.length} character_names rows to clusters`)
    })()
  }

  // 索引必须在这段迁移之后无条件执行：新库迁移跳过仍需索引；旧库要等表重建完才有 cluster_id 列。
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_character_names_cluster
     ON character_names (cluster_id)`
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_character_clusters_scope
     ON character_clusters (scope_type, scope_id)`
  )

  // 2. 旧库补 read_progress（保留原幂等块，必须在 site 重建之前）
  const colsRp = db.query("PRAGMA table_info(items)").all() as {
    name: string
  }[]
  if (!colsRp.some((c) => c.name === "read_progress")) {
    // 单语句也走事务：DDL 与后续语句的可见性一致，避免半迁移状态
    db.transaction(() => {
      db.exec("ALTER TABLE items ADD COLUMN read_progress REAL")
    })()
  }

  // 3. 检测是否需要重建：site 列缺失，或 PK 不含 site
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
    // 重建整库包在一个事务里：任一步失败整体回滚，
    // 避免 DROP 旧表后、RENAME 前崩溃导致数据永久丢失
    db.transaction(() => {
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
    })()
  }

  // 4. group_items.tid 全局唯一（一帖一组）
  //    不可逆迁移：先删重复（保留每组 tid 中 group_id 最小者），再建唯一索引。
  //    幂等：索引已存在则跳过。对真实 data/purifier.db 动手前可先跑
  //    SELECT tid, COUNT(*) AS n FROM group_items GROUP BY tid HAVING n > 1;
  const tidUnique = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='group_items_tid_unique'"
    )
    .get()
  if (!tidUnique) {
    db.transaction(() => {
      const before = (
        db.query("SELECT COUNT(*) AS n FROM group_items").get() as { n: number }
      ).n
      db.exec(`
        DELETE FROM group_items
        WHERE EXISTS (
          SELECT 1 FROM group_items o
          WHERE o.tid = group_items.tid
            AND o.group_id < group_items.group_id
        )
      `)
      const after = (
        db.query("SELECT COUNT(*) AS n FROM group_items").get() as { n: number }
      ).n
      const removed = before - after
      if (removed > 0) {
        console.log(
          `[db] removed ${removed} duplicate group_items rows for tid UNIQUE`
        )
      }
      db.exec("CREATE UNIQUE INDEX group_items_tid_unique ON group_items(tid)")
    })()
  }

  // 5. reading_sessions 回填：表为空且 items 非空时，按 first_seen_at / last_visited_at
  //    补活跃日（duration_s NULL, estimated 1）。幂等：表非空跳过。不按 visit_count 插值。
  const sessionsEmpty = (
    db.query("SELECT COUNT(*) AS n FROM reading_sessions").get() as {
      n: number
    }
  ).n
  if (sessionsEmpty === 0) {
    const itemsCount = (
      db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number }
    ).n
    if (itemsCount > 0) {
      db.transaction(() => {
        const insert = db.query(
          `INSERT INTO reading_sessions (site, kind, item_id, title, started_at, duration_s, estimated)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1)`
        )
        const rows = db
          .query(
            "SELECT site, kind, id, title, first_seen_at, last_visited_at FROM items"
          )
          .all() as {
          site: string
          kind: string
          id: string
          title: string
          first_seen_at: number
          last_visited_at: number
        }[]
        for (const r of rows) {
          insert.run(r.site, r.kind, r.id, r.title, r.first_seen_at)
          if (r.last_visited_at !== r.first_seen_at) {
            insert.run(r.site, r.kind, r.id, r.title, r.last_visited_at)
          }
        }
      })()
    }
  }
  return db
}
