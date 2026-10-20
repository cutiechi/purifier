package jobs

import (
	"context"
	"testing"
	"time"

	"purifier/internal/model"
)

// 主动停止必须落到 cancelled，不能和崩溃共用 error 状态。
func TestStopYieldsCancelledStatus(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	runner := NewRunner(store)
	runner.Register(&blockingHandler{entered: make(chan struct{}, 1)})

	job, err := runner.Start(ctx, "blocking_task", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !runner.Stop(job.ID) {
		t.Fatal("stop returned false")
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		cur, err := store.GetJob(ctx, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if cur.Status.Terminal() {
			if cur.Status != model.JobStatusCancelled {
				t.Fatalf("status=%s, want cancelled", cur.Status)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("job did not reach a terminal state after stop")
}

// 任务 goroutine 里的 panic 必须被收尾成 error，不能打死进程。
func TestPanicInJobIsRecovered(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	runner := NewRunner(store)
	runner.Register(&panicHandler{})

	job, err := runner.Start(ctx, "panic_task", nil)
	if err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		cur, err := store.GetJob(ctx, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if cur.Status.Terminal() {
			if cur.Status != model.JobStatusError {
				t.Fatalf("status=%s, want error", cur.Status)
			}
			if cur.Error == nil || *cur.Error == "" {
				t.Fatal("expected panic message in error field")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("panicking job never settled")
}

// blockingHandler 一直挂到 ctx 取消，模拟长任务的检查点行为。
type blockingHandler struct {
	entered chan struct{}
}

func (h *blockingHandler) Type() string { return "blocking_task" }

func (h *blockingHandler) Run(ctx *JobContext) (any, error) {
	select {
	case h.entered <- struct{}{}:
	default:
	}
	<-ctx.Ctx.Done()
	return nil, ErrJobStopped
}

type panicHandler struct{}

func (h *panicHandler) Type() string { return "panic_task" }

func (h *panicHandler) Run(ctx *JobContext) (any, error) {
	panic("boom")
}
