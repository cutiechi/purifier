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

// RecoverOnStartup 重启时将之前遗留的 running/paused 状态安全收尾
func (r *JobRunner) RecoverOnStartup(ctx context.Context) {
	res, err := r.store.ListJobs(ctx, storage.JobListQuery{
		Status: "active",
		Limit:  100,
	})
	if err != nil {
		return
	}
	errMsg := "server restarted; job aborted"
	for _, j := range res.Items {
		_ = r.store.MarkFinished(ctx, j.ID, model.JobStatusError, nil, &errMsg)
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

	if _, err := r.store.MarkRunning(ctx, job.ID); err != nil {
		r.mu.Unlock()
		return nil, err
	}

	jobCtx, cancel := context.WithCancel(context.Background())
	handle := &runningHandle{
		cancel:   cancel,
		resumeCh: make(chan struct{}),
	}

	r.running[job.ID] = handle
	r.runningTypes[jobType] = true
	r.mu.Unlock()

	// 异步在独立 goroutine 执行
	go func() {
		defer func() {
			r.mu.Lock()
			delete(r.running, job.ID)
			delete(r.runningTypes, jobType)
			r.mu.Unlock()
		}()

		c := &JobContext{
			JobID:   job.ID,
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
			log.Printf("[jobs] job %d (%s) finished with error: %v", job.ID, jobType, runErr)
		} else {
			log.Printf("[jobs] job %d (%s) finished successfully", job.ID, jobType)
		}

		_ = r.store.MarkFinished(context.Background(), job.ID, status, resStr, errMsg)
	}()

	return r.store.GetJob(ctx, job.ID)
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
