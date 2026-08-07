/**
 * abort-aware sleep：传 signal 时，abort 立即 clearTimeout 并 resolve（不泄漏 timer、不等完整 delay）。
 * signal 可选：不传则退化为普通 setTimeout（测试与无取消需求场景用）。
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) return resolve()
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
