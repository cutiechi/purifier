package me

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"purifier/internal/pkg/httputil"
)

func (h *Handler) HandleExportBackup(w http.ResponseWriter, r *http.Request) {
	backup, err := h.store.ExportBackup(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	data, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	day := time.Now().Format("2006-01-02")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="purifier-backup-%s.json"`, day))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
