package upstream

import (
	"container/list"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"sync/atomic"

	"purifier/internal/model"
)

var safeIDRegex = regexp.MustCompile(`^[A-Za-z0-9]+$`)
var tmpSeq uint64

func AssertSafeID(id string) error {
	if !safeIDRegex.MatchString(id) {
		return errors.New("invalid id")
	}
	return nil
}

type CacheEntry[T any] struct {
	Data      T     `json:"data"`
	MtimeMs   int64 `json:"mtime_ms"`
	SizeBytes int64 `json:"size_bytes"`
}

// 内存 L1 LRU 缓存（容量 500）
const maxMemoryEntries = 500

type memoryLRU struct {
	mu       sync.Mutex
	capacity int
	items    map[string]*list.Element
	evict    *list.List
}

type memEntry struct {
	key string
	val any
}

var globalMemLRU = &memoryLRU{
	capacity: maxMemoryEntries,
	items:    make(map[string]*list.Element),
	evict:    list.New(),
}

func (c *memoryLRU) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if elem, ok := c.items[key]; ok {
		c.evict.MoveToFront(elem)
		return elem.Value.(*memEntry).val, true
	}
	return nil, false
}

func (c *memoryLRU) set(key string, val any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if elem, ok := c.items[key]; ok {
		c.evict.MoveToFront(elem)
		elem.Value.(*memEntry).val = val
		return
	}
	elem := c.evict.PushFront(&memEntry{key: key, val: val})
	c.items[key] = elem
	if c.evict.Len() > c.capacity {
		oldest := c.evict.Back()
		if oldest != nil {
			c.evict.Remove(oldest)
			delete(c.items, oldest.Value.(*memEntry).key)
		}
	}
}

func (c *memoryLRU) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]*list.Element)
	c.evict.Init()
}

func ContentCachePath(dataDir, site string, kind model.ItemKind, id string, chapter *string) (string, error) {
	if err := AssertSafeID(site); err != nil {
		return "", err
	}
	if err := AssertSafeID(id); err != nil {
		return "", err
	}
	ch := ""
	if chapter != nil && *chapter != "" {
		if err := AssertSafeID(*chapter); err != nil {
			return "", err
		}
		ch = "-ch" + *chapter
	}
	return filepath.Join(dataDir, "cache", site, fmt.Sprintf("%s-%s%s.html", kind, id, ch)), nil
}

func RepliesCachePath(dataDir, site, id string) (string, error) {
	if err := AssertSafeID(site); err != nil {
		return "", err
	}
	if err := AssertSafeID(id); err != nil {
		return "", err
	}
	return filepath.Join(dataDir, "cache", site, fmt.Sprintf("replies-%s.json", id)), nil
}

func uniqueTmpPath(path string) string {
	seq := atomic.AddUint64(&tmpSeq, 1)
	return fmt.Sprintf("%s.%d-%d.tmp", path, os.Getpid(), seq)
}

func ReadContentCache(dataDir, site string, kind model.ItemKind, id string, chapter *string) (*CacheEntry[string], error) {
	path, err := ContentCachePath(dataDir, site, kind, id, chapter)
	if err != nil {
		return nil, err
	}

	// 1. 尝试从内存 L1 读取
	if val, ok := globalMemLRU.get(path); ok {
		if entry, ok := val.(*CacheEntry[string]); ok {
			return entry, nil
		}
	}

	// 2. 内存未命中，从磁盘 L2 读取
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entry := &CacheEntry[string]{
		Data:      string(data),
		MtimeMs:   info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
	}

	// 写入内存 L1
	globalMemLRU.set(path, entry)
	return entry, nil
}

func WriteContentCache(dataDir, site string, kind model.ItemKind, id string, html string, chapter *string) error {
	path, err := ContentCachePath(dataDir, site, kind, id, chapter)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := uniqueTmpPath(path)
	if err := os.WriteFile(tmp, []byte(html), 0644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}

	// 同步放入内存 L1
	globalMemLRU.set(path, &CacheEntry[string]{
		Data:      html,
		MtimeMs:   0,
		SizeBytes: int64(len(html)),
	})
	return nil
}

func ReadRepliesCache(dataDir, site, id string) (*CacheEntry[[]byte], error) {
	path, err := RepliesCachePath(dataDir, site, id)
	if err != nil {
		return nil, err
	}

	if val, ok := globalMemLRU.get(path); ok {
		if entry, ok := val.(*CacheEntry[[]byte]); ok {
			return entry, nil
		}
	}

	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	entry := &CacheEntry[[]byte]{
		Data:      data,
		MtimeMs:   info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
	}
	globalMemLRU.set(path, entry)
	return entry, nil
}

func WriteRepliesCache(dataDir, site, id string, data json.RawMessage) error {
	path, err := RepliesCachePath(dataDir, site, id)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := uniqueTmpPath(path)
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}

	globalMemLRU.set(path, &CacheEntry[[]byte]{
		Data:      data,
		MtimeMs:   0,
		SizeBytes: int64(len(data)),
	})
	return nil
}

func ClearContentCache(dataDir string) (int, error) {
	cacheRoot := filepath.Join(dataDir, "cache")
	if _, err := os.Stat(cacheRoot); errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}

	count := 0
	_ = filepath.Walk(cacheRoot, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			count++
		}
		return nil
	})

	err := os.RemoveAll(cacheRoot)
	globalMemLRU.clear()
	return count, err
}
