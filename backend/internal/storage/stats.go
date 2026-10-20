package storage

import (
	"context"
	"fmt"
	"sort"
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

const dateLayout = "2006-01-02"

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

// GetStats 综合统计数据。日/时/周/月分桶统一按 loc（进程本地时区）计算，
// 不依赖 SQLite 的 localtime（容器内可能是 UTC）。
func (s *Store) GetStats(ctx context.Context, site string, loc *time.Location) (*StatsResult, error) {
	if loc == nil {
		loc = time.Local
	}

	siteCond := ""
	var args []any
	if site != "" {
		siteCond = "WHERE site = ?"
		args = append(args, site)
	}

	var inv Inventory
	inventoryQueries := []struct {
		dst    *int
		table  string
		bySite bool
	}{
		{&inv.History, "items", true},
		{&inv.Favorites, "favorites", true},
		{&inv.Tags, "tags", true},
		{&inv.Bookmarks, "bookmarks", true},
		{&inv.Groups, "groups", false},
		{&inv.Characters, "character_names", false},
	}
	for _, q := range inventoryQueries {
		query := "SELECT COUNT(*) FROM " + q.table
		queryArgs := []any{}
		if site != "" && q.bySite {
			query += " WHERE site = ?"
			queryArgs = append(queryArgs, site)
		}
		if err := s.db.GetContext(ctx, q.dst, query, queryArgs...); err != nil {
			return nil, err
		}
	}

	var totalSec int
	if err := s.db.QueryRowContext(ctx,
		fmt.Sprintf("SELECT COALESCE(SUM(duration_s), 0) FROM reading_sessions %s", siteCond), args...).
		Scan(&totalSec); err != nil {
		return nil, err
	}

	nowLocal := time.Now().In(loc)
	today := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, loc)
	weekStart := today.AddDate(0, 0, -int(nowLocal.Weekday()+6)%7)
	monthStart := time.Date(nowLocal.Year(), nowLocal.Month(), 1, 0, 0, 0, 0, loc)

	var thisWeekS, thisMonthS int
	weekCond := "WHERE started_at >= ?"
	weekArgs := []any{weekStart.UnixMilli()}
	monthCond := "WHERE started_at >= ?"
	monthArgs := []any{monthStart.UnixMilli()}
	if site != "" {
		weekCond = "WHERE site = ? AND started_at >= ?"
		weekArgs = []any{site, weekStart.UnixMilli()}
		monthCond = "WHERE site = ? AND started_at >= ?"
		monthArgs = []any{site, monthStart.UnixMilli()}
	}
	if err := s.db.QueryRowContext(ctx,
		fmt.Sprintf("SELECT COALESCE(SUM(duration_s), 0) FROM reading_sessions %s", weekCond), weekArgs...).
		Scan(&thisWeekS); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx,
		fmt.Sprintf("SELECT COALESCE(SUM(duration_s), 0) FROM reading_sessions %s", monthCond), monthArgs...).
		Scan(&thisMonthS); err != nil {
		return nil, err
	}

	// 一次扫描：按本地日/小时分桶，同时得到全时段活跃日集合
	type sessionRow struct {
		StartedAt int64 `db:"started_at"`
		DurationS int   `db:"duration_s"`
	}
	var rows []sessionRow
	if err := s.db.SelectContext(ctx, &rows, fmt.Sprintf(
		"SELECT started_at, COALESCE(duration_s, 0) AS duration_s FROM reading_sessions %s ORDER BY started_at",
		siteCond), args...); err != nil {
		return nil, err
	}

	dayDurations := make(map[string]int)
	daySet := make(map[string]bool)
	timeOfDay := make([]int, 24)
	var trackedSince, lastActiveAt *int64
	for _, r := range rows {
		t := time.UnixMilli(r.StartedAt).In(loc)
		day := t.Format(dateLayout)
		dayDurations[day] += r.DurationS
		daySet[day] = true
		timeOfDay[t.Hour()] += r.DurationS
		if trackedSince == nil {
			v := r.StartedAt
			trackedSince = &v
		}
		v := r.StartedAt
		lastActiveAt = &v
	}

	// 日历：近 365 天（含今天）
	calendar := make([]CalendarDay, 0, len(dayDurations))
	cutoff := today.AddDate(0, 0, -364).Format(dateLayout)
	for day, dur := range dayDurations {
		if day < cutoff {
			continue
		}
		calendar = append(calendar, CalendarDay{Date: day, DurationS: dur})
	}
	sort.Slice(calendar, func(i, j int) bool { return calendar[i].Date < calendar[j].Date })

	activeDays := len(calendar)

	// 当前连读：今天有记录从今天起算，否则从昨天起算
	currStreak := 0
	checkDay := today
	if !daySet[checkDay.Format(dateLayout)] {
		checkDay = today.AddDate(0, 0, -1)
	}
	for daySet[checkDay.Format(dateLayout)] {
		currStreak++
		checkDay = checkDay.AddDate(0, 0, -1)
	}

	// 最长连读：对全部活跃日排序后扫描连续段
	allDays := make([]string, 0, len(daySet))
	for day := range daySet {
		allDays = append(allDays, day)
	}
	sort.Strings(allDays)
	longStreak := 0
	run := 0
	var prev time.Time
	for i, day := range allDays {
		d, err := time.ParseInLocation(dateLayout, day, loc)
		if err != nil {
			continue
		}
		// 按日历日比较，不能用 d.Sub(prev)==24h：夏令时切换日只有 23h 或 25h，
		// 那样会把连续两天判成断开。
		if i > 0 && prev.AddDate(0, 0, 1).Equal(d) {
			run++
		} else {
			run = 1
		}
		if run > longStreak {
			longStreak = run
		}
		prev = d
	}

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
	if err := s.db.SelectContext(ctx, &topItems, topQuery, args...); err != nil {
		return nil, err
	}
	if topItems == nil {
		topItems = []TopItem{}
	}

	recentQuery := fmt.Sprintf(`
		SELECT started_at, COALESCE(duration_s, 0) AS duration_s, kind, site, item_id AS id, title
		FROM reading_sessions
		%s
		ORDER BY started_at DESC
		LIMIT 20
	`, siteCond)

	var recentSessions []RecentSession
	if err := s.db.SelectContext(ctx, &recentSessions, recentQuery, args...); err != nil {
		return nil, err
	}
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
		TrackedSince:   trackedSince,
		LastActiveAt:   lastActiveAt,
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
