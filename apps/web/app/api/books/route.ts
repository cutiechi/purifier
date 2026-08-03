import { NextRequest } from "next/server"
import { getExtractor, ExtractorError } from "@/lib/extractor"
import {
  CONTENT_CACHE_HEADERS,
  UpstreamTimeoutError,
  fetchUpstream,
  jsonError,
  jsonOk,
} from "@/lib/upstream"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cid = searchParams.get("cid")

    if (!cid) {
      return jsonError("missing cid parameter", 400)
    }

    const extractor = getExtractor("cool18")
    const url = extractor.buildBookUrl(cid)

    const resp = await fetchUpstream(url, {
      headers: { Referer: extractor.homeUrl },
    })

    if (!resp.ok) {
      return jsonError(`upstream error: ${resp.status}`, 502)
    }

    const html = await resp.text()
    const { title, content, meta } = extractor.extractBookContent(html)

    return jsonOk({ title, content, meta, url, cid }, CONTENT_CACHE_HEADERS)
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return jsonError("upstream timeout", 504)
    }

    if (err instanceof ExtractorError) {
      return jsonError(err.message, err.statusCode)
    }

    if (err instanceof Error) {
      return jsonError(err.message, 500)
    }

    return jsonError("unknown error", 500)
  }
}
