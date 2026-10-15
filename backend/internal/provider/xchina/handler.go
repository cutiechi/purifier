package xchina

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

	r.Get("/home", h.HandleGetHome)
	r.Get("/books/{cid}", h.HandleGetBook)
	r.Get("/books/{cid}/chapters/{chapterId}", h.HandleGetChapter)

	return r
}

func (h *Handler) HandleGetHome(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.GetHome(r.Context())
	if err != nil {
		httputil.JSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
}

func (h *Handler) HandleGetBook(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "cid")
	refresh := r.URL.Query().Get("refresh") == "1"

	res, err := h.svc.GetBook(r.Context(), cid, refresh)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	headers := httputil.ContentCacheHeaders
	if refresh {
		headers = httputil.NoStoreHeaders
	}
	httputil.JSON(w, http.StatusOK, res, headers)
}

func (h *Handler) HandleGetChapter(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "cid")
	chStr := chi.URLParam(r, "chapterId")
	chapter, err := strconv.Atoi(chStr)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid chapter number")
		return
	}
	refresh := r.URL.Query().Get("refresh") == "1"

	res, err := h.svc.GetChapter(r.Context(), cid, chapter, refresh)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	headers := httputil.ContentCacheHeaders
	if refresh {
		headers = httputil.NoStoreHeaders
	}
	httputil.JSON(w, http.StatusOK, res, headers)
}
