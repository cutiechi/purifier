import { NextRequest } from "next/server"
import { getExtractor, ExtractorError } from "@/lib/extractor"
import {
  CONTENT_CACHE_HEADERS,
  LIST_CACHE_HEADERS,
  UpstreamTimeoutError,
  fetchUpstream,
  jsonError,
  jsonOk,
} from "@/lib/upstream"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tid = searchParams.get("tid")

    const extractor = getExtractor("cool18")

    // 没有 tid 时获取首页链接列表（支持 mtid 游标分页，配合前端无限滚动）
    if (!tid) {
      const mtid = searchParams.get("mtid") || "0"
      const { links, nextMtid } = await extractor.fetchHomeLinks(mtid)
      return jsonOk({ links, nextMtid }, LIST_CACHE_HEADERS)
    }

    const url = extractor.buildUrl(tid)

    const [resp, replies] = await Promise.all([
      fetchUpstream(url),
      extractor.fetchReplies(tid).catch(() => [] as Awaited<
        ReturnType<typeof extractor.fetchReplies>
      >),
    ])

    if (!resp.ok) {
      return jsonError(`upstream error: ${resp.status}`, 502)
    }

    const html = await resp.text()

    const { title, content, meta } = extractor.extractContent(html)
    const links = extractor.extractLinks(html)

    // 列表条数往往比 JSON-LD commentCount 更贴近「跟帖数」
    if (replies.length > 0) {
      const countReplies = (nodes: typeof replies): number =>
        nodes.reduce((n, node) => n + 1 + countReplies(node.children), 0)
      meta.comments = countReplies(replies)
    }

    return jsonOk(
      { title, content, links, meta, replies, url },
      CONTENT_CACHE_HEADERS
    )
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
