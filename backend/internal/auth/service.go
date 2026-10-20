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
	CookieOAuthNonce    = "purifier_oauth_nonce"
	SessionMaxAgeSec    = 30 * 24 * 3600 // 30 天
	OAuthCookieMaxAge   = 10 * 60        // 10 分钟
)

type UserClaims struct {
	Sub               string `json:"sub"`
	Name              string `json:"name,omitempty"`
	Email             string `json:"email,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Picture           string `json:"picture,omitempty"`
	// Nonce 只用于校验 ID Token 与授权请求的对应关系，不写入会话。
	Nonce string `json:"nonce,omitempty"`
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
	// fallbackUntil 是「discovery 失败后暂用回退端点」的冷却截止时间。
	// 过期后下次调用会重新尝试 discovery，避免一次启动抖动锁定整个进程生命周期。
	fallbackUntil time.Time
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

// audienceMatches 判断 ID Token 的 aud 是否包含本客户端。
// OIDC Core 3.1.3.7 允许 aud 是字符串或数组。
func audienceMatches(aud jwt.ClaimStrings, clientID string) bool {
	if clientID == "" {
		return false
	}
	for _, a := range aud {
		if a == clientID {
			return true
		}
	}
	return false
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

const discoveryRetryInterval = 5 * time.Minute

// Discover 动态发现 OIDC 端点配置（带内存缓存与安全回退）。
// 回退端点只用于冷却窗口内，窗口过后会重试真实 discovery。
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
	if time.Now().Before(s.fallbackUntil) {
		return s.fallbackEndpoints()
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

	// 回退机制：只记住冷却窗口，不把猜测永久钉死
	fallback := s.fallbackEndpoints()
	s.fallbackUntil = time.Now().Add(discoveryRetryInterval)
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

// BuildAuthorizeURL 构造向 OIDC 发起授权跳转的 URL。
// nonce 会被 IdP 原样写回 ID Token，回调时用于拒绝重放的 token。
func (s *Service) BuildAuthorizeURL(state, challenge, nonce string) string {
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
	if nonce != "" {
		params.Set("nonce", nonce)
	}

	return fmt.Sprintf("%s?%s", authEndpoint, params.Encode())
}

// ExchangeCode 用授权码向 OIDC Token 端点换取 Token 并提取 UserClaims。
// nonce 是授权请求里带的值，非空时必须与 ID Token 内的 nonce 一致。
func (s *Service) ExchangeCode(code, verifier, nonce string) (*UserClaims, error) {
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
		// ID Token 由 token 端点直接返回（TLS + client_secret 认证），
		// 按 OIDC Core 3.1.3.7 可不再验签；但 iss/aud/exp/nonce 必须校验，
		// 否则一个来自其它 client 或已过期的 token 会被当成有效身份。
		// ParseUnverified 只做 base64+JSON 解码，不跑任何 claim 校验，
		// 所以 exp/iat 必须在这里手工检查。
		parser := jwt.NewParser()
		if _, _, err := parser.ParseUnverified(tr.IDToken, claims); err != nil {
			return nil, fmt.Errorf("invalid id token: %w", err)
		}
		if disc.Issuer != "" && claims.Issuer != disc.Issuer {
			return nil, fmt.Errorf("id token issuer mismatch")
		}
		if !audienceMatches(claims.Audience, s.cfg.OidcClientID) {
			return nil, fmt.Errorf("id token audience mismatch")
		}
		now := time.Now()
		if claims.ExpiresAt == nil {
			return nil, fmt.Errorf("id token missing exp")
		}
		if now.After(claims.ExpiresAt.Time) {
			return nil, fmt.Errorf("id token expired")
		}
		if claims.IssuedAt != nil && claims.IssuedAt.Time.After(now.Add(5*time.Minute)) {
			return nil, fmt.Errorf("id token issued in the future")
		}
		if nonce != "" && claims.Nonce != nonce {
			return nil, fmt.Errorf("id token nonce mismatch")
		}
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
