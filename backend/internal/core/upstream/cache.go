package upstream

import (
	"container/list"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"sync/atomic"
	"time"

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

const (
	// contentTTL 正文/目录缓存有效期。上游帖子会被编辑，缓存不能永久有效。
	contentTTL = 7 * 24 * time.Hour
	// repliesTTL 跟帖缓存有效期，跟帖更新更频繁。
	repliesTTL = 24 * time.Hour
	// cacheMaxBytes 磁盘缓存上限；超过后按最旧修改时间淘汰。
	cacheMaxBytes = 512 << 20
	// pruneEveryWrites 每写多少次触发一次容量巡检（避免每次请求都扫目录）。
	pruneEveryWrites = 200
)

var writeCount atomic.Uint64

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
	if time.Since(info.ModTime()) > contentTTL {
		// 过期即视为未命中：不回 L1，由调用方重新抓取并覆盖
		return nil, nil
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
	maybePruneCache(dataDir)
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
	if time.Since(info.ModTime()) > repliesTTL {
		return nil, nil
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
	maybePruneCache(dataDir)
	return nil
}

type cacheFile struct {
	path  string
	size  int64
	mtime time.Time
}

// maybePruneCache 每 pruneEveryWrites 次写入巡检一次：先删过期文件，
// 再按 mtime 从旧到新淘汰到上限以下。
func maybePruneCache(dataDir string) {
	if writeCount.Add(1)%pruneEveryWrites != 0 {
		return
	}
	cacheRoot := filepath.Join(dataDir, "cache")
	var files []cacheFile
	var total int64
	_ = filepath.Walk(cacheRoot, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		files = append(files, cacheFile{path: p, size: info.Size(), mtime: info.ModTime()})
		total += info.Size()
		return nil
	})

	now := time.Now()
	kept := files[:0]
	for _, f := range files {
		if now.Sub(f.mtime) > contentTTL {
			if os.Remove(f.path) == nil {
				total -= f.size
				continue
			}
		}
		kept = append(kept, f)
	}

	if total > cacheMaxBytes {
		sort.Slice(kept, func(i, j int) bool { return kept[i].mtime.Before(kept[j].mtime) })
		for _, f := range kept {
			if total <= cacheMaxBytes {
				break
			}
			if os.Remove(f.path) == nil {
				total -= f.size
			}
		}
	}
	// 内存 L1 与磁盘可能已不一致：直接清空，后续按需回填
	globalMemLRU.clear()
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

// ---- 列表响应短 TTL 缓存 ----
// 列表/榜单不落盘，但同一进程内重复请求不应每次都打上游。

type listEntry struct {
	body []byte
	// cacheControl 随 body 一起存：详情响应是 max-age=300，列表是 60，
	// 命中缓存时若一律重写成 60 会把正文的缓存策略改错。
	cacheControl string
	expires      time.Time
}

type listCache struct {
	mu      sync.Mutex
	entries map[string]listEntry
	order   []string
	cap     int
}

var listL1 = &listCache{entries: make(map[string]listEntry), cap: 256}

// ListCacheGet 读取未过期的列表缓存，同时返回写入时的 Cache-Control。
func ListCacheGet(key string) ([]byte, string, bool) {
	listL1.mu.Lock()
	defer listL1.mu.Unlock()
	e, ok := listL1.entries[key]
	if !ok || time.Now().After(e.expires) {
		if ok {
			delete(listL1.entries, key)
		}
		return nil, "", false
	}
	return e.body, e.cacheControl, true
}

// ListCacheSet 写入列表缓存，ttl 到期后自动失效。
func ListCacheSet(key string, body []byte, cacheControl string, ttl time.Duration) {
	listL1.mu.Lock()
	defer listL1.mu.Unlock()
	if _, exists := listL1.entries[key]; !exists {
		listL1.order = append(listL1.order, key)
		if len(listL1.order) > listL1.cap {
			oldest := listL1.order[0]
			listL1.order = listL1.order[1:]
			delete(listL1.entries, oldest)
		}
	}
	listL1.entries[key] = listEntry{body: body, cacheControl: cacheControl, expires: time.Now().Add(ttl)}
}

// ListCacheClear 清空列表缓存（清缓存接口与测试用）。
func ListCacheClear() {
	listL1.mu.Lock()
	defer listL1.mu.Unlock()
	listL1.entries = make(map[string]listEntry)
	listL1.order = nil
}
