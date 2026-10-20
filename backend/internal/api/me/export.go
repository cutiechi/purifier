package me

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"purifier/internal/pkg/httputil"
)

// HandleExportBackup 先流式写入临时文件，成功后才发 200 并回传。
// 这样查询失败不会以 HTTP 200 + 残缺 JSON 的形式交付。
func (h *Handler) HandleExportBackup(w http.ResponseWriter, r *http.Request) {
	tmpDir := filepath.Join(h.dataDir, "tmp")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "failed to prepare export")
		return
	}
	tmp, err := os.CreateTemp(tmpDir, "export-*.json")
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "failed to prepare export")
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	bw := bufio.NewWriterSize(tmp, 256*1024)
	exportErr := h.store.ExportBackup(r.Context(), bw)
	if exportErr == nil {
		exportErr = bw.Flush()
	}
	closeErr := tmp.Close()
	if exportErr != nil {
		httputil.InternalError(w, exportErr)
		return
	}
	if closeErr != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "export failed")
		return
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "export failed")
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "export failed")
		return
	}

	day := time.Now().Format("2006-01-02")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="purifier-backup-%s.json"`, day))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}
