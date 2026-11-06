package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
	"purifier/internal/storage"
)

// maxFrontierDepth 链接扩散深度上限：depth 达到该值的条目只入目录、不再继续扩散。
const maxFrontierDepth = 3

// maxFrontierAttempts 单条最多尝试次数，超过转 error 终态（下次手动重置才会再试）。
const maxFrontierAttempts = 3

// LinkHarvester cool18 Service 暴露给本任务的最小接口（便于测试注入）。
type LinkHarvester interface {
	HarvestPost(ctx context.Context, tid string) (string, []string, error)
	ReplyTids(ctx context.Context, tid string) ([]string, error)
}

// ArchiveLinkedJob 消费链接发现前沿：回复即章节、正文内链指向的帖子
// 都不在 feed 里（上游翻页有深度上限），只能靠逐条抓元数据补进归档目录。
type ArchiveLinkedJob struct {
	cool18Svc LinkHarvester
	store     *storage.Store
}

func NewArchiveLinkedJob(svc LinkHarvester, store *storage.Store) *ArchiveLinkedJob {
	return &ArchiveLinkedJob{cool18Svc: svc, store: store}
}

func (j *ArchiveLinkedJob) Type() string {
	return "archive_linked"
}

func (j *ArchiveLinkedJob) Run(ctx *JobContext) (any, error) {
	site := payloadSite(ctx, "1")
	if site != "1" {
		return nil, fmt.Errorf("linked archive only supports cool18 (site 1), got %s", site)
	}

	mode := payloadString(ctx.Payload, "mode")
	if mode != "harvest" {
		mode = "queue"
	}
	batch := payloadBatch(ctx.Payload, 200)
	delayMs := payloadDelay(ctx.Payload)

	if mode == "harvest" {
		return j.runHarvest(ctx, site, batch, delayMs)
	}
	return j.runQueue(ctx, site, batch, delayMs)
}

// runQueue 消费前沿队列：抓标题 upsert 进目录；depth 未到上限时继续扩散内链。
func (j *ArchiveLinkedJob) runQueue(ctx *JobContext, site string, batch, delayMs int) (any, error) {
	var (
		processed, inserted, updated int
		enqueued, failed, nocontent  int
	)
	start := time.Now()

	for processed < batch {
		if err := ctx.Checkpoint(); err != nil {
			return nil, ErrJobStopped
		}
		items, err := j.store.ClaimFrontierBatch(ctx.Ctx, site, minInt(50, batch-processed))
		if err != nil {
			return nil, err
		}
		if len(items) == 0 {
			break
		}

		for _, it := range items {
			processed++

			title, tids, hErr := j.cool18Svc.HarvestPost(ctx.Ctx, it.Tid)
			if hErr != nil {
				if isContentMissing(hErr) {
					// 纯回复壳/被删帖：记终态，不算失败
					_ = j.store.MarkFrontier(ctx.Ctx, site, it.Tid, "nocontent", it.Attempts)
					nocontent++
				} else {
					attempts := it.Attempts + 1
					state := "pending" // 留在队列，下轮再试
					if attempts >= maxFrontierAttempts {
						state = "error"
						failed++
					}
					_ = j.store.MarkFrontier(ctx.Ctx, site, it.Tid, state, attempts)
				}
			} else {
				now := time.Now().UnixMilli()
				ins, upd, uErr := j.store.UpsertArchivePosts(ctx.Ctx, []model.ArchivePost{{
					Site: site, Tid: it.Tid, Title: title,
					FirstSeenAt: now, ArchivedAt: now,
				}})
				if uErr != nil {
					return nil, uErr
				}
				inserted += ins
				updated += upd
				_ = j.store.MarkFrontier(ctx.Ctx, site, it.Tid, "done", it.Attempts)

				if it.Depth < maxFrontierDepth {
					added, _ := j.store.EnqueueFrontier(ctx.Ctx, site, tids, it.Tid, it.Depth+1)
					enqueued += added
				}
			}

			if processed%20 == 0 {
				ctx.ReportProgress(map[string]any{
					"processed": processed,
					"inserted":  inserted,
					"updated":   updated,
					"enqueued":  enqueued,
					"failed":    failed,
					"nocontent": nocontent,
				})
			}
			if err := ctx.Sleep(time.Duration(delayMs) * time.Millisecond); err != nil {
				return nil, ErrJobStopped
			}
		}
	}

	pending, total, _ := j.store.FrontierCounts(ctx.Ctx, site)
	return map[string]any{
		"processed": processed,
		"inserted":  inserted,
		"updated":   updated,
		"enqueued":  enqueued,
		"failed":    failed,
		"nocontent": nocontent,
		"pending":   pending,
		"frontier":  total,
		"durationS": int(time.Since(start).Seconds()),
	}, nil
}

// runHarvest 回填模式：对已归档帖子抓跟帖列表，把「回复即章节」的 tid 补进前沿。
// cursor 语义：fromTid（不含）向老方向推进，结果里带 nextFromTid 供下轮续跑。
func (j *ArchiveLinkedJob) runHarvest(ctx *JobContext, site string, batch, delayMs int) (any, error) {
	fromTid := payloadString(ctx.Payload, "fromTid")

	posts, err := j.store.ArchivePostsForHarvest(ctx.Ctx, site, fromTid, batch)
	if err != nil {
		return nil, err
	}

	var (
		processed, enqueued int
		nextFromTid         string
	)
	start := time.Now()

	for i, p := range posts {
		if err := ctx.Checkpoint(); err != nil {
			return nil, ErrJobStopped
		}
		tids, hErr := j.cool18Svc.ReplyTids(ctx.Ctx, p.Tid)
		if hErr != nil {
			ctx.Log("warn", fmt.Sprintf("harvest replies tid=%s failed: %v", p.Tid, hErr))
		} else {
			added, _ := j.store.EnqueueFrontier(ctx.Ctx, site, tids, p.Tid, 1)
			enqueued += added
		}
		processed++
		nextFromTid = p.Tid

		if (i+1)%25 == 0 || i+1 == len(posts) {
			ctx.ReportProgress(map[string]any{
				"posts":    processed,
				"enqueued": enqueued,
				"fromTid":  fromTid,
				"nextFrom": nextFromTid,
			})
		}
		if err := ctx.Sleep(time.Duration(delayMs) * time.Millisecond); err != nil {
			return nil, ErrJobStopped
		}
	}

	return map[string]any{
		"posts":       processed,
		"enqueued":    enqueued,
		"fromTid":     fromTid,
		"nextFromTid": nextFromTid,
		"durationS":   int(time.Since(start).Seconds()),
	}, nil
}

// isContentMissing 识别「没有可解析正文」的帖子（纯回复壳、被删帖）：
// ExtractorError 404/410 映射内容不存在，其余错误按可重试处理。
func isContentMissing(err error) bool {
	var exErr *upstream.ExtractorError
	if errors.As(err, &exErr) {
		return exErr.StatusCode == 404 || exErr.StatusCode == 410
	}
	return false
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func payloadBatch(payload map[string]any, fallback int) int {
	if n, ok := payload["batch"].(float64); ok && n >= 1 && n <= 1000 {
		return int(n)
	}
	return fallback
}
