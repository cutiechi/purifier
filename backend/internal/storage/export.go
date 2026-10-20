package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"purifier/internal/model"
)

// ExportVersion 是备份文件格式版本，写入 JSON 顶层 version 字段。
const ExportVersion = 3

// ExportBackup 在单个只读快照事务内把个人资产流式编码为 JSON 备份。
// 任一步失败即返回错误：不允许把残缺备份当成成功。
func (s *Store) ExportBackup(ctx context.Context, w io.Writer) error {
	// BEGIN（deferred）在首次读取时固定快照，WAL 下后续读取看到同一版本数据。
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	bw := &backupWriter{w: w}
	bw.raw("{\"version\":")
	bw.raw(fmt.Sprintf("%d", ExportVersion))
	bw.raw(",\"exportedAt\":")
	bw.raw(fmt.Sprintf("%d", time.Now().UnixMilli()))

	if err := bw.section("items", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT site, kind, id, title, url, first_seen_at, last_visited_at, visit_count, read_progress, last_chapter FROM items ORDER BY site, kind, id",
			func(rows *sql.Rows) (any, error) {
				var it model.Item
				if err := rows.Scan(&it.Site, &it.Kind, &it.ID, &it.Title, &it.URL,
					&it.FirstSeenAt, &it.LastVisitedAt, &it.VisitCount,
					&it.ReadProgress, &it.LastChapter); err != nil {
					return nil, err
				}
				return it, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export items: %w", err)
	}

	if err := bw.section("favorites", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT site, kind, id, favorited_at FROM favorites ORDER BY site, kind, id",
			func(rows *sql.Rows) (any, error) {
				var f model.Favorite
				if err := rows.Scan(&f.Site, &f.Kind, &f.ID, &f.FavoritedAt); err != nil {
					return nil, err
				}
				return f, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export favorites: %w", err)
	}

	if err := bw.section("tags", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT site, kind, id, tag, created_at FROM tags ORDER BY site, kind, id, created_at",
			func(rows *sql.Rows) (any, error) {
				var t model.Tag
				if err := rows.Scan(&t.Site, &t.Kind, &t.ID, &t.Tag, &t.CreatedAt); err != nil {
					return nil, err
				}
				return t, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export tags: %w", err)
	}

	if err := bw.section("bookmarks", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT id, site, kind, item_id, chapter, quote, note, scroll_progress, created_at FROM bookmarks ORDER BY id",
			func(rows *sql.Rows) (any, error) {
				var b model.Bookmark
				if err := rows.Scan(&b.ID, &b.Site, &b.Kind, &b.ItemID, &b.Chapter,
					&b.Quote, &b.Note, &b.ScrollProgress, &b.CreatedAt); err != nil {
					return nil, err
				}
				return b, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export bookmarks: %w", err)
	}

	if err := bw.section("groups", func(emit func(any) error) error {
		return streamGroups(ctx, tx, emit)
	}); err != nil {
		return fmt.Errorf("export groups: %w", err)
	}

	if err := bw.section("archive_posts", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT site, tid, title, first_seen_at, archived_at FROM archive_posts ORDER BY site, tid",
			func(rows *sql.Rows) (any, error) {
				var p model.ArchivePost
				if err := rows.Scan(&p.Site, &p.Tid, &p.Title, &p.FirstSeenAt, &p.ArchivedAt); err != nil {
					return nil, err
				}
				return p, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export archive_posts: %w", err)
	}

	if err := bw.section("archive_cursors", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT site, next_mtid, mode, status, pages, updated_at FROM archive_cursors ORDER BY site",
			func(rows *sql.Rows) (any, error) {
				var site, mode, status string
				var nextMtid *string
				var pages int
				var updatedAt int64
				if err := rows.Scan(&site, &nextMtid, &mode, &status, &pages, &updatedAt); err != nil {
					return nil, err
				}
				return map[string]any{
					"site":       site,
					"next_mtid":  nextMtid,
					"mode":       mode,
					"status":     status,
					"pages":      pages,
					"updated_at": updatedAt,
				}, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export archive_cursors: %w", err)
	}

	if err := bw.section("character_names", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT scope_type, scope_id, name, cluster_id, created_at FROM character_names ORDER BY scope_type, scope_id, name",
			func(rows *sql.Rows) (any, error) {
				var scopeType, scopeID, name string
				var clusterID, createdAt int64
				if err := rows.Scan(&scopeType, &scopeID, &name, &clusterID, &createdAt); err != nil {
					return nil, err
				}
				return map[string]any{
					"scope_type": scopeType,
					"scope_id":   scopeID,
					"name":       name,
					"cluster_id": clusterID,
					"created_at": createdAt,
				}, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export character_names: %w", err)
	}

	if err := bw.section("character_clusters", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT id, scope_type, scope_id, hue, created_at FROM character_clusters ORDER BY id",
			func(rows *sql.Rows) (any, error) {
				var id, createdAt int64
				var scopeType, scopeID string
				var hue int
				if err := rows.Scan(&id, &scopeType, &scopeID, &hue, &createdAt); err != nil {
					return nil, err
				}
				return map[string]any{
					"id":         id,
					"scope_type": scopeType,
					"scope_id":   scopeID,
					"hue":        hue,
					"created_at": createdAt,
				}, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export character_clusters: %w", err)
	}

	if err := bw.section("reading_sessions", func(emit func(any) error) error {
		return scanRows(ctx, tx, "SELECT id, site, kind, item_id, title, started_at, duration_s, estimated FROM reading_sessions ORDER BY started_at",
			func(rows *sql.Rows) (any, error) {
				var rs model.ReadingSession
				if err := rows.Scan(&rs.ID, &rs.Site, &rs.Kind, &rs.ItemID, &rs.Title,
					&rs.StartedAt, &rs.DurationS, &rs.Estimated); err != nil {
					return nil, err
				}
				return rs, nil
			}, emit)
	}); err != nil {
		return fmt.Errorf("export reading_sessions: %w", err)
	}

	bw.raw("}")
	return bw.err
}

// backupWriter 逐段写 JSON；一旦写入出错后续调用短路。
type backupWriter struct {
	w   io.Writer
	err error
}

func (b *backupWriter) raw(s string) {
	if b.err != nil {
		return
	}
	_, b.err = io.WriteString(b.w, s)
}

func (b *backupWriter) value(v any) error {
	if b.err != nil {
		return b.err
	}
	enc, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b.raw(string(enc))
	return b.err
}

// section 写 `,"name":[...]`，emit 逐条产出元素。
func (b *backupWriter) section(name string, body func(emit func(any) error) error) error {
	b.raw(fmt.Sprintf(",%q:[", name))
	first := true
	err := body(func(v any) error {
		if !first {
			b.raw(",")
		}
		first = false
		return b.value(v)
	})
	if err != nil {
		return err
	}
	b.raw("]")
	return b.err
}

// scanRows 遍历查询结果，逐行转换成值交给 emit。
func scanRows(ctx context.Context, tx interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, query string, scan func(*sql.Rows) (any, error), emit func(any) error) error {
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return err
		}
		if err := emit(v); err != nil {
			return err
		}
	}
	return rows.Err()
}

// streamGroups 以 group_id 有序合并的方式流式输出分组及其成员。
func streamGroups(ctx context.Context, tx interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, emit func(any) error) error {
	memberRows, err := tx.QueryContext(ctx, "SELECT * FROM group_items ORDER BY group_id, added_at, tid")
	if err != nil {
		return err
	}
	defer memberRows.Close()

	var pending *model.GroupItem
	nextMember := func() (*model.GroupItem, error) {
		if pending != nil {
			m := pending
			pending = nil
			return m, nil
		}
		if !memberRows.Next() {
			return nil, memberRows.Err()
		}
		var m model.GroupItem
		if err := memberRows.Scan(&m.GroupID, &m.Tid, &m.Title, &m.AddedAt); err != nil {
			return nil, err
		}
		return &m, nil
	}

	cur, err := nextMember()
	if err != nil {
		return err
	}

	groupRows, err := tx.QueryContext(ctx, "SELECT * FROM groups ORDER BY id")
	if err != nil {
		return err
	}
	defer groupRows.Close()

	for groupRows.Next() {
		var g model.Group
		if err := groupRows.Scan(&g.ID, &g.Key, &g.Title, &g.Author, &g.Genre,
			&g.Favorited, &g.FavoritedAt, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return err
		}
		// 成员行指向不存在的组（外键被关掉时可能残留）：先跳过，
		// 否则游标会停在这个更小的 group_id 上，后面所有组的成员都会丢。
		for cur != nil && cur.GroupID < g.ID {
			cur, err = nextMember()
			if err != nil {
				return err
			}
		}
		g.Items = []model.GroupItem{}
		for cur != nil && cur.GroupID == g.ID {
			g.Items = append(g.Items, *cur)
			cur, err = nextMember()
			if err != nil {
				return err
			}
		}
		if err := emit(g); err != nil {
			return err
		}
	}
	return groupRows.Err()
}
