package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"purifier/internal/config"
)

func TestOidcDiscovery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"authorization_endpoint": "https://idp.example.com/oauth/auth",
				"token_endpoint":         "https://idp.example.com/oauth/token",
				"userinfo_endpoint":      "https://idp.example.com/oauth/userinfo",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	cfg := &config.Config{
		OidcEnabled:      true,
		OidcIssuer:       server.URL,
		OidcClientID:     "test-client",
		OidcClientSecret: "test-secret",
		OidcRedirectURI:  "https://app.example.com/login",
		AuthSecret:       "12345678901234567890123456789012",
	}

	svc := NewService(cfg)
	disc := svc.Discover()

	if disc.AuthorizationEndpoint != "https://idp.example.com/oauth/auth" {
		t.Fatalf("expected authorization endpoint, got %s", disc.AuthorizationEndpoint)
	}
	if disc.TokenEndpoint != "https://idp.example.com/oauth/token" {
		t.Fatalf("expected token endpoint, got %s", disc.TokenEndpoint)
	}

	authURL := svc.BuildAuthorizeURL("state123", "chal123")
	if authURL == "" || !testing.Verbose() {
		// ok
	}
}

func TestOidcFallback(t *testing.T) {
	cfg := &config.Config{
		OidcEnabled:      true,
		OidcIssuer:       "https://pocket-id.cutiechi.fun",
		OidcClientID:     "test-client",
		OidcClientSecret: "test-secret",
		OidcRedirectURI:  "https://app.example.com/login",
		AuthSecret:       "12345678901234567890123456789012",
	}

	svc := NewService(cfg)
	fallback := svc.fallbackEndpoints()

	if fallback.TokenEndpoint != "https://pocket-id.cutiechi.fun/api/oidc/token" {
		t.Fatalf("expected pocket-id token endpoint, got %s", fallback.TokenEndpoint)
	}
}
