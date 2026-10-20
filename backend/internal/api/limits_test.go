package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 配额用尽后必须拒绝，窗口过去后恢复。
func TestRateLimiterWindow(t *testing.T) {
	l := newRateLimiter(2, time.Minute)
	now := time.Unix(1000, 0)

	if !l.allow("1.2.3.4", now) || !l.allow("1.2.3.4", now) {
		t.Fatal("first two calls should pass")
	}
	if l.allow("1.2.3.4", now) {
		t.Fatal("third call within window should be rejected")
	}
	// 不同 key 独立计数
	if !l.allow("5.6.7.8", now) {
		t.Fatal("other client should not be affected")
	}
	// 窗口过期后恢复
	if !l.allow("1.2.3.4", now.Add(61*time.Second)) {
		t.Fatal("quota should reset after the window")
	}
}

// 过期桶要被回收，避免 map 随访问 IP 无界增长。
func TestRateLimiterReclaimsExpiredBuckets(t *testing.T) {
	l := newRateLimiter(1, time.Minute)
	now := time.Unix(1000, 0)

	// 撑到触发回收的阈值之上，再让它们全部过期。
	for i := range 5000 {
		l.allow(string(rune('a'+i%26))+string(rune('a'+i/26)), now)
	}
	l.allow("fresh", now.Add(2*time.Minute))

	l.mu.Lock()
	n := len(l.buckets)
	l.mu.Unlock()
	if n > 1 {
		t.Fatalf("expired buckets not reclaimed: %d remain", n)
	}
}

// 超限时返回 429 并带 Retry-After。
func TestRateLimiterMiddleware(t *testing.T) {
	l := newRateLimiter(1, time.Minute)
	h := l.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	first := httptest.NewRequest(http.MethodGet, "/api/search?q=x", nil)
	first.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, first)
	if rec.Code != http.StatusOK {
		t.Fatalf("first call code=%d", rec.Code)
	}

	// 同一 IP 不同端口必须共用配额。
	second := httptest.NewRequest(http.MethodGet, "/api/search?q=x", nil)
	second.RemoteAddr = "10.0.0.1:9999"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, second)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second call code=%d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}

	// 另一个 IP 不受影响。
	other := httptest.NewRequest(http.MethodGet, "/api/search?q=x", nil)
	other.RemoteAddr = "10.0.0.2:1234"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, other)
	if rec.Code != http.StatusOK {
		t.Fatalf("other client code=%d", rec.Code)
	}
}

// 超过 1 MiB 的请求体在解码阶段失败，handler 走既有的 400 分支。
func TestBodyLimitMiddleware(t *testing.T) {
	h := limitBodyMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Quote string `json:"quote"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	oversized := `{"quote":"` + strings.Repeat("a", maxAPIBodyBytes+1024) + `"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/me/bookmarks", io.NopCloser(strings.NewReader(oversized)))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized body code=%d, want 400", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/me/bookmarks", io.NopCloser(strings.NewReader(`{"quote":"ok"}`)))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("small body code=%d, want 200", rec.Code)
	}
}
