package upstream

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	return &CacheEntry[string]{
		Data:      string(data),
		MtimeMs:   info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
	}, nil
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
	return os.Rename(tmp, path)
}

func ReadRepliesCache(dataDir, site, id string) (*CacheEntry[[]byte], error) {
	path, err := RepliesCachePath(dataDir, site, id)
	if err != nil {
		return nil, err
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
	return &CacheEntry[[]byte]{
		Data:      data,
		MtimeMs:   info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
	}, nil
}

func WriteRepliesCache(dataDir, site, id string, repliesData any) error {
	path, err := RepliesCachePath(dataDir, site, id)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.Marshal(repliesData)
	if err != nil {
		return err
	}
	tmp := uniqueTmpPath(path)
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
