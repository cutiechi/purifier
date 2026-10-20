package upstream

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
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
		// xbookcn 的标签/搜索页偶发 5–40s 抖动（实测 40s 仍未返回），
		// 15s 会让整个书库分类浏览不可用；留 30s 覆盖正常抖动。
		timeout = 30 * time.Second
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
		if errors.Is(err, context.DeadlineExceeded) {
			return "", &UpstreamTimeoutError{Message: "upstream timeout"}
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return "", &UpstreamTimeoutError{Message: "upstream timeout"}
		}
		return "", fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", UpstreamStatusError(resp.StatusCode)
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

// FetchSingleflight 针对相同 key 的请求进行协程防击穿。
// 共享抓取不绑定任何一个调用方的 ctx：首个调用方取消不会让同 key 的后来者一起失败；
// 调用方自己的 ctx 结束时立刻返回，不再干等。
func (c *Client) FetchSingleflight(ctx context.Context, key string, fetchFn func(context.Context) (string, error)) (string, error) {
	type result struct {
		body string
		err  error
	}
	ch := c.sfGroup.DoChan(key, func() (any, error) {
		// 共享抓取使用独立 ctx（由 http client 超时兜底）
		return fetchFn(context.Background())
	})

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return "", res.Err
		}
		r, ok := res.Val.(result)
		if !ok {
			s, ok := res.Val.(string)
			if !ok {
				return "", errors.New("unexpected type from singleflight")
			}
			return s, nil
		}
		return r.body, r.err
	}
}
