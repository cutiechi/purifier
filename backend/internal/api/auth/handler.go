package auth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"purifier/internal/auth"
	"purifier/internal/config"
	"purifier/internal/pkg/httputil"
)

type Handler struct {
	cfg *config.Config
	svc *auth.Service
}

func NewHandler(cfg *config.Config, svc *auth.Service) *Handler {
	return &Handler{
		cfg: cfg,
		svc: svc,
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/config", h.HandleConfig)
	r.Get("/me", h.HandleMe)
	r.Post("/authorize", h.HandleAuthorize)
	r.Post("/callback", h.HandleCallback)
	r.Post("/logout", h.HandleLogout)

	return r
}

func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	httputil.JSON(w, http.StatusOK, map[string]any{
		"enabled":    h.cfg.OidcEnabled,
		"buttonText": h.cfg.OidcButtonText,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OidcEnabled {
		httputil.JSON(w, http.StatusOK, map[string]any{
			"enabled": false,
			"user":    nil,
		}, httputil.NoStoreHeaders)
		return
	}

	cookie, err := r.Cookie(auth.CookieSession)
	if err != nil || cookie.Value == "" {
		httputil.JSONError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	claims, err := h.svc.VerifySession(cookie.Value)
	if err != nil {
		httputil.JSONError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	httputil.JSON(w, http.StatusOK, map[string]any{
		"enabled": true,
		"user":    claims,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OidcEnabled {
		httputil.JSONError(w, http.StatusBadRequest, "oidc disabled")
		return
	}

	state, err := auth.GenerateRandomBase64URL(24)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}

	verifier, err := auth.GenerateRandomBase64URL(32)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "failed to generate verifier")
		return
	}

	challenge := auth.CodeChallengeS256(verifier)
	authURL := h.svc.BuildAuthorizeURL(state, challenge)

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieOAuthState,
		Value:    state,
		Path:     "/",
		MaxAge:   auth.OAuthCookieMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieOAuthVerifier,
		Value:    verifier,
		Path:     "/",
		MaxAge:   auth.OAuthCookieMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	httputil.JSON(w, http.StatusOK, map[string]string{"url": authURL}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OidcEnabled {
		httputil.JSONError(w, http.StatusBadRequest, "oidc disabled")
		return
	}

	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.URL == "" {
		httputil.JSONError(w, http.StatusBadRequest, "missing callback url")
		return
	}

	cbURL, err := url.Parse(body.URL)
	if err != nil {
		httputil.JSONError(w, http.StatusBadRequest, "invalid url")
		return
	}

	code := cbURL.Query().Get("code")
	state := cbURL.Query().Get("state")

	stateCookie, err := r.Cookie(auth.CookieOAuthState)
	if err != nil || stateCookie.Value != state {
		httputil.JSONError(w, http.StatusBadRequest, "invalid state")
		return
	}

	verifierCookie, err := r.Cookie(auth.CookieOAuthVerifier)
	if err != nil || verifierCookie.Value == "" {
		httputil.JSONError(w, http.StatusBadRequest, "invalid verifier")
		return
	}

	claims, err := h.svc.ExchangeCode(code, verifierCookie.Value)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "invalid_grant") {
			httputil.JSONError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		httputil.JSONError(w, http.StatusBadGateway, errStr)
		return
	}

	sessionToken, err := h.svc.SignSession(*claims)
	if err != nil {
		httputil.JSONError(w, http.StatusInternalServerError, "failed to sign session")
		return
	}

	// 写入 session cookie
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieSession,
		Value:    sessionToken,
		Path:     "/",
		MaxAge:   auth.SessionMaxAgeSec,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	// 清理 oauth 临时 cookie
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieOAuthState,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieOAuthVerifier,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	httputil.JSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"user": claims,
	}, httputil.NoStoreHeaders)
}

func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieSession,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	httputil.JSON(w, http.StatusOK, map[string]bool{"ok": true}, httputil.NoStoreHeaders)
}

// Middleware 鉴权拦截器
func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.cfg.OidcEnabled {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(auth.CookieSession)
		if err != nil || cookie.Value == "" {
			httputil.JSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		if _, err := h.svc.VerifySession(cookie.Value); err != nil {
			httputil.JSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		next.ServeHTTP(w, r)
	})
}
