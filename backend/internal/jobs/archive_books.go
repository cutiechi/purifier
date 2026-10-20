package jobs

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"purifier/internal/model"
	"purifier/internal/provider/xchina"
	"purifier/internal/storage"
)

// ArchiveBooksJob 归档书库（site=2）更新流：mtid 是页码，首页从 1 开始。
type ArchiveBooksJob struct {
	xchinaSvc *xchina.Service
	store     *storage.Store
}

func NewArchiveBooksJob(xchinaSvc *xchina.Service, store *storage.Store) *ArchiveBooksJob {
	return &ArchiveBooksJob{xchinaSvc: xchinaSvc, store: store}
}

func (j *ArchiveBooksJob) Type() string {
	return "archive_books"
}

func (j *ArchiveBooksJob) Run(ctx *JobContext) (any, error) {
	site := payloadSite(ctx, "2")
	if site != xchina.XChinaSiteID {
		return nil, fmt.Errorf("book archive only supported for site 2, got %s", site)
	}

	mode := payloadMode(ctx.Payload)
	delayMs := payloadDelay(ctx.Payload)

	// 起始页：0 是首页时间线（卡片语义不同），归档从第 1 页开始
	page := 1
	if mode == "resume" {
		cursor, err := j.store.GetArchiveCursor(ctx.Ctx, site)
		if err == nil && cursor != nil && cursor.NextMtid != nil && *cursor.NextMtid != "" {
			if n, convErr := strconv.Atoi(*cursor.NextMtid); convErr == nil && n > 0 {
				page = n
			}
			ctx.Log("info", fmt.Sprintf("resume from page=%d (saved pages=%d)", page, cursor.Pages))
		} else {
			ctx.Log("info", "no valid cursor; resume starts from page 1")
		}
	} else if from := payloadString(ctx.Payload, "fromMtid"); from != "" {
		if n, convErr := strconv.Atoi(from); convErr == nil && n > 0 {
			page = n
		}
		ctx.Log("info", fmt.Sprintf("start from explicit page=%d", page))
	}

	// 增量停止深度：本次运行前已归档页数。用「越过」而非「到达」，
	// 残缺归档下才能继续扫进未归档区。
	savedDepth := 0
	if mode == "incremental" {
		if cursor, err := j.store.GetArchiveCursor(ctx.Ctx, site); err == nil && cursor != nil {
			savedDepth = cursor.Pages
		}
		ctx.Log("info", fmt.Sprintf("incremental: saved depth=%d pages", savedDepth))
	}

	if err := j.store.SetArchiveCursor(ctx.Ctx, site, strconv.Itoa(page), mode, "running", 0); err != nil {
		return nil, err
	}

	pages := 0
	inserted := 0
	updated := 0
	stopReason := "end"
	startTime := time.Now()

	for {
		if err := ctx.Checkpoint(); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, strconv.Itoa(page), mode, "aborted", pages)
			ctx.Log("warn", "job aborted by checkpoint")
			return nil, ErrJobStopped
		}

		var res *xchina.HomeFeedResponse
		fetchErr := retry(ctx.Ctx, 3, 500*time.Millisecond, func() error {
			var err error
			res, err = j.xchinaSvc.HomeFeed(ctx.Ctx, strconv.Itoa(page))
			return err
		})
		if fetchErr != nil {
			ctx.Log("error", fmt.Sprintf("fetch page=%d failed: %v", page, fetchErr))
			_ = j.store.SetArchiveCursor(context.Background(), site, strconv.Itoa(page), mode, "error", pages)
			return nil, fetchErr
		}

		pages++
		if len(res.Links) == 0 {
			ctx.Log("info", fmt.Sprintf("page %d: empty, done", page))
			stopReason = "empty"
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		now := time.Now().UnixMilli()
		posts := make([]model.ArchivePost, 0, len(res.Links))
		for _, l := range res.Links {
			posts = append(posts, model.ArchivePost{
				Site:        site,
				Tid:         l.Tid,
				Title:       l.Title,
				FirstSeenAt: now,
				ArchivedAt:  now,
			})
		}

		pageInserted, pageUpdated, err := j.store.UpsertArchivePosts(ctx.Ctx, posts)
		if err != nil {
			ctx.Log("error", fmt.Sprintf("upsert archive books failed: %v", err))
			_ = j.store.SetArchiveCursor(context.Background(), site, strconv.Itoa(page), mode, "error", pages)
			return nil, err
		}
		inserted += pageInserted
		updated += pageUpdated

		ctx.ReportProgress(map[string]any{
			"pages":    pages,
			"inserted": inserted,
			"updated":  updated,
			"mode":     mode,
			"lastPage": page,
		})

		if stop, reason := incrementalStop(mode, pageInserted, pages, savedDepth); stop {
			ctx.Log("info", fmt.Sprintf("page %d: %s", page, reason))
			stopReason = reason
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		if res.NextMtid == nil || *res.NextMtid == "" {
			ctx.Log("info", fmt.Sprintf("reached end at page %d (%d new, %d updated)", page, inserted, updated))
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}
		next, convErr := strconv.Atoi(*res.NextMtid)
		if convErr != nil || next <= page {
			ctx.Log("info", fmt.Sprintf("cursor not advancing (%s ≤ %d), stop", *res.NextMtid, page))
			stopReason = "cursor_stuck"
			_ = j.store.SetArchiveCursor(context.Background(), site, "", mode, "done", pages)
			break
		}

		page = next
		if err := j.store.SetArchiveCursor(context.Background(), site, strconv.Itoa(page), mode, "running", pages); err != nil {
			return nil, err
		}
		if err := ctx.Sleep(time.Duration(delayMs) * time.Millisecond); err != nil {
			_ = j.store.SetArchiveCursor(context.Background(), site, strconv.Itoa(page), mode, "aborted", pages)
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

// incrementalStop 判定增量扫描是否可以停止。
//
// 两个条件任一成立即可，不是「且」：
//   - 本页 0 新增：已经追上已归档区（书库更新流按页递增，越往后越旧）；
//   - 扫到上一轮深度：本轮最多补这么多页，避免一次拉全量。
//
// 旧实现写成 pageInserted == 0 && pages > savedDepth，要求「越过旧深度后
// 还有空页」，而第 1 页几乎总有新书，结果永远退化成全量重扫。
func incrementalStop(mode string, pageInserted, pages, savedDepth int) (bool, string) {
	if mode != "incremental" {
		return false, ""
	}
	if pageInserted == 0 {
		return true, "incremental_caught_up"
	}
	if savedDepth > 0 && pages >= savedDepth {
		return true, "incremental_depth_reached"
	}
	return false, ""
}
