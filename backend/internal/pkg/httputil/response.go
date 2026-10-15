package httputil

import (
	"encoding/json"
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
