package upstream

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
)

// ExtractorError 携带可映射到 HTTP 状态码的抓取/解析错误。
// AGENTS.md 约定：ExtractorError 使用其 statusCode；上游非 2xx 为 502。
type ExtractorError struct {
	Message    string
	StatusCode int
}

func (e *ExtractorError) Error() string { return e.Message }

func NewExtractorError(message string, statusCode int) *ExtractorError {
	return &ExtractorError{Message: message, StatusCode: statusCode}
}

// UpstreamTimeoutError 上游超时，映射 504。
type UpstreamTimeoutError struct {
	Message string
}

func (e *UpstreamTimeoutError) Error() string { return e.Message }

// ErrorStatus 将领域错误映射为 HTTP 状态码；未知错误回退 500。
func ErrorStatus(err error) (int, string) {
	if err == nil {
		return http.StatusOK, ""
	}

	var extractorErr *ExtractorError
	if errors.As(err, &extractorErr) {
		code := extractorErr.StatusCode
		if code == 0 {
			code = http.StatusInternalServerError
		}
		return code, extractorErr.Message
	}

	var timeoutErr *UpstreamTimeoutError
	if errors.As(err, &timeoutErr) {
		return http.StatusGatewayTimeout, timeoutErr.Message
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusGatewayTimeout, "upstream timeout"
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return http.StatusGatewayTimeout, "upstream timeout"
	}

	if errors.Is(err, context.Canceled) {
		return 499, "request aborted"
	}

	return http.StatusInternalServerError, err.Error()
}

// UpstreamStatusError 把上游非 2xx 归一为 502（404 例外：视为内容不存在）。
func UpstreamStatusError(status int) error {
	if status == http.StatusNotFound || status == http.StatusGone {
		return NewExtractorError("content not found", http.StatusNotFound)
	}
	return NewExtractorError(fmt.Sprintf("upstream error: %d", status), http.StatusBadGateway)
}
