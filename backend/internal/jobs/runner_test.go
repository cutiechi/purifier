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
	waitForStatus(t, store, job.ID, "finished", 10*time.Second)

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

// pausingHandler 挂起在 Checkpoint 上，便于测试暂停/恢复/重启恢复
type pausingHandler struct {
	entered chan struct{}
}

func (h *pausingHandler) Type() string { return "pausing_task" }

func (h *pausingHandler) Run(ctx *JobContext) (any, error) {
	select {
	case h.entered <- struct{}{}:
	default:
	}
	// 持续经过检查点：暂停请求可能在本 goroutine 首次 Checkpoint 之后才到，
	// 单次检查点会让任务先跑完，测试随调度抖动。
	for range 100 {
		if err := ctx.Checkpoint(); err != nil {
			return nil, err
		}
		if err := ctx.Sleep(5 * time.Millisecond); err != nil {
			return nil, err
		}
		select {
		case h.entered <- struct{}{}:
		default:
		}
	}
	return map[string]any{"ok": true}, nil
}

func newTestStore(t *testing.T) (*storage.Store, func()) {
	t.Helper()
	db, err := storage.OpenDB(t.TempDir())
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	return storage.NewStore(db), func() { _ = db.Close() }
}

// 回归：MarkRunning 失败不得把行留在 pending（否则该类型永久无法再启动）。
// 用 DB 触发器强制 UPDATE jobs SET status='running' 失败，复现真实可达的故障路径。
func TestStartDoesNotLeaveStuckPending(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// 让任何 running 迁移都失败（等价于 MarkRunning 返回 error）
	if _, err := store.DB().ExecContext(ctx, `
		CREATE TRIGGER block_running BEFORE UPDATE ON jobs
		WHEN NEW.status = 'running'
		BEGIN SELECT RAISE(ABORT, 'blocked for test'); END;`); err != nil {
		t.Fatalf("failed to install trigger: %v", err)
	}

	runner := NewRunner(store)
	runner.Register(&dummyHandler{})

	if _, err := runner.Start(ctx, "dummy_task", nil); err == nil {
		t.Fatal("expected Start to fail while running-transition is blocked")
	}

	// 关键不变量：失败的启动不得留下任何活动态行
	res, err := store.ListJobs(ctx, storage.JobListQuery{Status: "active", Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 0 {
		t.Fatalf("stuck active job(s) after failed start: %d", res.Total)
	}
	hasRunning, err := store.HasRunningOfType(ctx, "dummy_task")
	if err != nil {
		t.Fatal(err)
	}
	if hasRunning {
		t.Fatal("HasRunningOfType still true -> this job type can never start again")
	}

	// 解除故障后必须能正常启动
	if _, err := store.DB().ExecContext(ctx, "DROP TRIGGER block_running"); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Start(ctx, "dummy_task", nil); err != nil {
		t.Fatalf("start after clearing the fault should succeed, got: %v", err)
	}
	time.Sleep(150 * time.Millisecond)
}

// 回归：启动恢复必须覆盖全部遗留活动行，不受 ListJobs limit 截断影响
func TestRecoverOnStartupCoversAllActiveJobs(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// 造 150 条残留 running（超过 ListJobs 的 100 上限）
	for i := 0; i < 150; i++ {
		j, err := store.CreateJob(ctx, "dummy_task", nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.MarkRunning(ctx, j.ID); err != nil {
			t.Fatal(err)
		}
	}

	runner := NewRunner(store)
	runner.RecoverOnStartup(ctx)

	res, err := store.ListJobs(ctx, storage.JobListQuery{Status: "active", Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 0 {
		t.Fatalf("expected 0 active jobs after recovery, got %d", res.Total)
	}

	// 恢复后必须能正常启动新任务
	runner.Register(&dummyHandler{})
	if _, err := runner.Start(ctx, "dummy_task", nil); err != nil {
		t.Fatalf("start after recovery should succeed, got: %v", err)
	}
	time.Sleep(150 * time.Millisecond)
}

// 回归：paused 不得在重启后变成死状态 —— 应被重新入队续跑
func TestPausedJobResumesAfterRestart(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	h := &pausingHandler{entered: make(chan struct{}, 1)}
	r1 := NewRunner(store)
	r1.Register(h)

	job, err := r1.Start(ctx, "pausing_task", map[string]any{"site": "1"})
	if err != nil {
		t.Fatal(err)
	}
	<-h.entered
	if !r1.Pause(ctx, job.ID) {
		t.Fatal("pause failed")
	}
	// 确认 DB 中已是 paused
	got, _ := store.GetJob(ctx, job.ID)
	if got.Status != "paused" {
		t.Fatalf("expected paused, got %s", got.Status)
	}

	// 模拟进程重启：新 runner 走恢复路径
	h2 := &pausingHandler{entered: make(chan struct{}, 1)}
	r2 := NewRunner(store)
	r2.Register(h2)
	r2.RecoverOnStartup(ctx)

	// 恢复后不应停在 paused（死状态），最终应完成
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		cur, err := store.GetJob(ctx, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if cur.Status == "finished" || cur.Status == "error" {
			if cur.Status == "error" {
				t.Fatalf("recovered job errored: %v", cur.Error)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	cur, _ := store.GetJob(ctx, job.ID)
	t.Fatalf("paused job stuck after restart, status=%s", cur.Status)
}

// waitForStatus 轮询任务状态，避免用固定 sleep 在慢机器上抖动。
func waitForStatus(t *testing.T, store *storage.Store, id int64, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cur, err := store.GetJob(context.Background(), id)
		if err != nil {
			t.Fatalf("get job: %v", err)
		}
		if cur != nil && string(cur.Status) == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	cur, _ := store.GetJob(context.Background(), id)
	t.Fatalf("job %d did not reach %s within %s (status=%v)", id, want, timeout, cur)
}
