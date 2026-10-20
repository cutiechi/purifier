package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"purifier/internal/model"
)

// ErrTidInOtherGroup 表示请求里的 tid 已属于另一个分组。
// 分组归属是全局唯一的（group_items.tid 唯一索引），调用方应映射为 409。
var ErrTidInOtherGroup = errors.New("tid already in another group")

// GroupListQuery 分组列表查询。分页强制生效，limit 默认 PageSize、上限 100。
type GroupListQuery struct {
	Q         string
	Favorited bool
	Sort      string // "updated", "title", "chapters"
	Page      int
	Limit     int
	// Key 精确匹配分组 key（前端按书名键取单个分组，避免拉全量）
	Key string
}

type GroupListResult struct {
	Items    []model.Group `json:"items"`
	NextPage *int          `json:"nextPage,omitempty"`
	Total    int           `json:"total"`
}

const groupMaxLimit = 100

func (s *Store) ListGroups(ctx context.Context, q GroupListQuery) (*GroupListResult, error) {
	var whereConditions []string
	var args []any

	if q.Favorited {
		whereConditions = append(whereConditions, "g.favorited = 1")
	}
	if q.Key != "" {
		whereConditions = append(whereConditions, "g.key = ?")
		args = append(args, q.Key)
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

	limit := q.Limit
	if limit <= 0 {
		limit = PageSize
	} else if limit > groupMaxLimit {
		limit = groupMaxLimit
	}
	page := q.Page
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	dataQuery := fmt.Sprintf("SELECT * FROM groups g %s ORDER BY %s LIMIT ? OFFSET ?", whereClause, orderSql)
	pageArgs := append(append([]any{}, args...), limit+1, offset)

	var groupRows []model.Group
	if err := s.db.SelectContext(ctx, &groupRows, dataQuery, pageArgs...); err != nil {
		return nil, err
	}

	hasNext := len(groupRows) > limit
	if hasNext {
		groupRows = groupRows[:limit]
	}
	if groupRows == nil {
		groupRows = []model.Group{}
	}

	if err := s.fillGroupItems(ctx, groupRows); err != nil {
		return nil, err
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

// fillGroupItems 用一条 IN 查询批量填充成员，避免每组一次往返。
func (s *Store) fillGroupItems(ctx context.Context, groups []model.Group) error {
	if len(groups) == 0 {
		return nil
	}
	ids := make([]int64, len(groups))
	byID := make(map[int64]*model.Group, len(groups))
	for i := range groups {
		ids[i] = groups[i].ID
		byID[groups[i].ID] = &groups[i]
		groups[i].Items = []model.GroupItem{}
	}

	query, args, err := sqlxIn("SELECT * FROM group_items WHERE group_id IN (?) ORDER BY added_at ASC, tid ASC", ids)
	if err != nil {
		return err
	}
	var members []model.GroupItem
	if err := s.db.SelectContext(ctx, &members, query, args...); err != nil {
		return err
	}
	for _, m := range members {
		if g, ok := byID[m.GroupID]; ok {
			g.Items = append(g.Items, m)
		}
	}
	return nil
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
	if err := s.db.SelectContext(ctx, &members,
		"SELECT * FROM group_items WHERE group_id = ? ORDER BY added_at ASC, tid ASC", id); err != nil {
		return nil, err
	}
	if members == nil {
		members = []model.GroupItem{}
	}
	g.Items = members
	return &g, nil
}

// UpsertGroup 按 key upsert 分组，并把成员整体替换为 items。
// 传入的 tid 若已属于其它分组，返回 ErrTidInOtherGroup（映射 409）。
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

	tids := make([]string, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, it := range items {
		if it.Tid == "" || seen[it.Tid] {
			continue
		}
		seen[it.Tid] = true
		tids = append(tids, it.Tid)
	}
	if len(tids) == 0 {
		return nil, errors.New("items must not be empty")
	}

	// 跨组冲突：任何 tid 已挂在别的分组上，整单拒绝（不静默吞掉）。
	conflictQuery, conflictArgs, err := sqlxIn(
		"SELECT COUNT(*) FROM group_items WHERE tid IN (?) AND group_id <> ?", tids, groupID)
	if err != nil {
		return nil, err
	}
	var conflicts int
	if err := tx.GetContext(ctx, &conflicts, conflictQuery, conflictArgs...); err != nil {
		return nil, err
	}
	if conflicts > 0 {
		return nil, ErrTidInOtherGroup
	}

	// 全量替换：移出本次列表之外的成员。
	delQuery, delArgs, err := sqlxIn(
		"DELETE FROM group_items WHERE group_id = ? AND tid NOT IN (?)", groupID, tids)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, delQuery, delArgs...); err != nil {
		return nil, err
	}

	insertItemQuery := `
		INSERT INTO group_items (group_id, tid, title, added_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(group_id, tid) DO UPDATE SET title = excluded.title
	`
	for _, it := range items {
		if it.Tid == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, insertItemQuery, groupID, it.Tid, it.Title, now); err != nil {
			// 两个并发 upsert 都数到 0 冲突时，输家会在这里撞唯一索引
			// （deferred 事务看不到对方未提交的行）。语义上仍是跨组冲突。
			if isUniqueViolation(err) {
				return nil, ErrTidInOtherGroup
			}
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.GetGroup(ctx, groupID)
}

// GetGroupByKey 按 key 取分组（含成员）；不存在返回 (nil, nil)。
func (s *Store) GetGroupByKey(ctx context.Context, key string) (*model.Group, error) {
	var id int64
	err := s.db.GetContext(ctx, &id, "SELECT id FROM groups WHERE key = ?", key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, id)
}

// EnsureGroupMembers 是自动分组任务专用：只补缺失成员，绝不删除已有成员。
//
// 与 UpsertGroup 的差别是安全边界：UpsertGroup 供用户显式编辑（全量替换），
// 而自动任务跑在用户手工维护的分组上，删成员等于静默数据丢失。
// 已属于其它分组的 tid 跳过并计入 skipped，不报错。
func (s *Store) EnsureGroupMembers(ctx context.Context, key, title string, author, genre *string, items []model.GroupItem) (added int, skipped int, err error) {
	if len(items) == 0 {
		return 0, 0, nil
	}

	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	// 已存在则只补 title/author/genre 的空缺，不覆盖用户改过的标题。
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO groups (key, title, author, genre, favorited, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			author = COALESCE(groups.author, excluded.author),
			genre  = COALESCE(groups.genre, excluded.genre),
			updated_at = excluded.updated_at`, key, title, author, genre, now, now); err != nil {
		return 0, 0, err
	}

	var groupID int64
	if err := tx.GetContext(ctx, &groupID, "SELECT id FROM groups WHERE key = ?", key); err != nil {
		return 0, 0, err
	}

	insertQuery := `
		INSERT INTO group_items (group_id, tid, title, added_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(group_id, tid) DO NOTHING
	`
	seen := make(map[string]bool, len(items))
	for _, it := range items {
		if it.Tid == "" || seen[it.Tid] {
			continue
		}
		seen[it.Tid] = true

		// 先看这个 tid 是否已在别的组：是则跳过，不抢用户的归属。
		var owner int64
		err := tx.GetContext(ctx, &owner,
			"SELECT group_id FROM group_items WHERE tid = ? LIMIT 1", it.Tid)
		if err == nil {
			if owner != groupID {
				skipped++
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, 0, err
		}

		res, err := tx.ExecContext(ctx, insertQuery, groupID, it.Tid, it.Title, now)
		if err != nil {
			if isUniqueViolation(err) {
				// 并发插入同一 tid：对方赢了，本组跳过。
				skipped++
				continue
			}
			return 0, 0, err
		}
		if n, err := res.RowsAffected(); err == nil && n > 0 {
			added++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return added, skipped, nil
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
		if err != nil {
			return 0, false, err
		}
		r, err := res.RowsAffected()
		if err != nil {
			return 0, false, err
		}
		removed += r
	}

	// 计数失败必须返回错误：把失败当成 0 会在下一次判断里删掉整个分组。
	var count int
	if err := tx.GetContext(ctx, &count, "SELECT COUNT(*) FROM group_items WHERE group_id = ?", groupID); err != nil {
		return 0, false, err
	}
	if count == 0 {
		if _, err := tx.ExecContext(ctx, "DELETE FROM groups WHERE id = ?", groupID); err != nil {
			return 0, false, err
		}
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

// isUniqueViolation 判断错误是否来自唯一约束冲突。
// modernc sqlite 的扩展错误码是 2067（SQLITE_CONSTRAINT_UNIQUE）。
func isUniqueViolation(err error) bool {
	var serr *sqlite.Error
	if !errors.As(err, &serr) {
		return false
	}
	return serr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE ||
		serr.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY
}
