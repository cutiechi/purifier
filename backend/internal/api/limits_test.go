package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
