const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0"
const DEFAULT_TIMEOUT_MS = 15_000

export class UpstreamTimeoutError extends Error {
  constructor(message = "upstream timeout") {
    super(message)
    this.name = "UpstreamTimeoutError"
  }
}

/**
 * Fetch an upstream URL with timeout and a stable browser-like UA.
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
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        ...Object.fromEntries(new Headers(headers).entries()),
      },
    })
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

/** Short CDN/browser cache for list endpoints. */
export const LIST_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const

/** Content pages change less often. */
export const CONTENT_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
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
