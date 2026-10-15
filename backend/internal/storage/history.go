package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"purifier/internal/model"
)

const PageSize = 20

type ListQuery struct {
	Q    string
	Kind model.ItemKind
	Site string
	Page int
}

type ListItem struct {
	Site          string         `json:"site"`
	Kind          model.ItemKind `json:"kind"`
	ID            string         `json:"id"`
	Title         string         `json:"title"`
	URL           string         `json:"url"`
	LastVisitedAt *int64         `json:"last_visited_at,omitempty"`
	FavoritedAt   *int64         `json:"favorited_at,omitempty"`
	VisitCount    int            `json:"visit_count"`
	Favorited     bool           `json:"favorited"`
	ReadProgress  *float64       `json:"read_progress,omitempty"`
	LastChapter   *int           `json:"last_chapter,omitempty"`
	Tags          []string       `json:"tags"`
}

type ListResult struct {
	Items    []ListItem `json:"items"`
	NextPage *int       `json:"nextPage,omitempty"`
}

// ListHistory 查询浏览历史
func (s *Store) ListHistory(ctx context.Context, q ListQuery) (*ListResult, error) {
	page := q.Page
	if page < 1 {
		page = 1
	}
	limit := PageSize + 1
	offset := (page - 1) * PageSize

	var conditions []string
	var args []any

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

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`
		SELECT
			i.site, i.kind, i.id, i.title, i.url,
			i.last_visited_at, f.favorited_at,
			i.visit_count,
			(f.favorited_at IS NOT NULL) AS favorited,
			i.read_progress, i.last_chapter
		FROM items i
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

		// 填充标签
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

// AddFavorite 收藏条目
func (s *Store) AddFavorite(ctx context.Context, site string, kind model.ItemKind, id string) (bool, error) {
	var count int
	err := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM items WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil // 404 item not found
	}

	now := time.Now().UnixMilli()
	query := `
		INSERT INTO favorites (site, kind, id, favorited_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(site, kind, id) DO UPDATE SET favorited_at = excluded.favorited_at
	`
	_, err = s.db.ExecContext(ctx, query, site, string(kind), id, now)
	return true, err
}

// RemoveFavorite 取消收藏
func (s *Store) RemoveFavorite(ctx context.Context, site string, kind model.ItemKind, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM favorites WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	return err
}

// ListFavorites 获取收藏列表
func (s *Store) ListFavorites(ctx context.Context, q ListQuery) (*ListResult, error) {
	page := q.Page
	if page < 1 {
		page = 1
	}
	limit := PageSize + 1
	offset := (page - 1) * PageSize

	var conditions []string
	var args []any

	if q.Site != "" {
		conditions = append(conditions, "f.site = ?")
		args = append(args, q.Site)
	}
	if q.Kind != "" {
		conditions = append(conditions, "f.kind = ?")
		args = append(args, string(q.Kind))
	}
	if q.Q != "" {
		conditions = append(conditions, "i.title LIKE ?")
		args = append(args, "%"+q.Q+"%")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`
		SELECT
			i.site, i.kind, i.id, i.title, i.url,
			i.last_visited_at, f.favorited_at,
			i.visit_count,
			1 AS favorited,
			i.read_progress, i.last_chapter
		FROM favorites f
		INNER JOIN items i ON i.site = f.site AND i.kind = f.kind AND i.id = f.id
		%s
		ORDER BY f.favorited_at DESC
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
			Favorited:  true,
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

type DeleteItemKey struct {
	Site string         `json:"site"`
	Kind model.ItemKind `json:"kind"`
	ID   string         `json:"id"`
}

// PurgeItem 级联删除单条条目及其关联的书签、标签、收藏
func (s *Store) PurgeItem(ctx context.Context, site string, kind model.ItemKind, id string) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.ExecContext(ctx, "DELETE FROM bookmarks WHERE site = ? AND kind = ? AND item_id = ?", site, string(kind), id)
	_, _ = tx.ExecContext(ctx, "DELETE FROM tags WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	_, _ = tx.ExecContext(ctx, "DELETE FROM favorites WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	_, err = tx.ExecContext(ctx, "DELETE FROM items WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// ClearHistory 清空历史记录（若 site 为空则跨站全部清空）
func (s *Store) ClearHistory(ctx context.Context, site string) (int64, error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var total int64
	if site != "" {
		_ = tx.GetContext(ctx, &total, "SELECT COUNT(*) FROM items WHERE site = ?", site)
		_, _ = tx.ExecContext(ctx, "DELETE FROM bookmarks WHERE site = ?", site)
		_, _ = tx.ExecContext(ctx, "DELETE FROM tags WHERE site = ?", site)
		_, _ = tx.ExecContext(ctx, "DELETE FROM favorites WHERE site = ?", site)
		_, err = tx.ExecContext(ctx, "DELETE FROM items WHERE site = ?", site)
	} else {
		_ = tx.GetContext(ctx, &total, "SELECT COUNT(*) FROM items")
		_, _ = tx.ExecContext(ctx, "DELETE FROM bookmarks")
		_, _ = tx.ExecContext(ctx, "DELETE FROM tags")
		_, _ = tx.ExecContext(ctx, "DELETE FROM favorites")
		_, err = tx.ExecContext(ctx, "DELETE FROM items")
	}

	if err != nil {
		return 0, err
	}
	return total, tx.Commit()
}

// DeleteHistoryBatch 批量删除指定条目
func (s *Store) DeleteHistoryBatch(ctx context.Context, items []DeleteItemKey) (int, error) {
	removed := 0
	for _, it := range items {
		site := it.Site
		if site == "" {
			site = "1"
		}
		if err := s.PurgeItem(ctx, site, it.Kind, it.ID); err == nil {
			removed++
		}
	}
	return removed, nil
}
