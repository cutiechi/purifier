package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"purifier/internal/config"
)

const (
	CookieSession       = "purifier_session"
	CookieOAuthState    = "purifier_oauth_state"
	CookieOAuthVerifier = "purifier_oauth_verifier"
	SessionMaxAgeSec    = 30 * 24 * 3600 // 30 天
	OAuthCookieMaxAge   = 10 * 60        // 10 分钟
)

type UserClaims struct {
	Sub               string `json:"sub"`
	Name              string `json:"name,omitempty"`
	Email             string `json:"email,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Picture           string `json:"picture,omitempty"`
	jwt.RegisteredClaims
}

type OpenIDConfiguration struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	JwksURI               string `json:"jwks_uri"`
}

type Service struct {
	cfg        *config.Config
	httpClient *http.Client
	mu         sync.RWMutex
	discovery  *OpenIDConfiguration
}

func NewService(cfg *config.Config) *Service {
	return &Service{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func GenerateRandomBase64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func CodeChallengeS256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// SignSession 签发包含用户信息的本地会话 JWT
func (s *Service) SignSession(claims UserClaims) (string, error) {
	now := time.Now()
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(now.Add(time.Duration(SessionMaxAgeSec) * time.Second))

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.AuthSecret))
}

// VerifySession 验证 session JWT
func (s *Service) VerifySession(tokenStr string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &UserClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(s.cfg.AuthSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid session token")
}

// Discover 动态发现 OIDC 端点配置（带内存缓存与安全回退）
func (s *Service) Discover() *OpenIDConfiguration {
	s.mu.RLock()
	if s.discovery != nil {
		disc := s.discovery
		s.mu.RUnlock()
		return disc
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.discovery != nil {
		return s.discovery
	}

	issuer := strings.TrimSuffix(s.cfg.OidcIssuer, "/")
	wellKnown := issuer + "/.well-known/openid-configuration"

	req, err := http.NewRequest(http.MethodGet, wellKnown, nil)
	if err == nil {
		req.Header.Set("Accept", "application/json")
		resp, err := s.httpClient.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				var disc OpenIDConfiguration
				if err := json.NewDecoder(resp.Body).Decode(&disc); err == nil && disc.TokenEndpoint != "" {
					if disc.AuthorizationEndpoint == "" {
						disc.AuthorizationEndpoint = issuer + "/authorize"
					}
					s.discovery = &disc
					return &disc
				}
			}
		}
	}

	// 回退机制
	fallback := s.fallbackEndpoints()
	s.discovery = fallback
	return fallback
}

func (s *Service) fallbackEndpoints() *OpenIDConfiguration {
	issuer := strings.TrimSuffix(s.cfg.OidcIssuer, "/")
	if strings.Contains(s.cfg.OidcIssuer, "pocket-id") {
		return &OpenIDConfiguration{
			Issuer:                issuer,
			AuthorizationEndpoint: issuer + "/authorize",
			TokenEndpoint:         issuer + "/api/oidc/token",
			UserinfoEndpoint:      issuer + "/api/oidc/userinfo",
		}
	}
	if strings.Contains(s.cfg.OidcIssuer, "keycloak") {
		return &OpenIDConfiguration{
			Issuer:                issuer,
			AuthorizationEndpoint: issuer + "/protocol/openid-connect/auth",
			TokenEndpoint:         issuer + "/protocol/openid-connect/token",
			UserinfoEndpoint:      issuer + "/protocol/openid-connect/userinfo",
		}
	}
	return &OpenIDConfiguration{
		Issuer:                issuer,
		AuthorizationEndpoint: issuer + "/authorize",
		TokenEndpoint:         issuer + "/token",
		UserinfoEndpoint:      issuer + "/userinfo",
	}
}

// BuildAuthorizeURL 构造向 OIDC 发起授权跳转的 URL
func (s *Service) BuildAuthorizeURL(state, challenge string) string {
	disc := s.Discover()
	authEndpoint := disc.AuthorizationEndpoint

	params := url.Values{}
	params.Set("client_id", s.cfg.OidcClientID)
	params.Set("redirect_uri", s.cfg.OidcRedirectURI)
	params.Set("response_type", "code")
	params.Set("scope", "openid profile email")
	params.Set("state", state)
	params.Set("code_challenge", challenge)
	params.Set("code_challenge_method", "S256")

	return fmt.Sprintf("%s?%s", authEndpoint, params.Encode())
}

// ExchangeCode 用授权码向 OIDC Token 端点换取 Token 并提取 UserClaims
func (s *Service) ExchangeCode(code, verifier string) (*UserClaims, error) {
	disc := s.Discover()

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", s.cfg.OidcClientID)
	data.Set("client_secret", s.cfg.OidcClientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", s.cfg.OidcRedirectURI)
	data.Set("code_verifier", verifier)

	req, err := http.NewRequest(http.MethodPost, disc.TokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var errResp struct {
			Error            string `json:"error"`
			ErrorDescription string `json:"error_description"`
		}
		if json.Unmarshal(bodyBytes, &errResp) == nil && errResp.Error != "" {
			return nil, fmt.Errorf("%s", errResp.Error)
		}
		return nil, fmt.Errorf("oidc upstream error (%d)", resp.StatusCode)
	}

	type tokenResponse struct {
		IDToken     string `json:"id_token"`
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}

	var tr tokenResponse
	if err := json.Unmarshal(bodyBytes, &tr); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	claims := &UserClaims{}
	if tr.IDToken != "" {
		parser := jwt.NewParser()
		_, _, _ = parser.ParseUnverified(tr.IDToken, claims)
	}

	// 如缺少用户信息且有 AccessToken 与 Userinfo 端点，拉取 userinfo 补全
	if (claims.Sub == "" || claims.Email == "") && tr.AccessToken != "" && disc.UserinfoEndpoint != "" {
		s.fetchUserInfo(tr.AccessToken, disc.UserinfoEndpoint, claims)
	}

	if claims.Sub == "" {
		claims.Sub = "user"
	}

	return claims, nil
}

func (s *Service) fetchUserInfo(accessToken, endpoint string, claims *UserClaims) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var info struct {
			Sub               string `json:"sub"`
			Name              string `json:"name"`
			Email             string `json:"email"`
			PreferredUsername string `json:"preferred_username"`
			Picture           string `json:"picture"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&info); err == nil {
			if claims.Sub == "" {
				claims.Sub = info.Sub
			}
			if claims.Name == "" {
				claims.Name = info.Name
			}
			if claims.Email == "" {
				claims.Email = info.Email
			}
			if claims.PreferredUsername == "" {
				claims.PreferredUsername = info.PreferredUsername
			}
			if claims.Picture == "" {
				claims.Picture = info.Picture
			}
		}
	}
}
