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

type JobListQuery struct {
	Type   string
	Status string // "active" (running|paused|pending), "finished" (finished|error), or exact status
	Sort   string // created_at, type, status, duration
	Order  string // asc, desc
	Limit  int    // default 20, max 100
	Offset int
}

type JobListResult struct {
	Items    []model.Job `json:"items"`
	NextPage *int        `json:"nextPage,omitempty"`
	Total    int         `json:"total"`
}

type CursorInfo struct {
	Site      string  `json:"site" db:"site"`
	NextMtid  *string `json:"next_mtid" db:"next_mtid"`
	Mode      string  `json:"mode" db:"mode"`
	Status    string  `json:"status" db:"status"`
	Pages     int     `json:"pages" db:"pages"`
	UpdatedAt int64   `json:"updated_at" db:"updated_at"`
}

// CreateJob 创建一个 pending 状态任务
func (s *Store) CreateJob(ctx context.Context, jobType string, payload *string) (*model.Job, error) {
	now := time.Now().UnixMilli()
	query := `
		INSERT INTO jobs (type, status, payload, created_at)
		VALUES (?, ?, ?, ?)
	`
	res, err := s.db.ExecContext(ctx, query, jobType, model.JobStatusPending, payload, now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetJob(ctx, id)
}

// GetJob 查询单个任务
func (s *Store) GetJob(ctx context.Context, id int64) (*model.Job, error) {
	var j model.Job
	err := s.db.GetContext(ctx, &j, "SELECT * FROM jobs WHERE id = ?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &j, err
}

// HasRunningOfType 检查同类型任务是否已在运行或挂起
func (s *Store) HasRunningOfType(ctx context.Context, jobType string) (bool, error) {
	var count int
	err := s.db.GetContext(ctx, &count,
		"SELECT COUNT(*) FROM jobs WHERE type = ? AND status IN ('running', 'paused', 'pending')",
		jobType,
	)
	return count > 0, err
}

// MarkRunning 标记任务开始执行
func (s *Store) MarkRunning(ctx context.Context, id int64) (bool, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx,
		"UPDATE jobs SET status = ?, started_at = ? WHERE id = ? AND status = ?",
		model.JobStatusRunning, now, id, model.JobStatusPending,
	)
	if err != nil {
		return false, err
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

// MarkPaused 标记任务挂起
func (s *Store) MarkPaused(ctx context.Context, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx,
		"UPDATE jobs SET status = ? WHERE id = ? AND status = ?",
		model.JobStatusPaused, id, model.JobStatusRunning,
	)
	if err != nil {
		return false, err
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

// MarkResumed 标记任务恢复运行
func (s *Store) MarkResumed(ctx context.Context, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx,
		"UPDATE jobs SET status = ? WHERE id = ? AND status = ?",
		model.JobStatusRunning, id, model.JobStatusPaused,
	)
	if err != nil {
		return false, err
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

// UpdateJobResult 更新进度 result 字段
func (s *Store) UpdateJobResult(ctx context.Context, id int64, result string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE jobs SET result = ? WHERE id = ?", result, id)
	return err
}

// MarkFinished 标记任务终态
func (s *Store) MarkFinished(ctx context.Context, id int64, status model.JobStatus, result, errMsg *string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx,
		"UPDATE jobs SET status = ?, result = COALESCE(?, result), error = ?, finished_at = ? WHERE id = ?",
		status, result, errMsg, now, id,
	)
	return err
}

// ListJobs 分页筛选任务列表
func (s *Store) ListJobs(ctx context.Context, q JobListQuery) (*JobListResult, error) {
	if q.Limit <= 0 {
		q.Limit = 20
	} else if q.Limit > 100 {
		q.Limit = 100
	}

	var conditions []string
	var args []any

	if q.Type != "" {
		conditions = append(conditions, "type = ?")
		args = append(args, q.Type)
	}

	if q.Status == "active" {
		conditions = append(conditions, "status IN ('running', 'paused', 'pending')")
	} else if q.Status == "finished" {
		conditions = append(conditions, "status IN ('finished', 'error')")
	} else if q.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, q.Status)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM jobs %s", whereClause)
	if err := s.db.GetContext(ctx, &total, countQuery, args...); err != nil {
		return nil, err
	}

	order := "DESC"
	if strings.ToLower(q.Order) == "asc" {
		order = "ASC"
	}

	sortCol := "created_at"
	switch q.Sort {
	case "type":
		sortCol = "type"
	case "status":
		sortCol = "status"
	case "duration":
		sortCol = "(COALESCE(finished_at, started_at, created_at) - COALESCE(started_at, created_at))"
	}

	dataQuery := fmt.Sprintf("SELECT * FROM jobs %s ORDER BY %s %s LIMIT ? OFFSET ?", whereClause, sortCol, order)
	args = append(args, q.Limit, q.Offset)

	var items []model.Job
	if err := s.db.SelectContext(ctx, &items, dataQuery, args...); err != nil {
		return nil, err
	}
	if items == nil {
		items = []model.Job{}
	}

	return &JobListResult{
		Items: items,
		Total: total,
	}, nil
}

// DeleteFinishedJob 删除已结束任务
func (s *Store) DeleteFinishedJob(ctx context.Context, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx,
		"DELETE FROM jobs WHERE id = ? AND status IN ('finished', 'error')",
		id,
	)
	if err != nil {
		return false, err
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

// DeleteFinishedJobsBatch 批量删除已结束任务
func (s *Store) DeleteFinishedJobsBatch(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}

	// 检查是否包含活动任务
	query, args, err := sqlxIn("SELECT COUNT(*) FROM jobs WHERE id IN (?) AND status NOT IN ('finished', 'error')", ids)
	if err != nil {
		return 0, err
	}
	var activeCount int
	if err := s.db.GetContext(ctx, &activeCount, query, args...); err != nil {
		return 0, err
	}
	if activeCount > 0 {
		return 0, errors.New("contains active jobs")
	}

	delQuery, delArgs, err := sqlxIn("DELETE FROM jobs WHERE id IN (?)", ids)
	if err != nil {
		return 0, err
	}
	res, err := s.db.ExecContext(ctx, delQuery, delArgs...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// AddJobLog 添加任务日志
func (s *Store) AddJobLog(ctx context.Context, jobID int64, level, message string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO job_logs (job_id, level, message, created_at) VALUES (?, ?, ?, ?)",
		jobID, level, message, now,
	)
	return err
}

// ListJobLogs 查询日志
func (s *Store) ListJobLogs(ctx context.Context, jobID int64, limit, offset int, level, order string) ([]model.JobLog, error) {
	if limit <= 0 {
		limit = 200
	} else if limit > 1000 {
		limit = 1000
	}

	var conditions []string
	args := []any{jobID}
	conditions = append(conditions, "job_id = ?")

	if level != "" {
		conditions = append(conditions, "level = ?")
		args = append(args, level)
	}

	ord := "ASC"
	if strings.ToUpper(order) == "DESC" {
		ord = "DESC"
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")
	query := fmt.Sprintf("SELECT * FROM job_logs %s ORDER BY created_at %s LIMIT ? OFFSET ?", whereClause, ord)
	args = append(args, limit, offset)

	var logs []model.JobLog
	if err := s.db.SelectContext(ctx, &logs, query, args...); err != nil {
		return nil, err
	}
	if logs == nil {
		logs = []model.JobLog{}
	}
	return logs, nil
}

// SetArchiveCursor 设置归档游标
func (s *Store) SetArchiveCursor(ctx context.Context, site, nextMtid, mode, status string, pages int) error {
	now := time.Now().UnixMilli()
	query := `
		INSERT INTO archive_cursors (site, next_mtid, mode, status, pages, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(site) DO UPDATE SET
			next_mtid = excluded.next_mtid,
			mode = excluded.mode,
			status = excluded.status,
			pages = excluded.pages,
			updated_at = excluded.updated_at
	`
	_, err := s.db.ExecContext(ctx, query, site, nextMtid, mode, status, pages, now)
	return err
}

// GetArchiveCursor 读取归档游标
func (s *Store) GetArchiveCursor(ctx context.Context, site string) (*CursorInfo, error) {
	var c CursorInfo
	err := s.db.GetContext(ctx, &c, "SELECT * FROM archive_cursors WHERE site = ?", site)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// UpsertArchivePosts 批量保存归档帖子
func (s *Store) UpsertArchivePosts(ctx context.Context, posts []model.ArchivePost) error {
	if len(posts) == 0 {
		return nil
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PreparexContext(ctx, `
		INSERT INTO archive_posts (site, tid, title, first_seen_at, archived_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(site, tid) DO UPDATE SET
			title = excluded.title,
			archived_at = excluded.archived_at
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range posts {
		if _, err := stmt.ExecContext(ctx, p.Site, p.Tid, p.Title, p.FirstSeenAt, p.ArchivedAt); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func sqlxIn(query string, params ...any) (string, []any, error) {
	// 简单的 IN 参数展开 helper
	var qb strings.Builder
	paramIdx := 0
	var finalArgs []any

	for i := 0; i < len(query); i++ {
		if query[i] == '?' && paramIdx < len(params) {
			val := params[paramIdx]
			paramIdx++
			if slice, ok := val.([]int64); ok {
				placeholders := make([]string, len(slice))
				for sIdx, item := range slice {
					placeholders[sIdx] = "?"
					finalArgs = append(finalArgs, item)
				}
				qb.WriteString(strings.Join(placeholders, ","))
			} else {
				qb.WriteByte('?')
				finalArgs = append(finalArgs, val)
			}
		} else {
			qb.WriteByte(query[i])
		}
	}
	return qb.String(), finalArgs, nil
}
