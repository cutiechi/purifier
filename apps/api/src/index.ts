/**
 * Pure Bun HTTP — API + optional SPA static files.
 * No Hono / Express / Next.
 */
import { join } from "node:path"
import {
  CONTENT_CACHE_HEADERS,
  ExtractorError,
  LIST_CACHE_HEADERS,
  NO_STORE_HEADERS,
  UpstreamTimeoutError,
  Store,
  fetchUpstream,
  getExtractor,
  jsonError,
  jsonOk,
  openDatabase,
  type ItemKind,
  type ItemState,
  type ListQuery,
  type ReplyNode,
} from "@workspace/core"

// Dev: 3001 (Vite on 3000 proxies /api). Prod Docker sets PORT=3000 + WEB_DIST.
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOSTNAME || "0.0.0.0"
/** Vite build output; when present, non-/api routes serve the SPA. */
const WEB_DIST =
  process.env.WEB_DIST || join(import.meta.dir, "../../web/dist")
const DATA_DIR = process.env.DATA_DIR || "./data"
const store = new Store(openDatabase(DATA_DIR))

function toErrorResponse(err: unknown): Response {
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

function requireGet(req: Request): void {
  if (req.method !== "GET") {
    throw new ExtractorError("method not allowed", 405)
  }
}

function meKindParam(url: URL): ItemKind {
  const kind = url.searchParams.get("kind")
  if (kind !== "post" && kind !== "book") {
    throw new ExtractorError("invalid kind", 400)
  }
  return kind
}

function meIdParam(url: URL): string {
  const id = url.searchParams.get("id") ?? ""
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new ExtractorError("invalid id", 400)
  }
  return id
}

function meListQuery(url: URL): ListQuery {
  const kindRaw = url.searchParams.get("kind")
  let kind: ListQuery["kind"] = ""
  if (kindRaw !== null) {
    if (kindRaw !== "post" && kindRaw !== "book") {
      throw new ExtractorError("invalid kind", 400)
    }
    kind = kindRaw
  }
  return {
    q: url.searchParams.get("q")?.trim() || "",
    kind,
    page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
  }
}

function countReplies(nodes: ReplyNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countReplies(node.children), 0)
}

async function handlePosts(url: URL): Promise<Response> {
  const tid = url.searchParams.get("tid")
  const extractor = getExtractor("cool18")

  if (!tid) {
    const mtid = url.searchParams.get("mtid") || "0"
    const { links, nextMtid } = await extractor.fetchHomeLinks(mtid)
    return jsonOk({ links, nextMtid }, LIST_CACHE_HEADERS)
  }

  const pageUrl = extractor.buildUrl(tid)
  const [resp, replies] = await Promise.all([
    fetchUpstream(pageUrl),
    extractor.fetchReplies(tid).catch(() => [] as ReplyNode[]),
  ])

  if (!resp.ok) {
    return jsonError(`upstream error: ${resp.status}`, 502)
  }

  const html = await resp.text()
  const { title, content, meta } = extractor.extractContent(html)
  const links = extractor.extractLinks(html)

  if (replies.length > 0) {
    meta.comments = countReplies(replies)
  }

  return jsonOk(
    { title, content, links, meta, replies, url: pageUrl },
    CONTENT_CACHE_HEADERS
  )
}

async function handleBooks(url: URL): Promise<Response> {
  const cid = url.searchParams.get("cid")
  if (!cid) return jsonError("missing cid parameter", 400)

  const extractor = getExtractor("cool18")
  const pageUrl = extractor.buildBookUrl(cid)
  const resp = await fetchUpstream(pageUrl, {
    headers: { Referer: extractor.homeUrl },
  })
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)

  const html = await resp.text()
  const { title, content, meta } = extractor.extractBookContent(html)
  return jsonOk(
    { title, content, meta, url: pageUrl, cid },
    CONTENT_CACHE_HEADERS
  )
}

async function handleBrowse(url: URL): Promise<Response> {
  const type = url.searchParams.get("type")
  const q = url.searchParams.get("q")
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1
  const query = type ? { type } : q ? { keywords: q } : null
  if (!query) return jsonError("missing type or q parameter", 400)

  const extractor = getExtractor("cool18")
  const result = await extractor.fetchCategoryPage(query, page)
  return jsonOk(result, LIST_CACHE_HEADERS)
}

async function handleHomeExtract(
  pick: (extractor: ReturnType<typeof getExtractor>, html: string) => unknown
): Promise<Response> {
  const extractor = getExtractor("cool18")
  const resp = await fetchUpstream(extractor.homeUrl)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  return jsonOk(pick(extractor, html), LIST_CACHE_HEADERS)
}

function handleMeHistory(url: URL): Response {
  return jsonOk(store.listHistory(meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeFavorites(url: URL): Response {
  return jsonOk(store.listFavorites(meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeTags(): Response {
  return jsonOk({ tags: store.listTags() }, NO_STORE_HEADERS)
}

function handleMeItems(url: URL): Response {
  const tag = url.searchParams.get("tag")?.trim()
  if (!tag) return jsonError("missing tag parameter", 400)
  return jsonOk(store.listByTag(tag, meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeState(url: URL): Response {
  const kind = meKindParam(url)
  const id = meIdParam(url)
  const state = store.getState(kind, id)
  // 对象不存在返回 200 空状态（visit_count 0）：前端 useItemState 对 !res.ok 静默，
  // 空状态与「未收藏/无标签」UI 等价；正文页打开会先 recordVisit 再查询，正常路径不会出现。
  const empty: ItemState = {
    kind,
    id,
    title: "",
    url: "",
    first_seen_at: 0,
    last_visited_at: 0,
    visit_count: 0,
    favorited: false,
    tags: [],
  }
  return jsonOk(state ?? empty, NO_STORE_HEADERS)
}

async function handleComments(): Promise<Response> {
  const extractor = getExtractor("cool18")
  const resp = await fetchUpstream(`${extractor.homeUrl}?act=cmtrank&y=1`)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  return jsonOk(
    { posts: extractor.extractCmtRankPosts(html) },
    LIST_CACHE_HEADERS
  )
}

async function handleTrending(): Promise<Response> {
  const extractor = getExtractor("cool18")
  const resp = await fetchUpstream(`${extractor.homeUrl}?app=forum&act=hot`)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  return jsonOk(
    { posts: extractor.extractHotPosts(html) },
    LIST_CACHE_HEADERS
  )
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  // Static / SPA first for non-API
  if (req.method === "GET" && !pathname.startsWith("/api")) {
    const spa = await serveSpa(pathname)
    if (spa) return spa
  }

  try {
    switch (pathname) {
      case "/api/health":
        requireGet(req)
        return Response.json({ status: "ok", runtime: "bun" })
      case "/api/posts":
        requireGet(req)
        return await handlePosts(url)
      case "/api/books":
        requireGet(req)
        return await handleBooks(url)
      case "/api/browse":
        requireGet(req)
        return await handleBrowse(url)
      case "/api/categories":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          links: ex.extractCategoryLinks(html),
        }))
      case "/api/featured":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          links: ex.extractGoldLinks(html),
        }))
      case "/api/picks":
        requireGet(req)
        return await handleHomeExtract((ex, html) => ({
          sections: ex.extractRecommendSections(html),
        }))
      case "/api/comments":
        requireGet(req)
        return await handleComments()
      case "/api/trending":
        requireGet(req)
        return await handleTrending()
      case "/api/me/history":
        requireGet(req)
        return handleMeHistory(url)
      case "/api/me/favorites":
        requireGet(req)
        return handleMeFavorites(url)
      case "/api/me/tags":
        requireGet(req)
        return handleMeTags()
      case "/api/me/items":
        requireGet(req)
        return handleMeItems(url)
      case "/api/me/state":
        requireGet(req)
        return handleMeState(url)
      default:
        return jsonError("not found", 404)
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

async function serveSpa(pathname: string): Promise<Response | null> {
  const safe = pathname.replace(/\.\./g, "").split("?")[0] || "/"
  const rel =
    safe === "/" ? "index.html" : safe.startsWith("/") ? safe.slice(1) : safe
  const file = Bun.file(join(WEB_DIST, rel))
  if (await file.exists()) {
    return new Response(file)
  }
  // client-side router fallback
  const index = Bun.file(join(WEB_DIST, "index.html"))
  if (await index.exists()) {
    return new Response(index, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  return null
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: route,
})

console.log(
  `[purifier] bun ${Bun.version} on http://${server.hostname}:${server.port}` +
    ` (web: ${WEB_DIST})`
)
