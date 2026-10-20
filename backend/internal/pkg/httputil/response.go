package httputil

import (
	"encoding/json"
	"log"
	"net/http"

	"purifier/internal/core/upstream"
)

var (
	ListCacheHeaders = map[string]string{
		"Cache-Control": "public, max-age=60, s-maxage=60",
	}
	ContentCacheHeaders = map[string]string{
		"Cache-Control": "public, max-age=300, s-maxage=300",
	}
	NoStoreHeaders = map[string]string{
		"Cache-Control": "no-store",
	}
)

// ContentHeaders 是正文类响应的统一缓存策略：刷新或回退旧缓存时不可缓存。
// v1 与兼容层必须共用这一处，避免两套路由的头分叉。
func ContentHeaders(refresh, stale bool) map[string]string {
	if refresh || stale {
		return NoStoreHeaders
	}
	return ContentCacheHeaders
}

func JSON(w http.ResponseWriter, status int, data any, headers map[string]string) {
	for k, v := range headers {
		w.Header().Set(k, v)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

// InternalError 记录真实错误并只回泛化文案，避免把 SQL/路径/代理细节泄露给客户端。
func InternalError(w http.ResponseWriter, err error) {
	log.Printf("[error] %v", err)
	JSONError(w, http.StatusInternalServerError, "internal server error")
}

func JSONError(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg}, NoStoreHeaders)
}

// Error 按领域错误类型映射状态码（ExtractorError/UpstreamTimeoutError 等）。
func Error(w http.ResponseWriter, err error) {
	status, msg := upstream.ErrorStatus(err)
	if msg == "" {
		msg = http.StatusText(status)
	}
	JSONError(w, status, msg)
}
