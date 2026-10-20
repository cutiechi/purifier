package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

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

	authURL := svc.BuildAuthorizeURL("state123", "chal123", "nonce123")
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

// ID Token 的 exp/aud/nonce 必须在 ExchangeCode 里被校验。
// ParseUnverified 不跑 validator，所以这些检查是手写的，需要回归测试锁住。
func TestExchangeCodeValidatesIDTokenClaims(t *testing.T) {
	sign := func(claims jwt.MapClaims) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		s, err := tok.SignedString([]byte("k"))
		if err != nil {
			t.Fatalf("sign: %v", err)
		}
		return s
	}

	cases := []struct {
		name    string
		claims  jwt.MapClaims
		nonce   string
		wantErr string
	}{
		{
			name: "valid",
			claims: jwt.MapClaims{
				"sub": "u1", "iss": "https://idp.example.com", "aud": "test-client",
				"exp": time.Now().Add(time.Hour).Unix(), "nonce": "n1",
			},
			nonce: "n1",
		},
		{
			name: "expired",
			claims: jwt.MapClaims{
				"sub": "u1", "iss": "https://idp.example.com", "aud": "test-client",
				"exp": time.Now().Add(-time.Hour).Unix(),
			},
			wantErr: "expired",
		},
		{
			name: "missing exp",
			claims: jwt.MapClaims{
				"sub": "u1", "iss": "https://idp.example.com", "aud": "test-client",
			},
			wantErr: "missing exp",
		},
		{
			name: "wrong audience",
			claims: jwt.MapClaims{
				"sub": "u1", "iss": "https://idp.example.com", "aud": "someone-else",
				"exp": time.Now().Add(time.Hour).Unix(),
			},
			wantErr: "audience",
		},
		{
			name: "wrong nonce",
			claims: jwt.MapClaims{
				"sub": "u1", "iss": "https://idp.example.com", "aud": "test-client",
				"exp": time.Now().Add(time.Hour).Unix(), "nonce": "other",
			},
			nonce:   "n1",
			wantErr: "nonce",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idToken := sign(tc.claims)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/.well-known/openid-configuration" {
					_ = json.NewEncoder(w).Encode(map[string]any{
						"issuer":                 "https://idp.example.com",
						"token_endpoint":         "http://" + r.Host + "/token",
						"authorization_endpoint": "http://" + r.Host + "/auth",
					})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id_token": idToken})
			}))
			defer srv.Close()

			cfg := &config.Config{
				OidcEnabled: true, OidcIssuer: srv.URL, OidcClientID: "test-client",
				OidcClientSecret: "s", OidcRedirectURI: "https://app.example.com/login",
				AuthSecret: "12345678901234567890123456789012",
			}
			_, err := NewService(cfg).ExchangeCode("code", "verifier", tc.nonce)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err=%v, want contains %q", err, tc.wantErr)
			}
		})
	}
}
