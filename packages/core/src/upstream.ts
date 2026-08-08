const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0"
const DEFAULT_TIMEOUT_MS = 15_000

function proxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  )
}

export class UpstreamTimeoutError extends Error {
  constructor(message = "upstream timeout") {
    super(message)
    this.name = "UpstreamTimeoutError"
  }
}

/**
 * Fetch upstream HTML with timeout, browser UA, and optional HTTP(S)_PROXY.
 * Uses Bun.native `proxy` option when running on Bun; otherwise plain fetch.
 */
export async function fetchUpstream(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, ...rest } = init
  const controller = new AbortController()
  // 区分「本函数超时」与「外部 signal 取消」，避免客户端取消被记成 504
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort)

  try {
    const mergedHeaders: Record<string, string> = {
      "User-Agent": DEFAULT_UA,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...Object.fromEntries(new Headers(headers).entries()),
    }

    const proxy = proxyUrl()
    // Bun supports fetch(..., { proxy })
    const opts: RequestInit & { proxy?: string } = {
      ...rest,
      signal: controller.signal,
      headers: mergedHeaders,
    }
    if (proxy) {
      if (typeof globalThis.Bun !== "undefined") {
        opts.proxy = proxy
      } else {
        console.warn(
          "[upstream] HTTPS_PROXY set but runtime is not Bun; proxy ignored"
        )
      }
    }

    return await fetch(url, opts)
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      if (timedOut) throw new UpstreamTimeoutError()
      // 外部取消：透传 AbortError，API 可映射为非 504
      throw err
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

export const LIST_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const

export const CONTENT_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
} as const

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const

export function jsonOk(
  data: unknown,
  headers: HeadersInit = LIST_CACHE_HEADERS
): Response {
  return Response.json(data, { headers })
}

export function jsonError(
  error: string,
  status: number,
  headers?: HeadersInit
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: headers ?? {
        "Cache-Control": "no-store",
      },
    }
  )
}
