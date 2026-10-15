package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"purifier/internal/model"
)

const BookmarkCapPerScope = 50

type BookmarkDetail struct {
	ID             int64          `json:"id" db:"id"`
	Site           string         `json:"site" db:"site"`
	Kind           model.ItemKind `json:"kind" db:"kind"`
	ItemID         string         `json:"item_id" db:"item_id"`
	Title          string         `json:"title" db:"title"`
	Chapter        *int           `json:"chapter,omitempty" db:"chapter"`
	Quote          string         `json:"quote" db:"quote"`
	Note           string         `json:"note" db:"note"`
	ScrollProgress float64        `json:"scroll_progress" db:"scroll_progress"`
	CreatedAt      int64          `json:"created_at" db:"created_at"`
}

type BookmarkListResult struct {
	Items    []BookmarkDetail `json:"items"`
	NextPage *int             `json:"nextPage,omitempty"`
	Total    *int             `json:"total,omitempty"`
}

// AddBookmark 添加书签（满 50 条报 409，item 不存在报 404）
func (s *Store) AddBookmark(ctx context.Context, b model.Bookmark) (*BookmarkDetail, error) {
	var title string
	err := s.db.GetContext(ctx, &title, "SELECT title FROM items WHERE site = ? AND kind = ? AND id = ?", b.Site, string(b.Kind), b.ItemID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("item not found")
	} else if err != nil {
		return nil, err
	}

	var count int
	countQuery := "SELECT COUNT(*) FROM bookmarks WHERE site = ? AND kind = ? AND item_id = ?"
	args := []any{b.Site, string(b.Kind), b.ItemID}
	if b.Chapter != nil {
		countQuery += " AND chapter = ?"
		args = append(args, *b.Chapter)
	} else {
		countQuery += " AND chapter IS NULL"
	}
	if err := s.db.GetContext(ctx, &count, countQuery, args...); err != nil {
		return nil, err
	}
	if count >= BookmarkCapPerScope {
		return nil, errors.New("bookmark limit reached")
	}

	now := time.Now().UnixMilli()
	query := `
		INSERT INTO bookmarks (site, kind, item_id, chapter, quote, note, scroll_progress, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	res, err := s.db.ExecContext(ctx, query, b.Site, string(b.Kind), b.ItemID, b.Chapter, b.Quote, b.Note, b.ScrollProgress, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()

	return &BookmarkDetail{
		ID:             id,
		Site:           b.Site,
		Kind:           b.Kind,
		ItemID:         b.ItemID,
		Title:          title,
		Chapter:        b.Chapter,
		Quote:          b.Quote,
		Note:           b.Note,
		ScrollProgress: b.ScrollProgress,
		CreatedAt:      now,
	}, nil
}

// ListBookmarksByItem 获取特定条目（及可选章节）的书签列表（不分页）
func (s *Store) ListBookmarksByItem(ctx context.Context, site string, kind model.ItemKind, itemID string, chapter *int) ([]BookmarkDetail, error) {
	query := `
		SELECT b.id, b.site, b.kind, b.item_id, COALESCE(i.title, '') AS title,
		       b.chapter, b.quote, b.note, b.scroll_progress, b.created_at
		FROM bookmarks b
		LEFT JOIN items i ON i.site = b.site AND i.kind = b.kind AND i.id = b.item_id
		WHERE b.site = ? AND b.kind = ? AND b.item_id = ?
	`
	args := []any{site, string(kind), itemID}
	if chapter != nil {
		query += " AND b.chapter = ?"
		args = append(args, *chapter)
	}
	query += " ORDER BY b.created_at DESC"

	var list []BookmarkDetail
	err := s.db.SelectContext(ctx, &list, query, args...)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []BookmarkDetail{}
	}
	return list, nil
}

// ListBookmarks 全局分页查询书签
func (s *Store) ListBookmarks(ctx context.Context, q string, kind model.ItemKind, page int) (*BookmarkListResult, error) {
	if page < 1 {
		page = 1
	}
	limit := PageSize + 1
	offset := (page - 1) * PageSize

	var conditions []string
	var args []any

	if kind != "" {
		conditions = append(conditions, "b.kind = ?")
		args = append(args, string(kind))
	}
	if q != "" {
		conditions = append(conditions, "(b.quote LIKE ? OR b.note LIKE ? OR i.title LIKE ?)")
		args = append(args, "%"+q+"%", "%"+q+"%", "%"+q+"%")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// 统计总数
	var total int
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM bookmarks b
		LEFT JOIN items i ON i.site = b.site AND i.kind = b.kind AND i.id = b.item_id
		%s
	`, whereClause)
	if err := s.db.GetContext(ctx, &total, countQuery, args...); err != nil {
		return nil, err
	}

	dataQuery := fmt.Sprintf(`
		SELECT b.id, b.site, b.kind, b.item_id, COALESCE(i.title, '') AS title,
		       b.chapter, b.quote, b.note, b.scroll_progress, b.created_at
		FROM bookmarks b
		LEFT JOIN items i ON i.site = b.site AND i.kind = b.kind AND i.id = b.item_id
		%s
		ORDER BY b.created_at DESC
		LIMIT ? OFFSET ?
	`, whereClause)

	args = append(args, limit, offset)
	var list []BookmarkDetail
	if err := s.db.SelectContext(ctx, &list, dataQuery, args...); err != nil {
		return nil, err
	}

	hasNext := len(list) > PageSize
	if hasNext {
		list = list[:PageSize]
	}

	res := &BookmarkListResult{
		Items: list,
		Total: &total,
	}
	if hasNext {
		next := page + 1
		res.NextPage = &next
	}
	return res, nil
}

// UpdateBookmarkNote 修改书签备注
func (s *Store) UpdateBookmarkNote(ctx context.Context, id int64, note string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE bookmarks SET note = ? WHERE id = ?", note, id)
	return err
}

// DeleteBookmark 删除书签
func (s *Store) DeleteBookmark(ctx context.Context, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM bookmarks WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	rows, err := res.RowsAffected()
	return rows > 0, err
}
