import { getExtractor, ExtractorError } from "@/lib/extractor"
import {
  LIST_CACHE_HEADERS,
  UpstreamTimeoutError,
  fetchUpstream,
  jsonError,
  jsonOk,
} from "@/lib/upstream"

export async function GET() {
  try {
    const extractor = getExtractor("cool18")

    const resp = await fetchUpstream(extractor.homeUrl)

    if (!resp.ok) {
      return jsonError(`upstream error: ${resp.status}`, 502)
    }

    const html = await resp.text()
    const links = extractor.extractCategoryLinks(html)

    return jsonOk({ links }, LIST_CACHE_HEADERS)
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
