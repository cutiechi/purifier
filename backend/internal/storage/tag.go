package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"purifier/internal/model"
)

// GetTags 获取标签统计列表
func (s *Store) GetTags(ctx context.Context, site string) ([]model.TagCount, error) {
	query := "SELECT tag, COUNT(*) as count FROM tags "
	var args []any
	if site != "" {
		query += "WHERE site = ? "
		args = append(args, site)
	}
	query += "GROUP BY tag ORDER BY count DESC, tag ASC"

	var tags []model.TagCount
	err := s.db.SelectContext(ctx, &tags, query, args...)
	if err != nil {
		return nil, err
	}
	if tags == nil {
		tags = []model.TagCount{}
	}
	return tags, nil
}

// UpdateTags 整体替换条目的标签（若 item 不存在返回 false）
func (s *Store) UpdateTags(ctx context.Context, site string, kind model.ItemKind, id string, tags []string) (bool, error) {
	var count int
	err := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM items WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM tags WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id); err != nil {
		return false, err
	}

	now := time.Now().UnixMilli()
	for _, t := range tags {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO tags (site, kind, id, tag, created_at) VALUES (?, ?, ?, ?, ?)", site, string(kind), id, trimmed, now); err != nil {
			return false, err
		}
	}

	return true, tx.Commit()
}

// DeleteTag 全局删除某标签
func (s *Store) DeleteTag(ctx context.Context, tag, site string) (int64, error) {
	query := "DELETE FROM tags WHERE tag = ?"
	args := []any{tag}
	if site != "" {
		query += " AND site = ?"
		args = append(args, site)
	}
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ListItemsByTag 按标签精确筛选条目
func (s *Store) ListItemsByTag(ctx context.Context, tag string, q ListQuery) (*ListResult, error) {
	page := q.Page
	if page < 1 {
		page = 1
	}
	limit := PageSize + 1
	offset := (page - 1) * PageSize

	conditions := []string{"t.tag = ?"}
	args := []any{tag}

	if q.Site != "" {
		conditions = append(conditions, "i.site = ?")
		args = append(args, q.Site)
	}
	if q.Kind != "" {
		conditions = append(conditions, "i.kind = ?")
		args = append(args, string(q.Kind))
	}
	if q.Q != "" {
		conditions = append(conditions, "i.title LIKE ?")
		args = append(args, "%"+q.Q+"%")
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	query := fmt.Sprintf(`
		SELECT
			i.site, i.kind, i.id, i.title, i.url,
			i.last_visited_at, f.favorited_at,
			i.visit_count,
			(f.favorited_at IS NOT NULL) AS favorited,
			i.read_progress, i.last_chapter
		FROM tags t
		INNER JOIN items i ON i.site = t.site AND i.kind = t.kind AND i.id = t.id
		LEFT JOIN favorites f ON f.site = i.site AND f.kind = i.kind AND f.id = i.id
		%s
		ORDER BY i.last_visited_at DESC
		LIMIT ? OFFSET ?
	`, whereClause)

	args = append(args, limit, offset)

	type rowType struct {
		Site          string          `db:"site"`
		Kind          string          `db:"kind"`
		ID            string          `db:"id"`
		Title         string          `db:"title"`
		URL           string          `db:"url"`
		LastVisitedAt sql.NullInt64   `db:"last_visited_at"`
		FavoritedAt   sql.NullInt64   `db:"favorited_at"`
		VisitCount    int             `db:"visit_count"`
		Favorited     bool            `db:"favorited"`
		ReadProgress  sql.NullFloat64 `db:"read_progress"`
		LastChapter   sql.NullInt64   `db:"last_chapter"`
	}

	var rows []rowType
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, err
	}

	hasNext := len(rows) > PageSize
	if hasNext {
		rows = rows[:PageSize]
	}

	items := make([]ListItem, len(rows))
	for idx, r := range rows {
		item := ListItem{
			Site:       r.Site,
			Kind:       model.ItemKind(r.Kind),
			ID:         r.ID,
			Title:      r.Title,
			URL:        r.URL,
			VisitCount: r.VisitCount,
			Favorited:  r.Favorited,
			Tags:       []string{},
		}
		if r.LastVisitedAt.Valid {
			item.LastVisitedAt = &r.LastVisitedAt.Int64
		}
		if r.FavoritedAt.Valid {
			item.FavoritedAt = &r.FavoritedAt.Int64
		}
		if r.ReadProgress.Valid {
			item.ReadProgress = &r.ReadProgress.Float64
		}
		if r.LastChapter.Valid {
			val := int(r.LastChapter.Int64)
			item.LastChapter = &val
		}

		var tags []string
		_ = s.db.SelectContext(ctx, &tags, "SELECT tag FROM tags WHERE site = ? AND kind = ? AND id = ? ORDER BY created_at ASC", r.Site, r.Kind, r.ID)
		if tags != nil {
			item.Tags = tags
		}

		items[idx] = item
	}

	res := &ListResult{Items: items}
	if hasNext {
		next := page + 1
		res.NextPage = &next
	}
	return res, nil
}
