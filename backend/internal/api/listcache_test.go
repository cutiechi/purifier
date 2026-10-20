package api

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// 列表缓存必须命中第二次请求，且 refresh=1 必须绕过。
func TestListCacheMiddleware(t *testing.T) {
	var hits atomic.Int32
	handler := listCacheMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Cache-Control", "public, max-age=60, s-maxage=60")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"links":[]}`))
	}))

	do := func(rawQuery string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/trending?"+rawQuery, nil))
		return rec
	}

	first := do("site=1")
	if first.Code != http.StatusOK || first.Body.String() != `{"links":[]}` {
		t.Fatalf("unexpected first response: %d %q", first.Code, first.Body.String())
	}
	second := do("site=1")
	if second.Code != http.StatusOK || second.Body.String() != `{"links":[]}` {
		t.Fatalf("unexpected cached response: %d %q", second.Code, second.Body.String())
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream hit %d times, want 1 (second served from cache)", hits.Load())
	}

	do("site=1&refresh=1")
	if hits.Load() != 2 {
		t.Fatalf("refresh did not bypass cache: hits=%d", hits.Load())
	}

	// 不同 query 是不同缓存键
	do("site=2")
	if hits.Load() != 3 {
		t.Fatalf("distinct query not cached separately: hits=%d", hits.Load())
	}
}

// 非 200 不得进入缓存。
func TestListCacheSkipsErrors(t *testing.T) {
	var hits atomic.Int32
	handler := listCacheMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"upstream"}`))
	}))
	for range 2 {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/featured", nil))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("code=%d", rec.Code)
		}
	}
	if hits.Load() != 2 {
		t.Fatalf("error responses were cached: hits=%d", hits.Load())
	}
}

// 正文响应（max-age=300）不能被列表缓存接管：既不该进缓存，
// 也不该在命中时被改写成列表的 60 秒。
func TestListCacheLeavesContentResponsesAlone(t *testing.T) {
	var hits atomic.Int32
	handler := listCacheMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Cache-Control", "public, max-age=300, s-maxage=300")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"title":"post"}`))
	}))

	for range 2 {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/posts?tid=123&site=1", nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=300, s-maxage=300" {
			t.Fatalf("content Cache-Control rewritten: %q", got)
		}
	}
	if hits.Load() != 2 {
		t.Fatalf("content response was cached by list cache: hits=%d", hits.Load())
	}
}
