package storage

import (
	"context"
	"time"

	"purifier/internal/model"
)

// FrontierItem 是链接发现前沿的一条待归档帖子。
// state: pending | done | nocontent | error
type FrontierItem struct {
	Site         string  `db:"site"`
	Tid          string  `db:"tid"`
	SourceTid    *string `db:"source_tid"`
	Depth        int     `db:"depth"`
	State        string  `db:"state"`
	Attempts     int     `db:"attempts"`
	DiscoveredAt int64   `db:"discovered_at"`
	UpdatedAt    int64   `db:"updated_at"`
}

// EnqueueFrontier 批量入队（同 (site,tid) 去重，已存在行不覆盖）。
// 返回真正新增的行数。
func (s *Store) EnqueueFrontier(ctx context.Context, site string, tids []string, sourceTid string, depth int) (int, error) {
	if len(tids) == 0 {
		return 0, nil
	}
	now := time.Now().UnixMilli()
	var src *string
	if sourceTid != "" {
		src = &sourceTid
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.PreparexContext(ctx, `
		INSERT OR IGNORE INTO archive_frontier
			(site, tid, source_tid, depth, state, attempts, discovered_at, updated_at)
		VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	added := 0
	for _, tid := range tids {
		if tid == "" {
			continue
		}
		res, err := stmt.ExecContext(ctx, site, tid, src, depth, now, now)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}
	return added, tx.Commit()
}

// ClaimFrontierBatch 取出最早的待处理条目（只读，不改变状态；
// 任务单飞保证同一时刻只有一个消费者，重复处理由 upsert 幂等兜底）。
func (s *Store) ClaimFrontierBatch(ctx context.Context, site string, limit int) ([]FrontierItem, error) {
	if limit <= 0 {
		limit = 50
	}
	items := []FrontierItem{}
	err := s.db.SelectContext(ctx, &items, `
		SELECT site, tid, source_tid, depth, state, attempts, discovered_at, updated_at
		FROM archive_frontier
		WHERE site = ? AND state = 'pending'
		ORDER BY discovered_at ASC, tid DESC
		LIMIT ?`, site, limit)
	if err != nil {
		return nil, err
	}
	return items, nil
}

// MarkFrontier 更新条目状态与累计失败次数。
func (s *Store) MarkFrontier(ctx context.Context, site, tid, state string, attempts int) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE archive_frontier
		SET state = ?, attempts = ?, updated_at = ?
		WHERE site = ? AND tid = ?`, state, attempts, time.Now().UnixMilli(), site, tid)
	return err
}

// GetFrontier 读取单条前沿记录（不存在返回 nil）。
func (s *Store) GetFrontier(ctx context.Context, site, tid string) (*FrontierItem, error) {
	var it FrontierItem
	err := s.db.GetContext(ctx, &it, `
		SELECT site, tid, source_tid, depth, state, attempts, discovered_at, updated_at
		FROM archive_frontier WHERE site = ? AND tid = ?`, site, tid)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// FrontierCounts 返回待处理数与总条目数（任务摘要/排障用）。
func (s *Store) FrontierCounts(ctx context.Context, site string) (pending, total int, err error) {
	if err = s.db.GetContext(ctx, &pending,
		"SELECT COUNT(*) FROM archive_frontier WHERE site = ? AND state = 'pending'", site); err != nil {
		return 0, 0, err
	}
	if err = s.db.GetContext(ctx, &total,
		"SELECT COUNT(*) FROM archive_frontier WHERE site = ?", site); err != nil {
		return 0, 0, err
	}
	return pending, total, nil
}

// ArchiveExistingTids 返回给定 tid 中已在归档目录里的集合（批量 IN 查询）。
func (s *Store) ArchiveExistingTids(ctx context.Context, site string, tids []string) (map[string]bool, error) {
	out := make(map[string]bool, len(tids))
	if len(tids) == 0 {
		return out, nil
	}
	query, args, err := sqlxIn("SELECT tid FROM archive_posts WHERE site = ? AND tid IN (?)", site, tids)
	if err != nil {
		return out, err
	}
	var rows []string
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return out, err
	}
	for _, tid := range rows {
		out[tid] = true
	}
	return out, nil
}

// ArchivePostsForHarvest 按数字 tid 倒序取已归档帖子（回填模式用；fromTid 为空表示从最新开始）。
func (s *Store) ArchivePostsForHarvest(ctx context.Context, site, fromTid string, limit int) ([]model.ArchivePost, error) {
	if limit <= 0 {
		limit = 200
	}
	items := []model.ArchivePost{}
	var err error
	if fromTid == "" {
		err = s.db.SelectContext(ctx, &items, `
			SELECT site, tid, title, first_seen_at, archived_at
			FROM archive_posts WHERE site = ?
			ORDER BY CAST(tid AS INTEGER) DESC LIMIT ?`, site, limit)
	} else {
		err = s.db.SelectContext(ctx, &items, `
			SELECT site, tid, title, first_seen_at, archived_at
			FROM archive_posts WHERE site = ? AND CAST(tid AS INTEGER) < CAST(? AS INTEGER)
			ORDER BY CAST(tid AS INTEGER) DESC LIMIT ?`, site, fromTid, limit)
	}
	if err != nil {
		return nil, err
	}
	return items, nil
}
