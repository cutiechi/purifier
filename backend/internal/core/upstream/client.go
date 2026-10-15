package upstream

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/net/html/charset"
	"golang.org/x/sync/singleflight"
)

type Client struct {
	httpClient *http.Client
	sfGroup    singleflight.Group
}

func NewClient(proxyURL string, timeout time.Duration) *Client {
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}

	if proxyURL != "" {
		if pURL, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(pURL)
		}
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}

	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	return &Client{
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
	}
}

// Fetch 抓取并自动转码为 UTF-8 HTML
func (c *Client) Fetch(ctx context.Context, targetURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("upstream error: %d", resp.StatusCode)
	}

	rawBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	utf8Reader, err := charset.NewReader(bytes.NewReader(rawBytes), contentType)
	if err != nil {
		return string(rawBytes), nil
	}

	utf8Bytes, err := io.ReadAll(utf8Reader)
	if err != nil {
		return string(rawBytes), nil
	}

	return string(utf8Bytes), nil
}

// FetchSingleflight 针对相同 key 的请求进行协程防击穿
func (c *Client) FetchSingleflight(ctx context.Context, key string, fetchFn func() (string, error)) (string, error) {
	v, err, _ := c.sfGroup.Do(key, func() (any, error) {
		return fetchFn()
	})
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", errors.New("unexpected type from singleflight")
	}
	return s, nil
}
