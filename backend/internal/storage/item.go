package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"
	"purifier/internal/model"
)

type Store struct {
	db *sqlx.DB
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

func (s *Store) DB() *sqlx.DB {
	return s.db
}

// RecordVisit 记录条目访问并自增计数
func (s *Store) RecordVisit(ctx context.Context, site string, kind model.ItemKind, id, title, url string) error {
	now := time.Now().UnixMilli()
	query := `
		INSERT INTO items (site, kind, id, title, url, first_seen_at, last_visited_at, visit_count)
		VALUES (?, ?, ?, COALESCE(NULLIF(?, ''), ?), ?, ?, ?, 1)
		ON CONFLICT(site, kind, id) DO UPDATE SET
			title = COALESCE(NULLIF(excluded.title, ''), items.title),
			url = excluded.url,
			last_visited_at = excluded.last_visited_at,
			visit_count = items.visit_count + 1
	`
	_, err := s.db.ExecContext(ctx, query, site, string(kind), id, title, url, url, now, now)
	return err
}

// SetProgress 更新阅读进度 (0.0 ~ 1.0)
func (s *Store) SetProgress(ctx context.Context, site string, kind model.ItemKind, id string, progress float64, chapter *int) (bool, error) {
	var count int
	err := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM items WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}

	if progress < 0 {
		progress = 0
	} else if progress > 1 {
		progress = 1
	}

	if chapter != nil {
		_, err = s.db.ExecContext(ctx,
			"UPDATE items SET read_progress = ?, last_chapter = ? WHERE site = ? AND kind = ? AND id = ?",
			progress, *chapter, site, string(kind), id,
		)
	} else {
		_, err = s.db.ExecContext(ctx,
			"UPDATE items SET read_progress = ? WHERE site = ? AND kind = ? AND id = ?",
			progress, site, string(kind), id,
		)
	}
	return true, err
}

// ItemState 表示单个条目的综合阅读与收藏状态
type ItemState struct {
	Site          string   `json:"site"`
	Kind          string   `json:"kind"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	URL           string   `json:"url"`
	FirstSeenAt   int64    `json:"first_seen_at"`
	LastVisitedAt int64    `json:"last_visited_at"`
	VisitCount    int      `json:"visit_count"`
	ReadProgress  *float64 `json:"read_progress"`
	LastChapter   *int     `json:"lastChapter"`
	Favorited     bool     `json:"favorited"`
	FavoritedAt   *int64   `json:"favorited_at,omitempty"`
	Tags          []string `json:"tags"`
	GroupID       *int64   `json:"groupId,omitempty"`
	GroupTitle    *string  `json:"groupTitle,omitempty"`
}

// GetState 获取条目访问、收藏和标签状态
func (s *Store) GetState(ctx context.Context, site string, kind model.ItemKind, id string) (*ItemState, error) {
	var item model.Item
	err := s.db.GetContext(ctx, &item, "SELECT * FROM items WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var favoritedAt sql.NullInt64
	err = s.db.GetContext(ctx, &favoritedAt, "SELECT favorited_at FROM favorites WHERE site = ? AND kind = ? AND id = ?", site, string(kind), id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	var tags []string
	err = s.db.SelectContext(ctx, &tags, "SELECT tag FROM tags WHERE site = ? AND kind = ? AND id = ? ORDER BY created_at ASC", site, string(kind), id)
	if err != nil {
		return nil, err
	}
	if tags == nil {
		tags = []string{}
	}

	state := &ItemState{
		Site:          site,
		Kind:          string(kind),
		ID:            id,
		Title:         item.Title,
		URL:           item.URL,
		FirstSeenAt:   item.FirstSeenAt,
		LastVisitedAt: item.LastVisitedAt,
		VisitCount:    item.VisitCount,
		ReadProgress:  item.ReadProgress,
		LastChapter:   item.LastChapter,
		Favorited:     favoritedAt.Valid,
		Tags:          tags,
	}
	if favoritedAt.Valid {
		val := favoritedAt.Int64
		state.FavoritedAt = &val
	}

	// 帖子所属分组（仅 post 可能有；tid 同时只属一个分组）
	if kind == model.KindPost {
		var groupID int64
		var groupTitle string
		rowErr := s.db.QueryRowContext(ctx,
			`SELECT g.id, g.title FROM groups g
			 JOIN group_items gi ON gi.group_id = g.id
			 WHERE gi.tid = ? ORDER BY g.id LIMIT 1`, id).Scan(&groupID, &groupTitle)
		if rowErr == nil {
			state.GroupID = &groupID
			state.GroupTitle = &groupTitle
		} else if !errors.Is(rowErr, sql.ErrNoRows) {
			return nil, rowErr
		}
	}

	return state, nil
}

// LinkStat 正文页链接导航面板的目标聚合：访问计数/最后打开来自 items，
// 累计阅读时长与最近一次阅读来自 reading_sessions。
type LinkStat struct {
	ID             string `json:"id" db:"id"`
	Title          string `json:"title" db:"title"`
	VisitCount     int    `json:"visitCount" db:"visit_count"`
	LastVisitedAt  *int64 `json:"lastVisitedAt" db:"last_visited_at"`
	TotalDurationS int64  `json:"totalDurationS" db:"total_duration_s"`
	LastReadAt     *int64 `json:"lastReadAt" db:"last_read_at"`
}

// GetLinkStats 批量返回链接目标的访问与阅读聚合；从未访问过的目标不在结果中，
// 由调用方补零。两个 IN 查询在应用层按 id 合并（sqlite 端无需 join 聚合表）。
func (s *Store) GetLinkStats(ctx context.Context, site string, kind model.ItemKind, ids []string) ([]LinkStat, error) {
	if len(ids) == 0 {
		return []LinkStat{}, nil
	}
	itemQuery, itemArgs, err := sqlxIn(
		"SELECT id, title, visit_count, last_visited_at FROM items WHERE site = ? AND kind = ? AND id IN (?)",
		site, string(kind), ids)
	if err != nil {
		return nil, err
	}
	var rows []LinkStat
	if err := s.db.SelectContext(ctx, &rows, itemQuery, itemArgs...); err != nil {
		return nil, err
	}

	sessQuery, sessArgs, err := sqlxIn(
		"SELECT item_id AS id, COALESCE(SUM(duration_s), 0) AS total_duration_s, MAX(started_at) AS last_read_at"+
			" FROM reading_sessions WHERE site = ? AND kind = ? AND item_id IN (?) GROUP BY item_id",
		site, string(kind), ids)
	if err != nil {
		return nil, err
	}
	var sess []struct {
		ID             string `db:"id"`
		TotalDurationS int64  `db:"total_duration_s"`
		LastReadAt     *int64 `db:"last_read_at"`
	}
	if err := s.db.SelectContext(ctx, &sess, sessQuery, sessArgs...); err != nil {
		return nil, err
	}

	index := make(map[string]int, len(rows))
	for i, r := range rows {
		index[r.ID] = i
	}
	for _, row := range sess {
		if i, ok := index[row.ID]; ok {
			rows[i].TotalDurationS = row.TotalDurationS
			rows[i].LastReadAt = row.LastReadAt
		}
	}
	if rows == nil {
		rows = []LinkStat{}
	}
	return rows, nil
}
