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
	site := "1"
	if s, ok := ctx.Payload["site"].(string); ok && s != "" {
		site = s
	}
	if site != "1" {
		return nil, fmt.Errorf("archive only supported for cool18 (site 1), got %s", site)
	}

	mode := "full"
	if m, ok := ctx.Payload["mode"].(string); ok && m != "" {
		mode = m
	}

	delayMs := 800
	if d, ok := ctx.Payload["delayMs"].(float64); ok && d >= 200 && d <= 5000 {
		delayMs = int(d)
	}

	mtid := "0"
	if mode == "resume" {
		cursor, err := j.store.GetArchiveCursor(ctx.Ctx, site)
		if err == nil && cursor != nil && cursor.NextMtid != nil && *cursor.NextMtid != "" {
			mtid = *cursor.NextMtid
			ctx.Log("info", fmt.Sprintf("resume from next_mtid=%s (saved pages=%d)", mtid, cursor.Pages))
		} else {
			ctx.Log("info", "no valid cursor; resume falls back to mtid=0")
			mtid = "0"
		}
	} else if from, ok := ctx.Payload["fromMtid"].(string); ok && from != "" {
		mtid = from
		ctx.Log("info", fmt.Sprintf("start from explicit fromMtid=%s", mtid))
	}

	_ = j.store.SetArchiveCursor(ctx.Ctx, site, mtid, mode, "running", 0)

	pages := 0
	inserted := 0
	startTime := time.Now()

	for {
		if err := ctx.Checkpoint(); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "aborted", pages)
			ctx.Log("warn", "job aborted by checkpoint")
			return nil, err
		}

		res, err := j.cool18Svc.GetHomePosts(ctx.Ctx, mtid)
		if err != nil {
			ctx.Log("error", fmt.Sprintf("fetch mtid=%s failed: %v", mtid, err))
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "error", pages)
			return nil, err
		}

		pages++
		now := time.Now().UnixMilli()

		var archiveList []model.ArchivePost
		for _, l := range res.Links {
			archiveList = append(archiveList, model.ArchivePost{
				Site:        site,
				Tid:         l.Tid,
				Title:       l.Title,
				FirstSeenAt: now,
				ArchivedAt:  now,
			})
		}

		if len(archiveList) > 0 {
			if err := j.store.UpsertArchivePosts(ctx.Ctx, archiveList); err != nil {
				ctx.Log("error", fmt.Sprintf("upsert archive posts failed: %v", err))
				return nil, err
			}
			inserted += len(archiveList)
		}

		ctx.ReportProgress(map[string]any{
			"pages":    pages,
			"inserted": inserted,
			"lastMtid": mtid,
		})

		if res.NextMtid == nil || *res.NextMtid == "" || *res.NextMtid == mtid {
			ctx.Log("info", fmt.Sprintf("reached end of forum, archived %d pages, %d posts", pages, inserted))
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		mtid = *res.NextMtid
		_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "running", pages)

		if err := ctx.Sleep(time.Duration(delayMs) * time.Millisecond); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, mtid, mode, "aborted", pages)
			return nil, err
		}
	}

	durationS := int(time.Since(startTime).Seconds())
	return map[string]any{
		"pages":     pages,
		"inserted":  inserted,
		"durationS": durationS,
	}, nil
}
