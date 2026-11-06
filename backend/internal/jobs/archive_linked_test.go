package jobs

import (
	"context"
	"fmt"
	"testing"
	"time"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
	"purifier/internal/storage"
)

// fakeHarvester 按 tid 返回预设结果，记录每次调用。
type fakeHarvester struct {
	harvest map[string]struct {
		title string
		tids  []string
		err   error
	}
	replyTids map[string][]string
	calls     map[string]int
}

func (f *fakeHarvester) HarvestPost(_ context.Context, tid string) (string, []string, error) {
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[tid]++
	h, ok := f.harvest[tid]
	if !ok {
		return "", nil, upstream.NewExtractorError("content not found", 404)
	}
	return h.title, h.tids, h.err
}

func (f *fakeHarvester) ReplyTids(_ context.Context, tid string) ([]string, error) {
	return f.replyTids[tid], nil
}

func newLinkedTestStore(t *testing.T) *storage.Store {
	t.Helper()
	db, err := storage.OpenDB(t.TempDir())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return storage.NewStore(db)
}

// newLinkedJobCtx 构造可直接调用 job.Run 的 JobContext（store 真实、handle 空转）。
func newLinkedJobCtx(store *storage.Store, payload map[string]any) *JobContext {
	return &JobContext{
		Ctx:     context.Background(),
		Payload: payload,
		store:   store,
		handle:  &runningHandle{},
	}
}

func seedFrontier(t *testing.T, store *storage.Store, site, tid, source string, depth int) {
	t.Helper()
	if _, err := store.EnqueueFrontier(context.Background(), site, []string{tid}, source, depth); err != nil {
		t.Fatalf("seed frontier: %v", err)
	}
}

func frontierState(t *testing.T, store *storage.Store, site, tid string) string {
	t.Helper()
	it, err := store.GetFrontier(context.Background(), site, tid)
	if err != nil {
		t.Fatalf("get frontier: %v", err)
	}
	return it.State
}

func TestArchiveLinkedQueueInsertsAndExpands(t *testing.T) {
	store := newLinkedTestStore(t)
	seedFrontier(t, store, "1", "14635400", "feed", 1)

	h := &fakeHarvester{harvest: map[string]struct {
		title string
		tids  []string
		err   error
	}{
		"14635400": {title: "母马(1-13)", tids: []string{"14635401"}},
		"14635401": {title: "母马(6-9)", tids: nil},
	}}
	job := NewArchiveLinkedJob(h, store)

	res, err := job.Run(newLinkedJobCtx(store, map[string]any{
		"site": "1", "mode": "queue", "batch": float64(10), "delayMs": float64(0),
	}))
	_ = res
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	posts, err := store.ListAllArchivePosts(context.Background(), "1")
	if err != nil {
		t.Fatal(err)
	}
	tids := map[string]bool{}
	for _, p := range posts {
		tids[p.Tid] = true
	}
	if !tids["14635400"] || !tids["14635401"] {
		t.Fatalf("expected both tids archived, got %v", tids)
	}
}

func TestArchiveLinkedDepthCap(t *testing.T) {
	store := newLinkedTestStore(t)
	seedFrontier(t, store, "1", "9", "8", 3) // depth 已到上限

	h := &fakeHarvester{harvest: map[string]struct {
		title string
		tids  []string
		err   error
	}{
		"9": {title: "深链帖", tids: []string{"10"}},
	}}
	job := NewArchiveLinkedJob(h, store)
	if _, err := job.Run(newLinkedJobCtx(store, map[string]any{"mode": "queue", "delayMs": float64(0)})); err != nil {
		t.Fatalf("run: %v", err)
	}

	items, _ := store.ClaimFrontierBatch(context.Background(), "1", 100)
	for _, it := range items {
		if it.Tid == "10" {
			t.Fatal("depth-capped item must not expand children")
		}
	}
}

func TestArchiveLinkedNoContent(t *testing.T) {
	store := newLinkedTestStore(t)
	seedFrontier(t, store, "1", "404", "feed", 1)

	h := &fakeHarvester{} // harvest map 为空 → 404
	job := NewArchiveLinkedJob(h, store)
	if _, err := job.Run(newLinkedJobCtx(store, map[string]any{"mode": "queue", "delayMs": float64(0)})); err != nil {
		t.Fatalf("run: %v", err)
	}
	if got := frontierState(t, store, "1", "404"); got != "nocontent" {
		t.Fatalf("state = %q, want nocontent", got)
	}
}

func TestArchiveLinkedRetryThenError(t *testing.T) {
	store := newLinkedTestStore(t)
	seedFrontier(t, store, "1", "500", "feed", 1)

	h := &fakeHarvester{harvest: map[string]struct {
		title string
		tids  []string
		err   error
	}{
		"500": {err: fmt.Errorf("upstream 502")},
	}}
	job := NewArchiveLinkedJob(h, store)
	jctx := newLinkedJobCtx(store, map[string]any{"mode": "queue", "delayMs": float64(0)})

	for range maxFrontierAttempts {
		if _, err := job.Run(jctx); err != nil {
			t.Fatalf("run: %v", err)
		}
	}
	if got := frontierState(t, store, "1", "500"); got != "error" {
		t.Fatalf("state = %q, want error after %d attempts", got, maxFrontierAttempts)
	}
}

func TestArchiveLinkedHarvestEnqueuesReplyTids(t *testing.T) {
	store := newLinkedTestStore(t)
	now := time.Now().UnixMilli()
	if _, _, err := store.UpsertArchivePosts(context.Background(), []model.ArchivePost{
		{Site: "1", Tid: "14635400", Title: "母马(1-13)", FirstSeenAt: now, ArchivedAt: now},
	}); err != nil {
		t.Fatal(err)
	}

	h := &fakeHarvester{replyTids: map[string][]string{"14635400": {"14635401", "14638195"}}}
	job := NewArchiveLinkedJob(h, store)
	if _, err := job.Run(newLinkedJobCtx(store, map[string]any{"mode": "harvest", "batch": float64(10)})); err != nil {
		t.Fatalf("run: %v", err)
	}

	items, _ := store.ClaimFrontierBatch(context.Background(), "1", 100)
	found := map[string]bool{}
	for _, it := range items {
		found[it.Tid] = true
	}
	if !found["14635401"] || !found["14638195"] {
		t.Fatalf("reply tids not enqueued: %v", found)
	}
}

func TestIsUpstreamStubPage(t *testing.T) {
	stub := []model.ChapterLink{{Title: "++++++++该贴评分完成！"}}
	if !isUpstreamStubPage(stub) {
		t.Fatal("stub page not detected")
	}
	normal := []model.ChapterLink{{Title: "【界能】（1-4）作者：x"}}
	if isUpstreamStubPage(normal) {
		t.Fatal("normal page misdetected as stub")
	}
	if isUpstreamStubPage(nil) {
		t.Fatal("empty links must not be stub")
	}
}
