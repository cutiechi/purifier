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
	Title         string   `json:"title"`
	URL           string   `json:"url"`
	FirstSeenAt   int64    `json:"first_seen_at"`
	LastVisitedAt int64    `json:"last_visited_at"`
	VisitCount    int      `json:"visit_count"`
	ReadProgress  *float64 `json:"read_progress"`
	LastChapter   *int     `json:"last_chapter"`
	Favorited     bool     `json:"favorited"`
	FavoritedAt   *int64   `json:"favorited_at,omitempty"`
	Tags          []string `json:"tags"`
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
	return state, nil
}
