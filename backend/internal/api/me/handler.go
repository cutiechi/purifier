package me

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"purifier/internal/jobs"
	"purifier/internal/model"
	"purifier/internal/pkg/httputil"
	"purifier/internal/storage"
)

type Handler struct {
	store   *storage.Store
	jobCtrl *JobController
	dataDir string
}

func NewHandler(store *storage.Store, runner *jobs.JobRunner, dataDir string) *Handler {
	return &Handler{
		store:   store,
		jobCtrl: NewJobController(store, runner),
		dataDir: dataDir,
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Mount("/jobs", h.jobCtrl.Routes())

	r.Get("/history", h.HandleListHistory)
	r.Delete("/history", h.HandleDeleteHistory)
	r.Get("/favorites", h.HandleListFavorites)
	r.Put("/favorites", h.HandleAddFavorite)
	r.Delete("/favorites", h.HandleRemoveFavorite)

	r.Get("/tags", h.HandleGetTags)
	r.Put("/tags", h.HandleUpdateTags)
	r.Delete("/tags", h.HandleDeleteTag)
	r.Get("/items", h.HandleListItemsByTag)

	r.Get("/state", h.HandleGetState)
	r.Put("/progress", h.HandleSetProgress)

	r.Get("/bookmarks", h.HandleListBookmarks)
	r.Post("/bookmarks", h.HandleAddBookmark)
	r.Patch("/bookmarks/{id}", h.HandleUpdateBookmark)
	r.Delete("/bookmarks/{id}", h.HandleDeleteBookmark)

	r.Get("/archive/status", h.HandleArchiveStatus)
	r.Get("/archive", h.HandleListArchive)
	r.Delete("/cache", h.HandleClearCache)

	r.Post("/sessions", h.HandleRecordSession)
	r.Get("/stats", h.HandleGetStats)

	r.Get("/groups", h.HandleListGroups)
	r.Put("/groups", h.HandleUpsertGroup)
	r.Delete("/groups/{id}", h.HandleDeleteGroup)
	r.Delete("/groups/{id}/items", h.HandleDeleteGroupItems)
	r.Put("/groups/{id}/favorite", h.HandleFavoriteGroup)
	r.Delete("/groups/{id}/favorite", h.HandleUnfavoriteGroup)

	r.Get("/characters", h.HandleGetCharacters)
	r.Put("/characters", h.HandlePutCharacters)
	r.Patch("/characters", h.HandlePatchCharacters)
	r.Delete("/characters", h.HandleDeleteCharacters)

	r.Get("/export", h.HandleExportBackup)

	return r
}

func (h *Handler) HandleListHistory(w http.ResponseWriter, r *http.Request) {
	q := storage.ListQuery{
		Q:    r.URL.Query().Get("q"),
		Kind: model.ItemKind(r.URL.Query().Get("kind")),
		Site: r.URL.Query().Get("site"),
		Page: 1,
	}
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		q.Page = p
	}

	res, err := h.store.ListHistory(r.Context(), q)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteHistory(w http.ResponseWriter, r *http.Request) {
	// 1. 全部清空 (all=1)
	if r.URL.Query().Get("all") == "1" {
		site := r.URL.Query().Get("site")
		removed, err := h.store.ClearHistory(r.Context(), site)
		if err != nil {
			httputil.JSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed}, httputil.NoStoreHeaders)
		return
	}

	// 2. 批量删除 body: { items: [{site, kind, id}] }
	if r.Body != nil && r.ContentLength > 0 {
		var body struct {
			Items []storage.DeleteItemKey `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && len(body.Items) > 0 {
			removed, err := h.store.DeleteHistoryBatch(r.Context(), body.Items)
			if err != nil {
				httputil.JSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
			httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed}, httputil.NoStoreHeaders)
			return
		}
	}

	// 3. 单条删除: query id & kind
	id := r.URL.Query().Get("id")
	kind := model.ItemKind(r.URL.Query().Get("kind"))
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}

	if id != "" && kind != "" {
		if err := h.store.PurgeItem(r.Context(), site, kind, id); err != nil {
			httputil.JSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "removed": 1}, httputil.NoStoreHeaders)
		return
	}

	httputil.JSONError(w, http.StatusBadRequest, "invalid delete parameters")
}

func (h *Handler) HandleListFavorites(w http.ResponseWriter, r *http.Request) {
	q := storage.ListQuery{
		Q:    r.URL.Query().Get("q"),
		Kind: model.ItemKind(r.URL.Query().Get("kind")),
		Site: r.URL.Query().Get("site"),
		Page: 1,
	}
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		q.Page = p
	}

	res, err := h.store.ListFavorites(r.Context(), q)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleAddFavorite(w http.ResponseWriter, r *http.Request) {
	kind := model.ItemKind(r.URL.Query().Get("kind"))
	id := r.URL.Query().Get("id")
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}

	ok, err := h.store.AddFavorite(r.Context(), site, kind, id)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httputil.JSONError(w, http.StatusNotFound, "item not found")
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	kind := model.ItemKind(r.URL.Query().Get("kind"))
	id := r.URL.Query().Get("id")
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}

	if err := h.store.RemoveFavorite(r.Context(), site, kind, id); err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleGetTags(w http.ResponseWriter, r *http.Request) {
	site := r.URL.Query().Get("site")
	tags, err := h.store.GetTags(r.Context(), site)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"tags": tags}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleUpdateTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Site string   `json:"site"`
		Kind string   `json:"kind"`
		ID   string   `json:"id"`
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Site == "" {
		body.Site = "1"
	}

	ok, err := h.store.UpdateTags(r.Context(), body.Site, model.ItemKind(body.Kind), body.ID, body.Tags)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httputil.JSONError(w, http.StatusNotFound, "item not found")
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "tags": body.Tags}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteTag(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	site := r.URL.Query().Get("site")

	removed, err := h.store.DeleteTag(r.Context(), tag, site)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleListItemsByTag(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	q := storage.ListQuery{
		Q:    r.URL.Query().Get("q"),
		Kind: model.ItemKind(r.URL.Query().Get("kind")),
		Site: r.URL.Query().Get("site"),
		Page: 1,
	}
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		q.Page = p
	}

	res, err := h.store.ListItemsByTag(r.Context(), tag, q)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleGetState(w http.ResponseWriter, r *http.Request) {
	kind := model.ItemKind(r.URL.Query().Get("kind"))
	id := r.URL.Query().Get("id")
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}

	state, err := h.store.GetState(r.Context(), site, kind, id)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if state == nil {
		httputil.JSON(w, http.StatusOK, map[string]any{}, httputil.NoStoreHeaders)
		return
	}
	httputil.JSON(w, http.StatusOK, state, httputil.NoStoreHeaders)
}

func (h *Handler) HandleSetProgress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Site     string   `json:"site"`
		Kind     string   `json:"kind"`
		ID       string   `json:"id"`
		Progress float64  `json:"progress"`
		Chapter  *int     `json:"chapter"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Site == "" {
		body.Site = "1"
	}

	ok, err := h.store.SetProgress(r.Context(), body.Site, model.ItemKind(body.Kind), body.ID, body.Progress, body.Chapter)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httputil.JSONError(w, http.StatusNotFound, "item not found")
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleListBookmarks(w http.ResponseWriter, r *http.Request) {
	kind := model.ItemKind(r.URL.Query().Get("kind"))
	id := r.URL.Query().Get("id")
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}

	if id != "" {
		// 单条目书签查询
		var chapter *int
		if chStr := r.URL.Query().Get("chapter"); chStr != "" {
			if ch, err := strconv.Atoi(chStr); err == nil {
				chapter = &ch
			}
		}
		items, err := h.store.ListBookmarksByItem(r.Context(), site, kind, id, chapter)
		if err != nil {
			httputil.JSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httputil.JSON(w, http.StatusOK, map[string]any{"items": items}, httputil.NoStoreHeaders)
		return
	}

	// 全局分页书签查询
	q := r.URL.Query().Get("q")
	page := 1
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}

	res, err := h.store.ListBookmarks(r.Context(), q, kind, page)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleAddBookmark(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Site           string   `json:"site"`
		Kind           string   `json:"kind"`
		ID             string   `json:"id"`
		Chapter        *int     `json:"chapter"`
		Quote          string   `json:"quote"`
		Note           string   `json:"note"`
		ScrollProgress float64  `json:"scrollProgress"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Site == "" {
		body.Site = "1"
	}

	bm := model.Bookmark{
		Site:           body.Site,
		Kind:           model.ItemKind(body.Kind),
		ItemID:         body.ID,
		Chapter:        body.Chapter,
		Quote:          body.Quote,
		Note:           body.Note,
		ScrollProgress: body.ScrollProgress,
	}

	detail, err := h.store.AddBookmark(r.Context(), bm)
	if err != nil {
		if err.Error() == "item not found" {
			httputil.JSONError(w, http.StatusNotFound, "item not found")
			return
		}
		if err.Error() == "bookmark limit reached" {
			httputil.JSONError(w, http.StatusConflict, "bookmark limit reached (max 50)")
			return
		}
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "bookmark": detail}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleUpdateBookmark(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body struct {
		Note string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}

	if err := h.store.UpdateBookmarkNote(r.Context(), id, body.Note); err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	removed, err := h.store.DeleteBookmark(r.Context(), id)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": removed, "removed": removed}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleArchiveStatus(w http.ResponseWriter, r *http.Request) {
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}
	res, err := h.store.GetArchiveStatus(r.Context(), site)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleListArchive(w http.ResponseWriter, r *http.Request) {
	site := r.URL.Query().Get("site")
	if site == "" {
		site = "1"
	}
	q := r.URL.Query().Get("q")
	page := 1
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}
	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}
	sort := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")

	res, err := h.store.ListArchivePosts(r.Context(), site, q, page, limit, sort, order)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleClearCache(w http.ResponseWriter, r *http.Request) {
	cacheDir := filepath.Join(h.dataDir, "cache")
	cleared := 0
	_ = filepath.Walk(cacheDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			if rmErr := os.Remove(path); rmErr == nil {
				cleared++
			}
		}
		return nil
	})
	httputil.JSON(w, http.StatusOK, map[string]int{"cleared": cleared}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleRecordSession(w http.ResponseWriter, r *http.Request) {
	var input storage.SessionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}

	if input.StartedAt > time.Now().Add(5*time.Minute).UnixMilli() {
		httputil.JSONError(w, http.StatusBadRequest, "startedAt cannot be in future")
		return
	}

	if err := h.store.RecordSession(r.Context(), input); err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleGetStats(w http.ResponseWriter, r *http.Request) {
	site := r.URL.Query().Get("site")
	res, err := h.store.GetStats(r.Context(), site)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleListGroups(w http.ResponseWriter, r *http.Request) {
	q := storage.GroupListQuery{
		Q:         r.URL.Query().Get("q"),
		Favorited: r.URL.Query().Get("favorited") == "1",
		Sort:      r.URL.Query().Get("sort"),
	}
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil {
		q.Page = p
	}
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = l
	}

	res, err := h.store.ListGroups(r.Context(), q)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if q.Page <= 0 && q.Limit <= 0 {
		httputil.JSON(w, http.StatusOK, map[string]any{"groups": res.Items}, httputil.NoStoreHeaders)
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.NoStoreHeaders)
}

func (h *Handler) HandleUpsertGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key    string `json:"key"`
		Title  string `json:"title"`
		Author *string `json:"author"`
		Genre  *string `json:"genre"`
		Items  []struct {
			Tid   string `json:"tid"`
			Title string `json:"title"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Key == "" || body.Title == "" || len(body.Items) == 0 {
		httputil.JSONError(w, http.StatusBadRequest, "key, title and items are required")
		return
	}

	var members []model.GroupItem
	for _, it := range body.Items {
		members = append(members, model.GroupItem{
			Tid:   it.Tid,
			Title: it.Title,
		})
	}

	group, err := h.store.UpsertGroup(r.Context(), body.Key, body.Title, body.Author, body.Genre, members)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{"ok": true, "group": group}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	if err := h.store.DeleteGroup(r.Context(), id); err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteGroupItems(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body struct {
		Items []struct {
			Tid string `json:"tid"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid body")
		return
	}

	var tids []string
	for _, it := range body.Items {
		if it.Tid != "" {
			tids = append(tids, it.Tid)
		}
	}

	removed, deleted, err := h.store.DeleteGroupItems(r.Context(), id, tids)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"removed": removed,
		"deleted": deleted,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleFavoriteGroup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok, err := h.store.ToggleGroupFavorite(r.Context(), id, true)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httputil.JSONError(w, http.StatusNotFound, "group not found")
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleUnfavoriteGroup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid id")
		return
	}

	ok, err := h.store.ToggleGroupFavorite(r.Context(), id, false)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httputil.JSONError(w, http.StatusNotFound, "group not found")
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}


