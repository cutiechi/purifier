package storage

import (
	"context"
	"testing"
	"time"

	"purifier/internal/model"
)

// 最长连读必须是真实连续段，不能退化成「活跃天数」。
func TestLongestStreakIsContiguousRun(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()
	loc := time.FixedZone("CST", 8*3600)

	days := []string{"2026-10-01", "2026-10-02", "2026-10-10", "2026-10-20"}
	for _, day := range days {
		d, err := time.ParseInLocation("2006-01-02", day, loc)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.RecordSession(ctx, SessionInput{
			Site: "1", Kind: model.KindPost, ID: "1", Title: "t",
			StartedAt: d.Add(10 * time.Hour).UnixMilli(), DurationS: 30,
		}); err != nil {
			t.Fatal(err)
		}
	}

	stats, err := s.GetStats(ctx, "1", loc)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Summary.ActiveDays != 4 {
		t.Fatalf("activeDays=%d", stats.Summary.ActiveDays)
	}
	if stats.Summary.LongestStreak != 2 {
		t.Fatalf("longestStreak=%d, want 2", stats.Summary.LongestStreak)
	}
}

// 日/时/周分桶必须按传入时区，不受 SQLite localtime（容器内可能是 UTC）影响。
func TestStatsBucketsUseProvidedLocation(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()
	shanghai := time.FixedZone("CST", 8*3600)

	// 2026-10-19 17:00 UTC = 2026-10-20 01:00 +08:00
	startedAt := time.Date(2026, 10, 19, 17, 0, 0, 0, time.UTC).UnixMilli()
	if err := s.RecordSession(ctx, SessionInput{
		Site: "1", Kind: model.KindPost, ID: "1", Title: "t",
		StartedAt: startedAt, DurationS: 60,
	}); err != nil {
		t.Fatal(err)
	}

	stats, err := s.GetStats(ctx, "1", shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if len(stats.Calendar) != 1 || stats.Calendar[0].Date != "2026-10-20" {
		t.Fatalf("calendar=%+v, want single 2026-10-20 bucket", stats.Calendar)
	}
	if stats.TimeOfDay[1] != 60 {
		t.Fatalf("timeOfDay[1]=%d, want 60", stats.TimeOfDay[1])
	}
	if stats.TimeOfDay[17] != 0 {
		t.Fatalf("UTC hour leaked into bucket 17: %d", stats.TimeOfDay[17])
	}
}

// 夏令时切换日只有 23h 或 25h，按日历日判断才不会把连续两天算成断开。
func TestLongestStreakAcrossDSTBoundary(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}

	// 2026-03-08 是美东夏令时开始日（当天只有 23 小时）。
	days := []string{"2026-03-07", "2026-03-08", "2026-03-09"}
	for _, day := range days {
		d, err := time.ParseInLocation("2006-01-02", day, loc)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.RecordSession(ctx, SessionInput{
			Site: "1", Kind: model.KindPost, ID: "1", Title: "t",
			StartedAt: d.Add(12 * time.Hour).UnixMilli(), DurationS: 30,
		}); err != nil {
			t.Fatal(err)
		}
	}

	stats, err := s.GetStats(ctx, "1", loc)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Summary.ActiveDays != 3 {
		t.Fatalf("activeDays=%d, want 3", stats.Summary.ActiveDays)
	}
	if stats.Summary.LongestStreak != 3 {
		t.Fatalf("longestStreak=%d, want 3 across DST boundary", stats.Summary.LongestStreak)
	}
}
