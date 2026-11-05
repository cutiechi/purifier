package api

import (
	"net/http"
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
