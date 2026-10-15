package storage_test

import (
	"context"
	"testing"

	"purifier/internal/model"
	"purifier/internal/storage"
)

func TestPickHue(t *testing.T) {
	// 空列表应返回 85
	if h := storage.PickHue(nil); h != 85 {
		t.Fatalf("expected 85, got %d", h)
	}

	// [85] 的最大环形距离对应 265
	if h := storage.PickHue([]int{85}); h != 265 {
		t.Fatalf("expected 265, got %d", h)
	}

	// 去重测试 [85, 85]
	if h := storage.PickHue([]int{85, 85}); h != 265 {
		t.Fatalf("expected 265, got %d", h)
	}
}

func TestCharactersLifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := storage.OpenDB(tmpDir)
	if err != nil {
		t.Fatalf("init db failed: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	ctx := context.Background()

	scope := model.CharacterScope{Type: "post", ID: "12345"}

	// 1. 添加角色
	c1, err := store.AddCharacter(ctx, scope, "Alice", nil)
	if err != nil {
		t.Fatalf("add Alice failed: %v", err)
	}
	if len(c1.Names) != 1 || c1.Names[0] != "Alice" {
		t.Fatalf("unexpected names: %v", c1.Names)
	}

	// 2. 幂等添加已有角色
	c1Same, err := store.AddCharacter(ctx, scope, "Alice", nil)
	if err != nil {
		t.Fatalf("re-add Alice failed: %v", err)
	}
	if c1Same.ID != c1.ID {
		t.Fatalf("expected same cluster id %d, got %d", c1.ID, c1Same.ID)
	}

	// 3. 将 Bob 加到同一个 cluster
	c1WithBob, err := store.AddCharacter(ctx, scope, "Bob", &c1.ID)
	if err != nil {
		t.Fatalf("add Bob to c1 failed: %v", err)
	}
	if len(c1WithBob.Names) != 2 {
		t.Fatalf("expected 2 names in cluster, got %d", len(c1WithBob.Names))
	}

	// 4. 将 Charlie 作为一个新 cluster
	c2, err := store.AddCharacter(ctx, scope, "Charlie", nil)
	if err != nil {
		t.Fatalf("add Charlie failed: %v", err)
	}
	if c2.ID == c1.ID {
		t.Fatalf("expected new cluster id")
	}

	// 5. 变色 recolor
	clusters, err := store.RecolorCluster(ctx, scope, c2.ID, 180)
	if err != nil {
		t.Fatalf("recolor failed: %v", err)
	}
	for _, c := range clusters {
		if c.ID == c2.ID && c.Hue != 180 {
			t.Fatalf("expected hue 180, got %d", c.Hue)
		}
	}

	// 6. 合并 clusters
	merged, err := store.MergeClusters(ctx, scope, []int64{c1.ID, c2.ID}, 210)
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged cluster, got %d", len(merged))
	}
	if len(merged[0].Names) != 3 {
		t.Fatalf("expected 3 names, got %d", len(merged[0].Names))
	}

	// 7. 分割 split
	splitRes, err := store.SplitCharacter(ctx, scope, merged[0].ID, "Bob")
	if err != nil {
		t.Fatalf("split failed: %v", err)
	}
	if len(splitRes) != 2 {
		t.Fatalf("expected 2 clusters after split, got %d", len(splitRes))
	}

	// 8. 删除角色
	removed, err := store.RemoveCharacter(ctx, scope, "Bob")
	if err != nil {
		t.Fatalf("remove Bob failed: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected 1 removed, got %d", removed)
	}

	// 9. 导出备份测试
	backup, err := store.ExportBackup(ctx)
	if err != nil {
		t.Fatalf("export backup failed: %v", err)
	}
	if backup.Version != 3 {
		t.Fatalf("expected backup version 3, got %d", backup.Version)
	}
	if len(backup.CharacterNames) != 2 {
		t.Fatalf("expected 2 character names, got %d", len(backup.CharacterNames))
	}
}
