package storage

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

// migration 是一次顺序 schema 变更。版本号写入 PRAGMA user_version，
// 已部署库按版本号跳过，新增列/索引/约束只需在末尾追加一条。
type migration struct {
	version int
	stmts   string
}

var migrations = []migration{
	{
		// v1：基线。全部 IF NOT EXISTS，对已有库是无操作。
		version: 1,
		stmts: `
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
`,
	},
	{
		// v2：把生产库早已存在的索引写进 DDL，并让 tid 全局唯一成为受约束的行为。
		// 去重保留每个 tid 最早加入的那条（added_at，同时间按 rowid），
		// 避免 CREATE UNIQUE INDEX 在脏库上失败。
		//
		// 先 DROP 再建：SQLite 的 CREATE INDEX IF NOT EXISTS 只看名字，
		// 同名但非 UNIQUE 的索引会让这里静默通过，tid 依旧能跨组重复。
		version: 2,
		stmts: `
DELETE FROM group_items
 WHERE rowid NOT IN (
   SELECT rowid FROM group_items gi
    WHERE NOT EXISTS (
      SELECT 1 FROM group_items g2
       WHERE g2.tid = gi.tid
         AND (g2.added_at < gi.added_at
              OR (g2.added_at = gi.added_at AND g2.rowid < gi.rowid))
    )
 );
DROP INDEX IF EXISTS group_items_tid_unique;
CREATE UNIQUE INDEX group_items_tid_unique ON group_items(tid);
CREATE INDEX IF NOT EXISTS idx_character_names_cluster ON character_names(cluster_id);
CREATE INDEX IF NOT EXISTS idx_character_clusters_scope
  ON character_clusters(scope_type, scope_id);
`,
	},
	{
		// v3：任务停止与取消的终态需要能被快速筛出。
		version: 3,
		stmts: `
CREATE INDEX IF NOT EXISTS jobs_type_status_idx ON jobs(type, status);
`,
	},
	{
		// v4：归档目录按数字 tid 排序，用表达式索引消掉临时 B-tree。
		version: 4,
		stmts: `
CREATE INDEX IF NOT EXISTS archive_posts_site_tid_num_idx
  ON archive_posts(site, CAST(tid AS INTEGER));
`,
	},
	{
		// v5：链接发现前沿（回复即章节、正文内链扩散）。
		// 归档 feed 有上游深度上限，更早/回复里的帖子靠这里发现。
		version: 5,
		stmts: `
CREATE TABLE IF NOT EXISTS archive_frontier (
  site          TEXT NOT NULL,
  tid           TEXT NOT NULL,
  source_tid    TEXT,
  depth         INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  discovered_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (site, tid)
);
CREATE INDEX IF NOT EXISTS idx_frontier_pending
  ON archive_frontier(site, state, discovered_at);
`,
	},
}

// SchemaVersion 是当前代码期望的 schema 版本。
func SchemaVersion() int {
	return migrations[len(migrations)-1].version
}

func migrate(db *sqlx.DB) error {
	var current int
	if err := db.Get(&current, "PRAGMA user_version"); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	for _, m := range migrations {
		if m.version <= current {
			continue
		}
		tx, err := db.Beginx()
		if err != nil {
			return fmt.Errorf("migration %d: begin: %w", m.version, err)
		}
		res, err := tx.Exec(m.stmts)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d: %w", m.version, err)
		}
		// v2 会删掉重复 tid，属破坏性变更：留下行数，便于事后追溯。
		if affected, aErr := res.RowsAffected(); aErr == nil && m.version == 2 && affected > 0 {
			log.Printf("[db] migration v2 deduped %d duplicate group_items row(s)", affected)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d: set version: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %d: commit: %w", m.version, err)
		}
		log.Printf("[db] migrated schema to v%d", m.version)
		current = m.version
	}
	return nil
}

func OpenDB(dataDir string) (*sqlx.DB, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data dir: %w", err)
	}

	dbPath := filepath.Join(dataDir, "purifier.db")
	dsn := fmt.Sprintf("%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)", dbPath)

	db, err := sqlx.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite: %w", err)
	}

	// SQLite 单写多读：限制连接数，避免归档写入把页面请求拖进 5s 忙等超时。
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to migrate schema: %w", err)
	}

	return db, nil
}
