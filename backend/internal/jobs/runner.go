package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"purifier/internal/model"
	"purifier/internal/storage"
)

type JobContext struct {
	JobID   int64
	Ctx     context.Context
	Payload map[string]any

	runner *JobRunner
	store  *storage.Store
	handle *runningHandle
}

func (c *JobContext) Log(level, message string) {
	_ = c.store.AddJobLog(context.Background(), c.JobID, level, message)
}

func (c *JobContext) ReportProgress(progress any) {
	if data, err := json.Marshal(progress); err == nil {
		_ = c.store.UpdateJobResult(context.Background(), c.JobID, string(data))
	}
}

// Checkpoint 挂起检查点：如果被暂停，挂起直到 resume 或 context 取消
func (c *JobContext) Checkpoint() error {
	c.handle.mu.Lock()
	paused := c.handle.paused
	pauseCh := c.handle.resumeCh
	c.handle.mu.Unlock()

	if !paused {
		select {
		case <-c.Ctx.Done():
			return c.Ctx.Err()
		default:
			return nil
		}
	}

	select {
	case <-c.Ctx.Done():
		return c.Ctx.Err()
	case <-pauseCh:
		return nil
	}
}

// Sleep 可中断且响应暂停的延时
func (c *JobContext) Sleep(d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-c.Ctx.Done():
		return c.Ctx.Err()
	case <-timer.C:
		return c.Checkpoint()
	}
}

type JobHandler interface {
	Type() string
	Run(ctx *JobContext) (any, error)
}

type runningHandle struct {
	cancel   context.CancelFunc
	mu       sync.Mutex
	paused   bool
	resumeCh chan struct{}
}

type JobRunner struct {
	store        *storage.Store
	handlers     map[string]JobHandler
	running      map[int64]*runningHandle
	runningTypes map[string]bool
	mu           sync.RWMutex
}

func NewRunner(store *storage.Store) *JobRunner {
	return &JobRunner{
		store:        store,
		handlers:     make(map[string]JobHandler),
		running:      make(map[int64]*runningHandle),
		runningTypes: make(map[string]bool),
	}
}

func (r *JobRunner) Register(h JobHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[h.Type()] = h
}

// RecoverOnStartup 重启恢复：
//   - running/pending 的残留行收尾为 error（进程已死，无法续跑）
//   - paused 的行重新入队执行：暂停状态只存在内存里，直接判死会让 DB 里的
//     paused 变成永远无法恢复的死状态。归档任务自身有持久化游标，重跑会从
//     中断处继续。
func (r *JobRunner) RecoverOnStartup(ctx context.Context) {
	paused, err := r.store.ListJobsByStatus(ctx, string(model.JobStatusPaused))
	if err != nil {
		log.Printf("[jobs] startup recovery: list paused failed: %v", err)
	}

	n, err := r.store.MarkJobsAsError(ctx,
		[]string{string(model.JobStatusRunning), string(model.JobStatusPending)},
		"server restarted; job aborted")
	if err != nil {
		log.Printf("[jobs] startup recovery failed: %v", err)
	} else if n > 0 {
		log.Printf("[jobs] startup recovery: marked %d stale job(s) as error", n)
	}

	for _, j := range paused {
		// 置回 pending 后再走正常启动路径，使 HasRunningOfType 语义保持一致
		if _, err := r.store.RequeuePaused(ctx, j.ID); err != nil {
			log.Printf("[jobs] startup recovery: requeue job %d failed: %v", j.ID, err)
			continue
		}
		payload := map[string]any{}
		if j.Payload != nil {
			if err := json.Unmarshal([]byte(*j.Payload), &payload); err != nil {
				log.Printf("[jobs] startup recovery: job %d payload unreadable: %v", j.ID, err)
				payload = map[string]any{}
			}
		}
		// 恢复型续跑：归档任务据此从持久化游标接着扫
		payload["mode"] = "resume"
		if _, err := r.resume(j.ID, j.Type, payload); err != nil {
			log.Printf("[jobs] startup recovery: resume job %d failed: %v", j.ID, err)
		} else {
			log.Printf("[jobs] startup recovery: job %d (%s) resumed from checkpoint", j.ID, j.Type)
		}
	}
}

func (r *JobRunner) Start(ctx context.Context, jobType string, payload map[string]any) (*model.Job, error) {
	r.mu.Lock()
	handler, ok := r.handlers[jobType]
	if !ok {
		r.mu.Unlock()
		return nil, errors.New("unknown job type")
	}

	if r.runningTypes[jobType] {
		r.mu.Unlock()
		return nil, errors.New("job already running")
	}

	hasRunning, err := r.store.HasRunningOfType(ctx, jobType)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	if hasRunning {
		r.mu.Unlock()
		return nil, errors.New("job already running")
	}

	var payloadStr *string
	if payload != nil {
		if b, err := json.Marshal(payload); err == nil {
			s := string(b)
			payloadStr = &s
		}
	}

	job, err := r.store.CreateJob(ctx, jobType, payloadStr)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}

	// MarkRunning 失败时该行会停在 pending，而 HasRunningOfType 把 pending 计入
	// 活动态 —— 残留的 pending 会让该类型任务永久无法再启动。因此失败时立刻把
	// 这一行收尾为 error，绝不留下活动态孤儿。
	started, err := r.store.MarkRunning(ctx, job.ID)
	if err != nil || !started {
		failMsg := "failed to start job"
		if err != nil {
			failMsg = err.Error()
		}
		_ = r.store.MarkFinished(context.Background(), job.ID, model.JobStatusError, nil, &failMsg)
		r.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, errors.New("failed to start job")
	}

	r.launchLocked(handler, job.ID, jobType, payload)
	r.mu.Unlock()

	return r.store.GetJob(ctx, job.ID)
}

// resume 重启恢复专用：行已被 RequeuePaused 置回 pending，这里补上 pending→running
// 的迁移并启动执行，保持与 Start 相同的状态机。
func (r *JobRunner) resume(jobID int64, jobType string, payload map[string]any) (*model.Job, error) {
	r.mu.Lock()
	handler, ok := r.handlers[jobType]
	if !ok {
		r.mu.Unlock()
		return nil, errors.New("unknown job type")
	}
	if r.runningTypes[jobType] {
		r.mu.Unlock()
		return nil, errors.New("job already running")
	}

	started, err := r.store.MarkRunning(context.Background(), jobID)
	if err != nil || !started {
		failMsg := "failed to resume job"
		if err != nil {
			failMsg = err.Error()
		}
		_ = r.store.MarkFinished(context.Background(), jobID, model.JobStatusError, nil, &failMsg)
		r.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, errors.New("failed to resume job")
	}

	r.launchLocked(handler, jobID, jobType, payload)
	r.mu.Unlock()

	return r.store.GetJob(context.Background(), jobID)
}

// launchLocked 注册运行句柄并起 goroutine；调用方必须持有 r.mu 写锁。
func (r *JobRunner) launchLocked(handler JobHandler, jobID int64, jobType string, payload map[string]any) {
	jobCtx, cancel := context.WithCancel(context.Background())
	handle := &runningHandle{
		cancel:   cancel,
		resumeCh: make(chan struct{}),
	}

	r.running[jobID] = handle
	r.runningTypes[jobType] = true

	go func() {
		defer func() {
			r.mu.Lock()
			delete(r.running, jobID)
			delete(r.runningTypes, jobType)
			r.mu.Unlock()
		}()

		c := &JobContext{
			JobID:   jobID,
			Ctx:     jobCtx,
			Payload: payload,
			runner:  r,
			store:   r.store,
			handle:  handle,
		}

		result, runErr := handler.Run(c)
		var resStr *string
		if result != nil {
			if b, err := json.Marshal(result); err == nil {
				s := string(b)
				resStr = &s
			}
		}

		status := model.JobStatusFinished
		var errMsg *string
		if runErr != nil {
			status = model.JobStatusError
			s := runErr.Error()
			errMsg = &s
			log.Printf("[jobs] job %d (%s) finished with error: %v", jobID, jobType, runErr)
		} else {
			log.Printf("[jobs] job %d (%s) finished successfully", jobID, jobType)
		}

		_ = r.store.MarkFinished(context.Background(), jobID, status, resStr, errMsg)
	}()
}

func (r *JobRunner) Stop(jobID int64) bool {
	r.mu.Lock()
	h, ok := r.running[jobID]
	r.mu.Unlock()
	if !ok {
		return false
	}
	h.cancel()
	return true
}

func (r *JobRunner) Pause(ctx context.Context, jobID int64) bool {
	r.mu.Lock()
	h, ok := r.running[jobID]
	r.mu.Unlock()
	if !ok {
		return false
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.paused {
		return false
	}

	ok, err := r.store.MarkPaused(ctx, jobID)
	if err != nil || !ok {
		return false
	}

	h.paused = true
	h.resumeCh = make(chan struct{})
	return true
}

func (r *JobRunner) Resume(ctx context.Context, jobID int64) bool {
	r.mu.Lock()
	h, ok := r.running[jobID]
	r.mu.Unlock()
	if !ok {
		return false
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.paused {
		return false
	}

	ok, err := r.store.MarkResumed(ctx, jobID)
	if err != nil || !ok {
		return false
	}

	h.paused = false
	close(h.resumeCh)
	return true
}
