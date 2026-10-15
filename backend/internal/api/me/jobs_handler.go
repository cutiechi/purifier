package me

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"purifier/internal/jobs"
	"purifier/internal/model"
	"purifier/internal/pkg/httputil"
	"purifier/internal/storage"
)

type JobController struct {
	store  *storage.Store
	runner *jobs.JobRunner
}

func NewJobController(store *storage.Store, runner *jobs.JobRunner) *JobController {
	return &JobController{
		store:  store,
		runner: runner,
	}
}

func (c *JobController) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/", c.HandleListJobs)
	r.Post("/", c.HandleStartJob)
	r.Delete("/", c.HandleDeleteJobsBatch)

	r.Get("/{id}", c.HandleGetJob)
	r.Delete("/{id}", c.HandleDeleteJob)
	r.Get("/{id}/logs", c.HandleGetJobLogs)
	r.Post("/{id}/stop", c.HandleStopJob)
	r.Post("/{id}/pause", c.HandlePauseJob)
	r.Post("/{id}/resume", c.HandleResumeJob)

	return r
}

func (c *JobController) HandleListJobs(w http.ResponseWriter, r *http.Request) {
	q := storage.JobListQuery{
		Type:   r.URL.Query().Get("type"),
		Status: r.URL.Query().Get("status"),
		Sort:   r.URL.Query().Get("sort"),
		Order:  r.URL.Query().Get("order"),
	}
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		q.Offset = o
	}

	res, err := c.store.ListJobs(r.Context(), q)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (c *JobController) HandleStartJob(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Type == "" {
		httputil.JSONError(w, http.StatusBadRequest, "missing job type")
		return
	}

	job, err := c.runner.Start(r.Context(), body.Type, body.Payload)
	if err != nil {
		if err.Error() == "unknown job type" {
			httputil.JSONError(w, http.StatusBadRequest, "unknown job type")
			return
		}
		if err.Error() == "job already running" {
			httputil.JSONError(w, http.StatusConflict, "job already running")
			return
		}
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"job": job}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleDeleteJobsBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}

	removed, err := c.store.DeleteFinishedJobsBatch(r.Context(), body.IDs)
	if err != nil {
		if err.Error() == "contains active jobs" {
			httputil.JSONError(w, http.StatusConflict, "cannot delete active jobs")
			return
		}
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleGetJob(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	job, err := c.store.GetJob(r.Context(), id)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		httputil.JSONError(w, http.StatusNotFound, "job not found")
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"job": job}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleDeleteJob(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	job, err := c.store.GetJob(r.Context(), id)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		httputil.JSONError(w, http.StatusNotFound, "job not found")
		return
	}

	if job.Status != model.JobStatusFinished && job.Status != model.JobStatusError {
		httputil.JSONError(w, http.StatusConflict, "cannot delete running job")
		return
	}

	_, _ = c.store.DeleteFinishedJob(r.Context(), id)
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleGetJobLogs(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	limit := 200
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		offset = o
	}
	level := r.URL.Query().Get("level")
	order := r.URL.Query().Get("order")

	logs, err := c.store.ListJobLogs(r.Context(), id, limit, offset, level, order)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"items": logs}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleStopJob(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	job, err := c.store.GetJob(r.Context(), id)
	if err != nil || job == nil {
		httputil.JSONError(w, http.StatusNotFound, "job not found")
		return
	}

	if job.Status != model.JobStatusRunning && job.Status != model.JobStatusPaused {
		httputil.JSONError(w, http.StatusConflict, "job is not active")
		return
	}

	c.runner.Stop(id)
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (c *JobController) HandlePauseJob(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok := c.runner.Pause(r.Context(), id)
	if !ok {
		httputil.JSONError(w, http.StatusConflict, "cannot pause job")
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (c *JobController) HandleResumeJob(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok := c.runner.Resume(r.Context(), id)
	if !ok {
		httputil.JSONError(w, http.StatusConflict, "cannot resume job")
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}
