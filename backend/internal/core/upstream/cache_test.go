package upstream

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"purifier/internal/model"
)

// 正文缓存必须有 TTL：过期条目视为未命中，避免永久返回旧正文。
func TestContentCacheExpires(t *testing.T) {
	dir := t.TempDir()
	if err := WriteContentCache(dir, "1", model.KindPost, "123", "<html>old</html>", nil); err != nil {
		t.Fatal(err)
	}
	path, err := ContentCachePath(dir, "1", model.KindPost, "123", nil)
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-contentTTL - time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	globalMemLRU.clear()

	entry, err := ReadContentCache(dir, "1", model.KindPost, "123", nil)
	if err != nil {
		t.Fatal(err)
	}
	if entry != nil {
		t.Fatal("expired entry was returned instead of a cache miss")
	}

	// 新写入的条目必须可读
	if err := WriteContentCache(dir, "1", model.KindPost, "123", "<html>new</html>", nil); err != nil {
		t.Fatal(err)
	}
	entry, err = ReadContentCache(dir, "1", model.KindPost, "123", nil)
	if err != nil {
		t.Fatal(err)
	}
	if entry == nil || entry.Data != "<html>new</html>" {
		t.Fatalf("fresh entry not readable: %+v", entry)
	}
}

// 容量巡检必须把最旧的缓存文件淘汰掉。
func TestCachePruneRespectsSizeBudget(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "cache", "1")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	// 两个过期文件 + 一个新文件
	for _, name := range []string{"a.html", "b.html", "c.html"} {
		p := filepath.Join(sub, name)
		if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		when := time.Now().Add(-contentTTL - time.Hour)
		if name == "c.html" {
			when = time.Now()
		}
		_ = os.Chtimes(p, when, when)
	}

	maybePruneCache(dir + "/../never") // 非目标目录，不应影响
	writeCount.Store(pruneEveryWrites - 1)
	maybePruneCache(dir)

	if _, err := os.Stat(filepath.Join(sub, "a.html")); !os.IsNotExist(err) {
		t.Fatal("expired file a.html was not pruned")
	}
	if _, err := os.Stat(filepath.Join(sub, "c.html")); err != nil {
		t.Fatal("fresh file c.html was pruned")
	}
}
