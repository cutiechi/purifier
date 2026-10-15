package me

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"purifier/internal/model"
	"purifier/internal/pkg/httputil"
	"purifier/internal/storage"
)

func normalizeCharacterName(raw string) string {
	if strings.ContainsAny(raw, "\n\t") {
		return ""
	}
	name := strings.TrimSpace(raw)
	if len(name) < 1 || len(name) > 32 {
		return ""
	}
	return name
}

func parseKindAndID(kindStr, idStr string) (string, string, bool) {
	if kindStr != "post" && kindStr != "book" {
		return "", "", false
	}
	id := strings.TrimSpace(idStr)
	if id == "" {
		return "", "", false
	}
	return kindStr, id, true
}

func (h *Handler) HandleGetCharacters(w http.ResponseWriter, r *http.Request) {
	kind, id, ok := parseKindAndID(r.URL.Query().Get("kind"), r.URL.Query().Get("id"))
	if !ok {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid kind or id"}, httputil.NoStoreHeaders)
		return
	}

	scope, err := h.store.ResolveCharacterScope(r.Context(), kind, id)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	clusters, err := h.store.ListClusters(r.Context(), scope)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"scope":    scope,
		"clusters": clusters,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandlePutCharacters(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind      string `json:"kind"`
		ID        string `json:"id"`
		Name      string `json:"name"`
		ClusterID *int64 `json:"clusterId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"}, httputil.NoStoreHeaders)
		return
	}

	kind, id, ok := parseKindAndID(body.Kind, body.ID)
	if !ok {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid kind or id"}, httputil.NoStoreHeaders)
		return
	}

	name := normalizeCharacterName(body.Name)
	if name == "" {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid name"}, httputil.NoStoreHeaders)
		return
	}

	scope, err := h.store.ResolveCharacterScope(r.Context(), kind, id)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	cluster, err := h.store.AddCharacter(r.Context(), scope, name, body.ClusterID)
	if err != nil {
		if errors.Is(err, storage.ErrCharacterConflict) {
			httputil.JSON(w, http.StatusConflict, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
			return
		}
		if errors.Is(err, storage.ErrNotFound) {
			httputil.JSON(w, http.StatusNotFound, map[string]string{"error": "cluster not found"}, httputil.NoStoreHeaders)
			return
		}
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	clusters, err := h.store.ListClusters(r.Context(), scope)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"cluster":  cluster,
		"clusters": clusters,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleDeleteCharacters(w http.ResponseWriter, r *http.Request) {
	kind, id, ok := parseKindAndID(r.URL.Query().Get("kind"), r.URL.Query().Get("id"))
	if !ok {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid kind or id"}, httputil.NoStoreHeaders)
		return
	}

	name := normalizeCharacterName(r.URL.Query().Get("name"))
	if name == "" {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid name"}, httputil.NoStoreHeaders)
		return
	}

	scope, err := h.store.ResolveCharacterScope(r.Context(), kind, id)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	removed, err := h.store.RemoveCharacter(r.Context(), scope, name)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"removed": removed,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandlePatchCharacters(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind       string  `json:"kind"`
		ID         string  `json:"id"`
		Op         string  `json:"op"`
		ClusterID  *int64  `json:"clusterId"`
		ClusterIDs []int64 `json:"clusterIds"`
		Hue        *int    `json:"hue"`
		Name       *string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"}, httputil.NoStoreHeaders)
		return
	}

	kind, id, ok := parseKindAndID(body.Kind, body.ID)
	if !ok {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid kind or id"}, httputil.NoStoreHeaders)
		return
	}

	scope, err := h.store.ResolveCharacterScope(r.Context(), kind, id)
	if err != nil {
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	var clusters []model.CharacterCluster

	switch body.Op {
	case "merge":
		if len(body.ClusterIDs) < 2 || body.Hue == nil || *body.Hue < 0 || *body.Hue > 359 {
			httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid merge parameters"}, httputil.NoStoreHeaders)
			return
		}
		clusters, err = h.store.MergeClusters(r.Context(), scope, body.ClusterIDs, *body.Hue)
	case "split":
		if body.ClusterID == nil || body.Name == nil {
			httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid split parameters"}, httputil.NoStoreHeaders)
			return
		}
		name := normalizeCharacterName(*body.Name)
		if name == "" {
			httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid name"}, httputil.NoStoreHeaders)
			return
		}
		clusters, err = h.store.SplitCharacter(r.Context(), scope, *body.ClusterID, name)
	case "recolor":
		if body.ClusterID == nil || body.Hue == nil || *body.Hue < 0 || *body.Hue > 359 {
			httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid recolor parameters"}, httputil.NoStoreHeaders)
			return
		}
		clusters, err = h.store.RecolorCluster(r.Context(), scope, *body.ClusterID, *body.Hue)
	default:
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "invalid op"}, httputil.NoStoreHeaders)
		return
	}

	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			httputil.JSON(w, http.StatusNotFound, map[string]string{"error": "cluster not found"}, httputil.NoStoreHeaders)
			return
		}
		if errors.Is(err, storage.ErrSingletonSplit) || errors.Is(err, storage.ErrInvalidInput) || errors.Is(err, storage.ErrInvalidHue) {
			httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
			return
		}
		httputil.JSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}, httputil.NoStoreHeaders)
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"clusters": clusters,
	}, httputil.NoStoreHeaders)
}
