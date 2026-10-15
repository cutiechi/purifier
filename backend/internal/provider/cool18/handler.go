package cool18

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"purifier/internal/pkg/httputil"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/posts", h.HandlePosts)
	r.Get("/posts/{tid}", h.HandleGetPost)
	r.Get("/categories", h.HandleCategories)
	r.Get("/featured", h.HandleFeatured)
	r.Get("/picks", h.HandlePicks)
	r.Get("/comments", h.HandleComments)
	r.Get("/trending", h.HandleTrending)
	r.Get("/browse", h.HandleBrowse)

	return r
}

func (h *Handler) HandlePosts(w http.ResponseWriter, r *http.Request) {
	mtid := r.URL.Query().Get("mtid")

	res, err := h.svc.GetHomePosts(r.Context(), mtid)
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}

	httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
}

func (h *Handler) HandleGetPost(w http.ResponseWriter, r *http.Request) {
	tid := chi.URLParam(r, "tid")
	refresh := r.URL.Query().Get("refresh") == "1"

	res, err := h.svc.GetPost(r.Context(), tid, refresh)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	headers := httputil.ContentCacheHeaders
	if refresh || res.Stale {
		headers = httputil.NoStoreHeaders
	}
	httputil.JSON(w, http.StatusOK, res, headers)
}

func (h *Handler) HandleCategories(w http.ResponseWriter, r *http.Request) {
	links, err := h.svc.GetCategories(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"links": links}, httputil.ListCacheHeaders)
}

func (h *Handler) HandleFeatured(w http.ResponseWriter, r *http.Request) {
	links, err := h.svc.GetFeatured(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"links": links}, httputil.ListCacheHeaders)
}

func (h *Handler) HandlePicks(w http.ResponseWriter, r *http.Request) {
	sections, err := h.svc.GetPicks(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"sections": sections}, httputil.ListCacheHeaders)
}

func (h *Handler) HandleComments(w http.ResponseWriter, r *http.Request) {
	posts, err := h.svc.GetComments(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"posts": posts}, httputil.ListCacheHeaders)
}

func (h *Handler) HandleTrending(w http.ResponseWriter, r *http.Request) {
	posts, err := h.svc.GetTrending(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, map[string]any{"posts": posts}, httputil.ListCacheHeaders)
}

func (h *Handler) HandleBrowse(w http.ResponseWriter, r *http.Request) {
	categoryType := r.URL.Query().Get("type")
	keywords := r.URL.Query().Get("q")
	page := 1
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}

	res, err := h.svc.Browse(r.Context(), categoryType, keywords, page)
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
}
