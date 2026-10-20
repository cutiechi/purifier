package jobs

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"
)

// 任务控制的领域错误：HTTP 层用 errors.Is 映射状态码，不比对错误字符串。
var (
	ErrUnknownJobType    = errors.New("unknown job type")
	ErrJobAlreadyRunning = errors.New("job already running")
	ErrJobStopped        = errors.New("job stopped by user")
)

// retry 对上游抓取做指数退避重试；ctx 取消立即返回。
func retry(ctx context.Context, attempts int, baseDelay time.Duration, fn func() error) error {
	var lastErr error
	delay := baseDelay
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if lastErr = fn(); lastErr == nil {
			return nil
		}
		if attempt == attempts {
			break
		}
		// 抖动 0–300ms，避免多实例形成同步敲击
		jitter := time.Duration(rand.IntN(300)) * time.Millisecond
		timer := time.NewTimer(delay + jitter)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		delay *= 2
	}
	return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}
