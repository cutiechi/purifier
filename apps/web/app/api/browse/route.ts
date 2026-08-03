import { NextRequest } from "next/server"
import { getExtractor, ExtractorError } from "@/lib/extractor"
import {
  LIST_CACHE_HEADERS,
  UpstreamTimeoutError,
  jsonError,
  jsonOk,
} from "@/lib/upstream"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const q = searchParams.get("q")
    const page = parseInt(searchParams.get("page") || "1", 10) || 1

    const query = type ? { type } : q ? { keywords: q } : null

    if (!query) {
      return jsonError("missing type or q parameter", 400)
    }

    const extractor = getExtractor("cool18")
    const result = await extractor.fetchCategoryPage(query, page)

    return jsonOk(result, LIST_CACHE_HEADERS)
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
