package api

import (
	"net"
	"net/http"
	"sync"
	"time"

	"purifier/internal/pkg/httputil"
)

// maxAPIBodyBytes 限制单个 API 请求体大小。最大的合法请求是批量删除历史
// 或批量删任务（几十个 id），1 MiB 有充足余量，同时挡住把整库塞进内存的写法。
const maxAPIBodyBytes = 1 << 20

// limitBodyMiddleware 给带 body 的请求套 MaxBytesReader。
// 超限时 json 解码会失败，handler 按既有路径返回 400。
func limitBodyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && r.Body != http.NoBody {
			r.Body = http.MaxBytesReader(w, r.Body, maxAPIBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// rateLimiter 是按 key（通常是客户端 IP）计数的固定窗口限流器。
// 只用于会放大成多次上游抓取的端点，不作为通用防护。
type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*rateBucket
}

type rateBucket struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:   limit,
		window:  window,
		buckets: make(map[string]*rateBucket),
	}
}

// allow 返回该 key 在当前窗口是否仍有配额。
// 过期桶在访问时顺带回收，避免 map 无界增长。
func (l *rateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok || now.After(b.reset) {
		l.buckets[key] = &rateBucket{count: 1, reset: now.Add(l.window)}
		if len(l.buckets) > 4096 {
			for k, v := range l.buckets {
				if now.After(v.reset) {
					delete(l.buckets, k)
				}
			}
		}
		return true
	}
	if b.count >= l.limit {
		return false
	}
	b.count++
	return true
}

// middleware 对超过配额的请求返回 429，并带上 Retry-After。
func (l *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientIP(r)
		if !l.allow(key, time.Now()) {
			w.Header().Set("Retry-After", "60")
			httputil.JSONError(w, http.StatusTooManyRequests, "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
