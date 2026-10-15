package jobs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"purifier/internal/storage"
)

type dummyHandler struct{}

func (d *dummyHandler) Type() string {
	return "dummy_task"
}

func (d *dummyHandler) Run(ctx *JobContext) (any, error) {
	ctx.Log("info", "starting dummy task")
	ctx.ReportProgress(map[string]any{"progress": 50})
	if err := ctx.Sleep(50 * time.Millisecond); err != nil {
		return nil, err
	}
	ctx.Log("info", "dummy task done")
	return map[string]any{"ok": true}, nil
}

func TestJobRunnerLifecycle(t *testing.T) {
	tmpDir := filepath.Join(os.TempDir(), "purifier_test_jobs")
	defer os.RemoveAll(tmpDir)

	db, err := storage.OpenDB(tmpDir)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	runner := NewRunner(store)
	runner.Register(&dummyHandler{})

	ctx := context.Background()

	// 1. 启动任务
	job, err := runner.Start(ctx, "dummy_task", map[string]any{"foo": "bar"})
	if err != nil {
		t.Fatalf("failed to start job: %v", err)
	}

	// 2. 重复启动应报 409 conflict
	_, err = runner.Start(ctx, "dummy_task", nil)
	if err == nil {
		t.Fatalf("expected error starting duplicate job")
	}

	// 3. 等待完成
	time.Sleep(150 * time.Millisecond)

	finishedJob, err := store.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatalf("failed to get finished job: %v", err)
	}
	if finishedJob.Status != "finished" {
		t.Errorf("expected job status 'finished', got '%s'", finishedJob.Status)
	}

	// 4. 验证日志存在
	logs, err := store.ListJobLogs(ctx, job.ID, 10, 0, "", "asc")
	if err != nil {
		t.Fatalf("failed to list logs: %v", err)
	}
	if len(logs) < 2 {
		t.Errorf("expected at least 2 logs, got %d", len(logs))
	}
}
