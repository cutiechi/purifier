import { sleep } from "./sleep"

/**
 * 指数退避（带 jitter）重试：网络抖动/限流时先退避再放弃，
 * 避免单次抖动就整轮任务失败。全部失败抛最后一次错误；
 * signal abort 时立即停止重试。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number
    baseDelayMs: number
    signal?: AbortSignal
    onRetry?: (attempt: number, error: string) => void
  }
): Promise<T> {
  const { attempts, baseDelayMs, signal, onRetry } = opts
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= attempts || signal?.aborted) break
      const jitter = Math.random() * baseDelayMs * 0.5
      onRetry?.(attempt, err instanceof Error ? err.message : String(err))
      await sleep(baseDelayMs * 2 ** (attempt - 1) + jitter, signal)
    }
  }
  throw lastErr
}
