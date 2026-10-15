package httputil

import (
	"encoding/json"
	"net/http"
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
