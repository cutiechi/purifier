package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
)

type SessionInput struct {
	Site      string         `json:"site"`
	Kind      model.ItemKind `json:"kind"`
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	StartedAt int64          `json:"startedAt"`
	DurationS int            `json:"durationS"`
}

type StatsSummary struct {
	TotalDurationS int    `json:"totalDurationS"`
	CurrentStreak  int    `json:"currentStreak"`
	LongestStreak  int    `json:"longestStreak"`
	ActiveDays     int    `json:"activeDays"`
	ThisWeekS      int    `json:"thisWeekS"`
	ThisMonthS     int    `json:"thisMonthS"`
	TrackedSince   *int64 `json:"trackedSince"`
	LastActiveAt   *int64 `json:"lastActiveAt"`
}

type CalendarDay struct {
	Date      string `json:"date" db:"d"`
	DurationS int    `json:"durationS" db:"s"`
	Estimated int    `json:"estimated" db:"est"`
}

type TopItem struct {
	Site      string         `json:"site" db:"site"`
	Kind      model.ItemKind `json:"kind" db:"kind"`
	ID        string         `json:"id" db:"id"`
	Title     string         `json:"title" db:"title"`
	DurationS int            `json:"durationS" db:"duration_s"`
	Sessions  int            `json:"sessions" db:"sessions"`
}

type Inventory struct {
	History    int `json:"history"`
	Favorites  int `json:"favorites"`
	Tags       int `json:"tags"`
	Groups     int `json:"groups"`
	Characters int `json:"characters"`
	Bookmarks  int `json:"bookmarks"`
}

type StatsResult struct {
	Summary        StatsSummary    `json:"summary"`
	Calendar       []CalendarDay   `json:"calendar"`
	TimeOfDay      []int           `json:"timeOfDay"`
	TopItems       []TopItem       `json:"topItems"`
	RecentSessions []RecentSession `json:"recentSessions"`
	Inventory      Inventory       `json:"inventory"`
}

// RecentSession 最近阅读条目（与前端契约一致）
type RecentSession struct {
	StartedAt int64          `json:"startedAt" db:"started_at"`
	DurationS int            `json:"durationS" db:"duration_s"`
	Kind      model.ItemKind `json:"kind" db:"kind"`
	Site      string         `json:"site" db:"site"`
	ID        string         `json:"id" db:"id"`
	Title     string         `json:"title" db:"title"`
}

// RecordSession 记录一段阅读时长
func (s *Store) RecordSession(ctx context.Context, input SessionInput) error {
	if input.DurationS < 3 {
		return nil // 小于 3 秒丢弃
	}
	if input.DurationS > 300 {
		input.DurationS = 300 // clamp 最大 5 分钟
	}
	if input.Site == "" {
		input.Site = "1"
	}
	if err := upstream.AssertSafeID(input.Site); err != nil {
		return ErrInvalidInput
	}
	if input.Kind != model.KindPost && input.Kind != model.KindBook {
		return ErrInvalidInput
	}
	if err := upstream.AssertSafeID(input.ID); err != nil {
		return ErrInvalidInput
	}
	if input.StartedAt <= 0 {
		return ErrInvalidInput
	}

	query := `
		INSERT INTO reading_sessions (site, kind, item_id, title, started_at, duration_s, estimated)
		VALUES (?, ?, ?, ?, ?, ?, 0)
	`
	_, err := s.db.ExecContext(ctx, query, input.Site, string(input.Kind), input.ID, input.Title, input.StartedAt, input.DurationS)
	return err
}

// GetStats 综合统计数据
func (s *Store) GetStats(ctx context.Context, site string) (*StatsResult, error) {
	siteCond := ""
	var args []any
	if site != "" {
		siteCond = "WHERE site = ?"
		args = append(args, site)
	}

	// 1. Inventory 资产总数
	var inv Inventory
	if site != "" {
		_ = s.db.GetContext(ctx, &inv.History, "SELECT COUNT(*) FROM items WHERE site = ?", site)
		_ = s.db.GetContext(ctx, &inv.Favorites, "SELECT COUNT(*) FROM favorites WHERE site = ?", site)
		_ = s.db.GetContext(ctx, &inv.Tags, "SELECT COUNT(*) FROM tags WHERE site = ?", site)
		_ = s.db.GetContext(ctx, &inv.Bookmarks, "SELECT COUNT(*) FROM bookmarks WHERE site = ?", site)
		_ = s.db.GetContext(ctx, &inv.Groups, "SELECT COUNT(*) FROM groups")
		_ = s.db.GetContext(ctx, &inv.Characters, "SELECT COUNT(*) FROM character_names")
	} else {
		_ = s.db.GetContext(ctx, &inv.History, "SELECT COUNT(*) FROM items")
		_ = s.db.GetContext(ctx, &inv.Favorites, "SELECT COUNT(*) FROM favorites")
		_ = s.db.GetContext(ctx, &inv.Tags, "SELECT COUNT(*) FROM tags")
		_ = s.db.GetContext(ctx, &inv.Bookmarks, "SELECT COUNT(*) FROM bookmarks")
		_ = s.db.GetContext(ctx, &inv.Groups, "SELECT COUNT(*) FROM groups")
		_ = s.db.GetContext(ctx, &inv.Characters, "SELECT COUNT(*) FROM character_names")
	}

	// 2. Summary：总时长 + 本周/本月 + 起止时间
	var totalSec int
	summaryQuery := fmt.Sprintf(`
		SELECT COALESCE(SUM(duration_s), 0)
		FROM reading_sessions %s
	`, siteCond)
	_ = s.db.QueryRowContext(ctx, summaryQuery, args...).Scan(&totalSec)

	nowLocal := time.Now()
	weekStart := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, nowLocal.Location()).
		AddDate(0, 0, -int(nowLocal.Weekday()+6)%7)
	monthStart := time.Date(nowLocal.Year(), nowLocal.Month(), 1, 0, 0, 0, 0, nowLocal.Location())

	weekCond := "WHERE started_at >= ?"
	weekArgs := []any{weekStart.UnixMilli()}
	monthCond := "WHERE started_at >= ?"
	monthArgs := []any{monthStart.UnixMilli()}
	rangeCond := ""
	var rangeArgs []any
	if site != "" {
		weekCond = "WHERE site = ? AND started_at >= ?"
		weekArgs = []any{site, weekStart.UnixMilli()}
		monthCond = "WHERE site = ? AND started_at >= ?"
		monthArgs = []any{site, monthStart.UnixMilli()}
		rangeCond = "WHERE site = ?"
		rangeArgs = []any{site}
	}

	var thisWeekS, thisMonthS int
	_ = s.db.QueryRowContext(ctx, fmt.Sprintf("SELECT COALESCE(SUM(duration_s), 0) FROM reading_sessions %s", weekCond), weekArgs...).Scan(&thisWeekS)
	_ = s.db.QueryRowContext(ctx, fmt.Sprintf("SELECT COALESCE(SUM(duration_s), 0) FROM reading_sessions %s", monthCond), monthArgs...).Scan(&thisMonthS)

	var trackedSince, lastActiveAt sql.NullInt64
	_ = s.db.QueryRowContext(ctx, fmt.Sprintf("SELECT MIN(started_at), MAX(started_at) FROM reading_sessions %s", rangeCond), rangeArgs...).Scan(&trackedSince, &lastActiveAt)

	// 3. Calendar (近 365 天)
	sinceMs := time.Now().AddDate(0, 0, -364).UnixMilli()
	calCond := "WHERE started_at >= ?"
	calArgs := []any{sinceMs}
	if site != "" {
		calCond = "WHERE site = ? AND started_at >= ?"
		calArgs = []any{site, sinceMs}
	}

	calQuery := fmt.Sprintf(`
		SELECT strftime('%%Y-%%m-%%d', started_at / 1000, 'unixepoch', 'localtime') AS d,
		       COALESCE(SUM(duration_s), 0) AS s,
		       0 AS est
		FROM reading_sessions
		%s
		GROUP BY d ORDER BY d ASC
	`, calCond)

	var calendar []CalendarDay
	_ = s.db.SelectContext(ctx, &calendar, calQuery, calArgs...)
	if calendar == nil {
		calendar = []CalendarDay{}
	}

	// 计算连续天数
	activeDays := len(calendar)
	currStreak := 0
	longStreak := 0
	todayStr := time.Now().Format("2006-01-02")
	dateSet := make(map[string]bool)
	for _, d := range calendar {
		dateSet[d.Date] = true
	}

	// 倒推当前连读
	checkDay := todayStr
	if !dateSet[checkDay] {
		checkDay = time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	}
	for dateSet[checkDay] {
		currStreak++
		t, _ := time.Parse("2006-01-02", checkDay)
		checkDay = t.AddDate(0, 0, -1).Format("2006-01-02")
	}
	longStreak = currStreak
	if activeDays > longStreak {
		longStreak = activeDays
	}

	// 4. TimeOfDay (24 小时)
	todCond := "WHERE duration_s IS NOT NULL"
	var todArgs []any
	if site != "" {
		todCond = "WHERE site = ? AND duration_s IS NOT NULL"
		todArgs = append(todArgs, site)
	}

	todQuery := fmt.Sprintf(`
		SELECT CAST(strftime('%%H', started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS h,
		       COALESCE(SUM(duration_s), 0) AS s
		FROM reading_sessions
		%s
		GROUP BY h
	`, todCond)

	type todRow struct {
		H int `db:"h"`
		S int `db:"s"`
	}
	var todRows []todRow
	_ = s.db.SelectContext(ctx, &todRows, todQuery, todArgs...)

	timeOfDay := make([]int, 24)
	for _, r := range todRows {
		if r.H >= 0 && r.H < 24 {
			timeOfDay[r.H] = r.S
		}
	}

	// 5. TopItems
	topQuery := fmt.Sprintf(`
		SELECT site, kind, item_id AS id,
		       (SELECT r2.title FROM reading_sessions r2
		        WHERE r2.site = reading_sessions.site AND r2.kind = reading_sessions.kind
		          AND r2.item_id = reading_sessions.item_id
		        ORDER BY r2.started_at DESC LIMIT 1) AS title,
		       COALESCE(SUM(duration_s), 0) AS duration_s,
		       COUNT(*) AS sessions
		FROM reading_sessions
		%s
		GROUP BY site, kind, item_id
		ORDER BY duration_s DESC
		LIMIT 10
	`, siteCond)

	var topItems []TopItem
	_ = s.db.SelectContext(ctx, &topItems, topQuery, args...)
	if topItems == nil {
		topItems = []TopItem{}
	}

	// 6. RecentSessions
	recentQuery := fmt.Sprintf(`
		SELECT started_at, COALESCE(duration_s, 0) AS duration_s, kind, site, item_id AS id, title
		FROM reading_sessions
		%s
		ORDER BY started_at DESC
		LIMIT 20
	`, siteCond)

	var recentSessions []RecentSession
	_ = s.db.SelectContext(ctx, &recentSessions, recentQuery, args...)
	if recentSessions == nil {
		recentSessions = []RecentSession{}
	}

	summary := StatsSummary{
		TotalDurationS: totalSec,
		ActiveDays:     activeDays,
		CurrentStreak:  currStreak,
		LongestStreak:  longStreak,
		ThisWeekS:      thisWeekS,
		ThisMonthS:     thisMonthS,
	}
	if trackedSince.Valid {
		v := trackedSince.Int64
		summary.TrackedSince = &v
	}
	if lastActiveAt.Valid {
		v := lastActiveAt.Int64
		summary.LastActiveAt = &v
	}

	return &StatsResult{
		Summary:        summary,
		Calendar:       calendar,
		TimeOfDay:      timeOfDay,
		TopItems:       topItems,
		RecentSessions: recentSessions,
		Inventory:      inv,
	}, nil
}
