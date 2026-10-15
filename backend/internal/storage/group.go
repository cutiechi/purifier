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

type GroupListQuery struct {
	Q         string
	Favorited bool
	Sort      string // "updated", "title", "chapters"
	Page      int
	Limit     int
}

type GroupListResult struct {
	Items    []model.Group `json:"items"`
	NextPage *int          `json:"nextPage,omitempty"`
	Total    int           `json:"total"`
}

func (s *Store) ListGroups(ctx context.Context, q GroupListQuery) (*GroupListResult, error) {
	var whereConditions []string
	var args []any

	if q.Favorited {
		whereConditions = append(whereConditions, "g.favorited = 1")
	}

	if q.Q != "" {
		whereConditions = append(whereConditions, "(g.title LIKE ? OR g.author LIKE ? OR EXISTS (SELECT 1 FROM group_items gi WHERE gi.group_id = g.id AND gi.title LIKE ?))")
		args = append(args, "%"+q.Q+"%", "%"+q.Q+"%", "%"+q.Q+"%")
	}

	whereClause := ""
	if len(whereConditions) > 0 {
		whereClause = "WHERE " + strings.Join(whereConditions, " AND ")
	}

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM groups g %s", whereClause)
	if err := s.db.GetContext(ctx, &total, countQuery, args...); err != nil {
		return nil, err
	}

	orderSql := "g.favorited DESC, g.updated_at DESC, g.id DESC"
	switch q.Sort {
	case "title":
		orderSql = "g.title COLLATE NOCASE ASC, g.id ASC"
	case "chapters":
		orderSql = "(SELECT COUNT(*) FROM group_items gi2 WHERE gi2.group_id = g.id) DESC, g.updated_at DESC, g.id DESC"
	}

	all := q.Page <= 0 && q.Limit <= 0
	limit := q.Limit
	if limit <= 0 {
		limit = PageSize
	}
	page := q.Page
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	var dataQuery string
	if all {
		dataQuery = fmt.Sprintf("SELECT * FROM groups g %s ORDER BY %s", whereClause, orderSql)
	} else {
		dataQuery = fmt.Sprintf("SELECT * FROM groups g %s ORDER BY %s LIMIT ? OFFSET ?", whereClause, orderSql)
		args = append(args, limit+1, offset)
	}

	var groupRows []model.Group
	if err := s.db.SelectContext(ctx, &groupRows, dataQuery, args...); err != nil {
		return nil, err
	}

	hasNext := !all && len(groupRows) > limit
	if hasNext {
		groupRows = groupRows[:limit]
	}

	// 填充每个 group 的 items 成员
	for i := range groupRows {
		var members []model.GroupItem
		_ = s.db.SelectContext(ctx, &members, "SELECT * FROM group_items WHERE group_id = ? ORDER BY added_at ASC", groupRows[i].ID)
		if members == nil {
			members = []model.GroupItem{}
		}
		groupRows[i].Items = members
	}

	res := &GroupListResult{
		Items: groupRows,
		Total: total,
	}
	if hasNext {
		next := page + 1
		res.NextPage = &next
	}
	return res, nil
}

func (s *Store) GetGroup(ctx context.Context, id int64) (*model.Group, error) {
	var g model.Group
	err := s.db.GetContext(ctx, &g, "SELECT * FROM groups WHERE id = ?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var members []model.GroupItem
	_ = s.db.SelectContext(ctx, &members, "SELECT * FROM group_items WHERE group_id = ? ORDER BY added_at ASC", id)
	if members == nil {
		members = []model.GroupItem{}
	}
	g.Items = members
	return &g, nil
}

func (s *Store) UpsertGroup(ctx context.Context, key, title string, author, genre *string, items []model.GroupItem) (*model.Group, error) {
	if len(items) == 0 {
		return nil, errors.New("items must not be empty")
	}

	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Upsert groups
	upsertQuery := `
		INSERT INTO groups (key, title, author, genre, favorited, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			title = excluded.title,
			author = COALESCE(groups.author, excluded.author),
			genre = COALESCE(groups.genre, excluded.genre),
			updated_at = excluded.updated_at
	`
	if _, err := tx.ExecContext(ctx, upsertQuery, key, title, author, genre, now, now); err != nil {
		return nil, err
	}

	var groupID int64
	if err := tx.GetContext(ctx, &groupID, "SELECT id FROM groups WHERE key = ?", key); err != nil {
		return nil, err
	}

	// 2. 插入 items 成员
	insertItemQuery := `
		INSERT OR IGNORE INTO group_items (group_id, tid, title, added_at)
		VALUES (?, ?, ?, ?)
	`
	for _, it := range items {
		if _, err := tx.ExecContext(ctx, insertItemQuery, groupID, it.Tid, it.Title, now); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.GetGroup(ctx, groupID)
}

func (s *Store) DeleteGroup(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM groups WHERE id = ?", id)
	return err
}

func (s *Store) DeleteGroupItems(ctx context.Context, groupID int64, tids []string) (removed int64, deletedGroup bool, err error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()

	for _, tid := range tids {
		res, err := tx.ExecContext(ctx, "DELETE FROM group_items WHERE group_id = ? AND tid = ?", groupID, tid)
		if err == nil {
			r, _ := res.RowsAffected()
			removed += r
		}
	}

	var count int
	_ = tx.GetContext(ctx, &count, "SELECT COUNT(*) FROM group_items WHERE group_id = ?", groupID)
	if count == 0 {
		_, _ = tx.ExecContext(ctx, "DELETE FROM groups WHERE id = ?", groupID)
		deletedGroup = true
	}

	if err := tx.Commit(); err != nil {
		return 0, false, err
	}
	return removed, deletedGroup, nil
}

func (s *Store) ToggleGroupFavorite(ctx context.Context, id int64, fav bool) (bool, error) {
	var count int
	_ = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM groups WHERE id = ?", id)
	if count == 0 {
		return false, nil
	}

	var favVal int
	var favAt *int64
	if fav {
		favVal = 1
		now := time.Now().UnixMilli()
		favAt = &now
	}

	_, err := s.db.ExecContext(ctx, "UPDATE groups SET favorited = ?, favorited_at = ? WHERE id = ?", favVal, favAt, id)
	return true, err
}
