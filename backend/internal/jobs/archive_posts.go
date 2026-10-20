package jobs

import (
	"context"
	"fmt"
	"time"

	"purifier/internal/model"
	"purifier/internal/provider/cool18"
	"purifier/internal/storage"
)

type ArchivePostsJob struct {
	cool18Svc *cool18.Service
	store     *storage.Store
}

func NewArchivePostsJob(cool18Svc *cool18.Service, store *storage.Store) *ArchivePostsJob {
	return &ArchivePostsJob{
		cool18Svc: cool18Svc,
		store:     store,
	}
}

func (j *ArchivePostsJob) Type() string {
	return "archive_posts"
}

func (j *ArchivePostsJob) Run(ctx *JobContext) (any, error) {
	site := payloadSite(ctx, "1")
	if site != "1" {
		return nil, fmt.Errorf("archive only supported for cool18 (site 1), got %s", site)
	}

	mode := payloadMode(ctx.Payload)
	delayMs := payloadDelay(ctx.Payload)

	// 增量停止线：库内已有的最大 tid。论坛首页按 tid 递减翻页，
	// 当整页都不超过该值时说明已追平，停止。
	var incrementalFloor int64
	if mode == "incremental" {
		maxTid, err := j.store.ArchiveMaxTid(ctx.Ctx, site)
		if err != nil {
			return nil, err
		}
		if maxTid != "" {
			fmt.Sscan(maxTid, &incrementalFloor)
			ctx.Log("info", fmt.Sprintf("incremental: stop when a whole page is ≤ tid %d", incrementalFloor))
		} else {
			ctx.Log("info", "incremental: archive empty → behaves like full scan")
		}
	}

	mtid := "0"
	if mode == "resume" {
		cursor, err := j.store.GetArchiveCursor(ctx.Ctx, site)
		if err == nil && cursor != nil && cursor.NextMtid != nil && *cursor.NextMtid != "" {
			mtid = *cursor.NextMtid
			ctx.Log("info", fmt.Sprintf("resume from next_mtid=%s (saved pages=%d)", mtid, cursor.Pages))
		} else {
			ctx.Log("info", "no valid cursor; resume falls back to mtid=0")
		}
	} else if from := payloadString(ctx.Payload, "fromMtid"); from != "" {
		mtid = from
		ctx.Log("info", fmt.Sprintf("start from explicit fromMtid=%s", mtid))
	}

	if err := j.store.SetArchiveCursor(ctx.Ctx, site, mtid, mode, "running", 0); err != nil {
		return nil, err
	}

	pages := 0
	inserted := 0
	updated := 0
	stopReason := "end"
	startTime := time.Now()

	for {
		if err := ctx.Checkpoint(); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "aborted", pages)
			ctx.Log("warn", "job aborted by checkpoint")
			return nil, ErrJobStopped
		}

		var res *cool18.HomeResponse
		fetchErr := retry(ctx.Ctx, 3, 500*time.Millisecond, func() error {
			var err error
			res, err = j.cool18Svc.GetHomePosts(ctx.Ctx, mtid)
			return err
		})
		if fetchErr != nil {
			ctx.Log("error", fmt.Sprintf("fetch mtid=%s failed: %v", mtid, fetchErr))
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "error", pages)
			return nil, fetchErr
		}

		pages++
		now := time.Now().UnixMilli()

		var archiveList []model.ArchivePost
		var newestTid int64
		for _, l := range res.Links {
			archiveList = append(archiveList, model.ArchivePost{
				Site:        site,
				Tid:         l.Tid,
				Title:       l.Title,
				FirstSeenAt: now,
				ArchivedAt:  now,
			})
			var tidNum int64
			if _, err := fmt.Sscan(l.Tid, &tidNum); err == nil && tidNum > newestTid {
				newestTid = tidNum
			}
		}

		pageInserted, pageUpdated, err := j.store.UpsertArchivePosts(ctx.Ctx, archiveList)
		if err != nil {
			ctx.Log("error", fmt.Sprintf("upsert archive posts failed: %v", err))
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "error", pages)
			return nil, err
		}
		inserted += pageInserted
		updated += pageUpdated

		ctx.ReportProgress(map[string]any{
			"pages":    pages,
			"inserted": inserted,
			"updated":  updated,
			"mode":     mode,
			"lastMtid": mtid,
		})

		// 增量追平：整页都是库内已有的旧帖
		if mode == "incremental" && incrementalFloor > 0 && len(res.Links) > 0 && newestTid <= incrementalFloor {
			ctx.Log("info", fmt.Sprintf("incremental caught up at mtid=%s (page max tid %d ≤ %d)", mtid, newestTid, incrementalFloor))
			stopReason = "incremental_caught_up"
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		if res.NextMtid == nil || *res.NextMtid == "" || *res.NextMtid == mtid {
			ctx.Log("info", fmt.Sprintf("reached end of forum, archived %d pages (%d new, %d updated)", pages, inserted, updated))
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		mtid = *res.NextMtid
		if err := j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "running", pages); err != nil {
			return nil, err
		}

		if err := ctx.Sleep(time.Duration(delayMs) * time.Millisecond); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "aborted", pages)
			return nil, ErrJobStopped
		}
	}

	return map[string]any{
		"pages":      pages,
		"inserted":   inserted,
		"updated":    updated,
		"mode":       mode,
		"stopReason": stopReason,
		"durationS":  int(time.Since(startTime).Seconds()),
	}, nil
}

// payloadSite 读取 site（默认 fallback），兼容 JSON 数字与字符串。
func payloadSite(ctx *JobContext, fallback string) string {
	switch v := ctx.Payload["site"].(type) {
	case string:
		if v != "" {
			return v
		}
	case float64:
		return fmt.Sprintf("%d", int(v))
	}
	return fallback
}

func payloadString(payload map[string]any, key string) string {
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

// payloadMode 只接受 full/resume/incremental，其它值按 full。
func payloadMode(payload map[string]any) string {
	switch payloadString(payload, "mode") {
	case "resume":
		return "resume"
	case "incremental":
		return "incremental"
	default:
		return "full"
	}
}

func payloadDelay(payload map[string]any) int {
	if d, ok := payload["delayMs"].(float64); ok && d >= 200 && d <= 5000 {
		return int(d)
	}
	return 800
}

func payloadMinMembers(payload map[string]any) int {
	if n, ok := payload["minMembers"].(float64); ok && n >= 2 && n <= 50 {
		return int(n)
	}
	return 2
}
