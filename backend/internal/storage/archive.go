package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"purifier/internal/model"
)

type ArchiveListResult struct {
	Items    []model.ArchivePost `json:"items"`
	NextPage *int                `json:"nextPage,omitempty"`
	Total    int                 `json:"total"`
}

type ArchiveStatusResult struct {
	Total  int         `json:"total"`
	MaxTid *string     `json:"maxTid,omitempty"`
	Cursor *CursorInfo `json:"cursor,omitempty"`
}

func (s *Store) ListArchivePosts(ctx context.Context, site, q string, page, limit int, sortCol, order string) (*ArchiveListResult, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = 50
	} else if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	var whereConds = []string{"site = ?"}
	var args = []any{site}

	if q != "" {
		whereConds = append(whereConds, "title LIKE ?")
		args = append(args, "%"+q+"%")
	}
	whereClause := "WHERE " + strings.Join(whereConds, " AND ")

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM archive_posts %s", whereClause)
	if err := s.db.GetContext(ctx, &total, countQuery, args...); err != nil {
		return nil, err
	}

	orderDir := "DESC"
	if strings.ToLower(order) == "asc" {
		orderDir = "ASC"
	}

	sortExpr := "CAST(tid AS INTEGER)"
	switch sortCol {
	case "title":
		sortExpr = "title"
		if order == "" {
			orderDir = "ASC"
		}
	case "archived_at":
		sortExpr = "archived_at"
	}

	dataQuery := fmt.Sprintf(`
		SELECT site, tid, title, first_seen_at, archived_at
		FROM archive_posts
		%s
		ORDER BY %s %s, CAST(tid AS INTEGER) %s
		LIMIT ? OFFSET ?
	`, whereClause, sortExpr, orderDir, orderDir)

	args = append(args, limit+1, offset)

	var items []model.ArchivePost
	if err := s.db.SelectContext(ctx, &items, dataQuery, args...); err != nil {
		return nil, err
	}

	hasNext := len(items) > limit
	if hasNext {
		items = items[:limit]
	}

	res := &ArchiveListResult{
		Items: items,
		Total: total,
	}
	if hasNext {
		next := page + 1
		res.NextPage = &next
	}
	return res, nil
}

func (s *Store) GetArchiveStatus(ctx context.Context, site string) (*ArchiveStatusResult, error) {
	var total int
	_ = s.db.GetContext(ctx, &total, "SELECT COUNT(*) FROM archive_posts WHERE site = ?", site)

	var maxTid sql.NullString
	_ = s.db.GetContext(ctx, &maxTid, "SELECT MAX(CAST(tid AS INTEGER)) FROM archive_posts WHERE site = ?", site)

	cursor, _ := s.GetArchiveCursor(ctx, site)

	res := &ArchiveStatusResult{
		Total:  total,
		Cursor: cursor,
	}
	if maxTid.Valid {
		val := maxTid.String
		res.MaxTid = &val
	}
	return res, nil
}
