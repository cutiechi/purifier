package api

import (
	"bytes"
	"net/http"
	"time"

	"purifier/internal/core/upstream"
)

// listTTL 是列表/榜单的进程内缓存时长。响应头对外仍是 max-age=60，
// 这里更短，保证上游改动能较快反映出来。
const listTTL = 45 * time.Second

// listCacheControl 是列表响应的缓存头，与 httputil.ListCacheHeaders 一致。
// 中间件只缓存这个头的响应，正文（max-age=300）不进列表缓存。
const listCacheControl = "public, max-age=60, s-maxage=60"

// listCacheMiddleware 缓存成功（200）的 GET 响应，避免每次未命中浏览器缓存的
// 请求都打上游。refresh=1 与任何非 200 都不缓存。
//
// 缓存里连 Cache-Control 一起存：这个中间件也包着 /api/posts?tid= 这类正文响应，
// 命中时若一律重写成列表的 60 秒，会把正文的 300 秒策略改错。
func listCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Query().Get("refresh") == "1" {
			next.ServeHTTP(w, r)
			return
		}

		key := r.URL.Path + "?" + r.URL.RawQuery
		if body, cacheControl, ok := upstream.ListCacheGet(key); ok {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			if cacheControl != "" {
				w.Header().Set("Cache-Control", cacheControl)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
			return
		}

		rec := &bufferedResponse{header: make(http.Header)}
		next.ServeHTTP(rec, r)
		for k, v := range rec.header {
			w.Header()[k] = v
		}
		w.WriteHeader(rec.status)
		_, _ = w.Write(rec.body.Bytes())

		// 只缓存列表响应（LIST_CACHE_HEADERS）。正文响应走 upstream 的内容缓存
		// （L1+磁盘），在这里再存一份既浪费内存，也会让 refresh/清缓存语义变复杂。
		if rec.status == http.StatusOK && rec.header.Get("Cache-Control") == listCacheControl {
			upstream.ListCacheSet(key, rec.body.Bytes(), listCacheControl, listTTL)
		}
	})
}

// bufferedResponse 只收集响应，用于决定是否写入缓存。
//
// 它不实现 http.Flusher：包在 listCacheMiddleware 下面的必须是完整生成
// 响应体的 JSON handler。若将来要挂流式端点，必须绕开这个中间件，
// 否则响应会被缓冲到结束才发出。
type bufferedResponse struct {
	header      http.Header
	body        bytes.Buffer
	status      int
	wroteHeader bool
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if b.wroteHeader {
		return
	}
	b.status = status
	b.wroteHeader = true
}

func (b *bufferedResponse) Write(p []byte) (int, error) {
	if !b.wroteHeader {
		b.WriteHeader(http.StatusOK)
	}
	return b.body.Write(p)
}
