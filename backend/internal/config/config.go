package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        int
	Host        string
	DataDir     string
	WebDist     string
	ProxyURL    string
	TZ          string
	DBDriver    string
	DatabaseURL string

	// OIDC 认证配置
	OidcEnabled      bool
	OidcIssuer       string
	OidcClientID     string
	OidcClientSecret string
	OidcRedirectURI  string
	AuthSecret       string
	OidcButtonText   string
}

func Load() *Config {
	port := 3001
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			port = p
		}
	}

	host := os.Getenv("HOSTNAME")
	if host == "" {
		host = "0.0.0.0"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}

	webDist := os.Getenv("WEB_DIST")
	if webDist == "" {
		webDist = "../frontend/dist"
	}

	proxyURL := os.Getenv("HTTPS_PROXY")
	if proxyURL == "" {
		proxyURL = os.Getenv("HTTP_PROXY")
	}

	tz := os.Getenv("TZ")
	if tz == "" {
		tz = "Asia/Shanghai"
	}

	dbDriver := os.Getenv("DB_DRIVER")
	if dbDriver == "" {
		dbDriver = "sqlite"
	}

	issuer := strings.TrimSpace(os.Getenv("OIDC_ISSUER"))
	clientID := strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET"))
	redirectURI := strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URI"))
	authSecret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	buttonText := strings.TrimSpace(os.Getenv("OIDC_BUTTON_TEXT"))
	if buttonText == "" {
		buttonText = "使用 Pocket ID 登录"
	}

	oidcEnabled := issuer != "" && clientID != "" && clientSecret != "" && redirectURI != "" && len(authSecret) >= 32

	return &Config{
		Port:             port,
		Host:             host,
		DataDir:          dataDir,
		WebDist:          webDist,
		ProxyURL:         proxyURL,
		TZ:               tz,
		DBDriver:         dbDriver,
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		OidcEnabled:      oidcEnabled,
		OidcIssuer:       issuer,
		OidcClientID:     clientID,
		OidcClientSecret: clientSecret,
		OidcRedirectURI:  redirectURI,
		AuthSecret:       authSecret,
		OidcButtonText:   buttonText,
	}
}
