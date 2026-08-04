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
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort)

  try {
    const mergedHeaders: Record<string, string> = {
      "User-Agent": DEFAULT_UA,
      ...Object.fromEntries(new Headers(headers).entries()),
    }

    const proxy = proxyUrl()
    // Bun supports fetch(..., { proxy })
    const opts: RequestInit & { proxy?: string } = {
      ...rest,
      signal: controller.signal,
      headers: mergedHeaders,
    }
    if (proxy && typeof Bun !== "undefined") {
      opts.proxy = proxy
    }

    return await fetch(url, opts)
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new UpstreamTimeoutError()
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
