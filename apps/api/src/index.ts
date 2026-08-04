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
  assertSafeId,
  clearCache,
  fetchUpstream,
  getExtractor,
  jsonError,
  jsonOk,
  openDatabase,
  readContentCache,
  readRepliesCache,
  writeContentCache,
  writeRepliesCache,
  type CacheEntry,
  type ItemKind,
  type ItemState,
  type ListQuery,
  type ReplyNode,
} from "@workspace/core"

// Dev: 3001 (Vite on 3000 proxies /api). Prod Docker sets PORT=3000 + WEB_DIST.
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOSTNAME || "0.0.0.0"
/** Vite build output; when present, non-/api routes serve the SPA. */
const WEB_DIST = process.env.WEB_DIST || join(import.meta.dir, "../../web/dist")
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

interface LoadedContent {
  html: string
  fromCache: boolean
  refreshed: boolean
  refreshError?: string
}

/**
 * 正文/书库 HTML 加载：
 * - 无 refresh：先读缓存，命中直接返回；未命中抓上游并落盘
 * - 有 refresh：跳过缓存抓上游，成功覆盖缓存；失败回退旧缓存（stale），无旧缓存则抛错
 */
async function loadCachedContent(
  kind: ItemKind,
  id: string,
  refresh: boolean,
  fetchFn: () => Promise<string>
): Promise<LoadedContent> {
  if (!refresh) {
    const cached = await readContentCache(DATA_DIR, kind, id)
    if (cached) return { html: cached.data, fromCache: true, refreshed: false }
  }
  try {
    const html = await fetchFn()
    await writeContentCache(DATA_DIR, kind, id, html)
    return { html, fromCache: false, refreshed: refresh }
  } catch (err) {
    if (!refresh) throw err
    const cached = await readContentCache(DATA_DIR, kind, id)
    if (cached) {
      return {
        html: cached.data,
        fromCache: true,
        refreshed: false,
        refreshError: err instanceof Error ? err.message : "refresh failed",
      }
    }
    throw err
  }
}

/**
 * 回复加载：成功才写缓存；失败回退旧回复缓存（无则 []），永不导致整个请求失败、不置 stale。
 * 注意：catch 同时覆盖「上游非 2xx（fetchRepliesRaw 抛 502）」与「body 非 JSON（parseReplies 抛 502）」
 * 两类上游失败，均按规格回退旧缓存 / 空数组，符合部分刷新矩阵第 2、4 行；不要改成只 catch 网络错误。
 */
async function loadCachedReplies(
  tid: string,
  refresh: boolean
): Promise<{ replies: ReplyNode[]; fromCache: boolean }> {
  const extractor = getExtractor("cool18")
  // 损坏/截断的回复缓存（JSON.parse 抛错）一律按 miss 处理，绝不让它拖垮正文页（刷新会覆盖写坏文件）
  if (!refresh) {
    let cached: CacheEntry<unknown> | null = null
    try {
      cached = await readRepliesCache(DATA_DIR, tid)
    } catch {
      cached = null
    }
    if (cached && Array.isArray(cached.data)) {
      return { replies: cached.data as ReplyNode[], fromCache: true }
    }
  }
  try {
    const raw = await extractor.fetchRepliesRaw(tid)
    const replies = extractor.parseReplies(raw, tid)
    await writeRepliesCache(DATA_DIR, tid, replies)
    return { replies, fromCache: false }
  } catch {
    let cached: CacheEntry<unknown> | null = null
    try {
      cached = await readRepliesCache(DATA_DIR, tid)
    } catch {
      cached = null
    }
    if (cached && Array.isArray(cached.data)) {
      return { replies: cached.data as ReplyNode[], fromCache: true }
    }
    return { replies: [], fromCache: false }
  }
}

async function handlePosts(url: URL): Promise<Response> {
  const tid = url.searchParams.get("tid")
  const extractor = getExtractor("cool18")

  if (!tid) {
    const mtid = url.searchParams.get("mtid") || "0"
    const { links, nextMtid } = await extractor.fetchHomeLinks(mtid)
    return jsonOk({ links, nextMtid }, LIST_CACHE_HEADERS)
  }

  assertSafeId(tid) // 非法 id → 400

  const refresh = url.searchParams.get("refresh") === "1"
  const pageUrl = extractor.buildUrl(tid)

  const [content, repliesResult] = await Promise.all([
    loadCachedContent("post", tid, refresh, async () => {
      const resp = await fetchUpstream(pageUrl)
      if (!resp.ok) {
        throw new ExtractorError(`upstream error: ${resp.status}`, 502)
      }
      return resp.text()
    }),
    loadCachedReplies(tid, refresh),
  ])

  const {
    title,
    content: bodyHtml,
    meta,
  } = extractor.extractContent(content.html)
  const links = extractor.extractLinks(content.html)

  // cache hit / 刷新时以回复缓存重算评论数（extractContent 不回填 comments）
  if (repliesResult.replies.length > 0) {
    meta.comments = countReplies(repliesResult.replies)
  }

  // 成功解析后记录访问（含 cache hit 与 stale 兜底）
  store.recordVisit("post", tid, title, pageUrl)

  const payload: Record<string, unknown> = {
    title,
    content: bodyHtml,
    links,
    meta,
    replies: repliesResult.replies,
    url: pageUrl,
  }
  if (refresh && !content.refreshed) {
    payload.stale = true
    payload.refreshError = content.refreshError
  }

  const useNoStore = content.fromCache || refresh
  return jsonOk(payload, useNoStore ? NO_STORE_HEADERS : CONTENT_CACHE_HEADERS)
}

async function handleBooks(url: URL): Promise<Response> {
  const cid = url.searchParams.get("cid")
  if (!cid) return jsonError("missing cid parameter", 400)
  assertSafeId(cid)

  const refresh = url.searchParams.get("refresh") === "1"
  const extractor = getExtractor("cool18")
  const pageUrl = extractor.buildBookUrl(cid)

  const content = await loadCachedContent("book", cid, refresh, async () => {
    const resp = await fetchUpstream(pageUrl, {
      headers: { Referer: extractor.homeUrl },
    })
    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }
    return resp.text()
  })

  const {
    title,
    content: bodyHtml,
    meta,
  } = extractor.extractBookContent(content.html)

  store.recordVisit("book", cid, title, pageUrl)

  const payload: Record<string, unknown> = {
    title,
    content: bodyHtml,
    meta,
    url: pageUrl,
    cid,
  }
  if (refresh && !content.refreshed) {
    payload.stale = true
    payload.refreshError = content.refreshError
  }

  const useNoStore = content.fromCache || refresh
  return jsonOk(payload, useNoStore ? NO_STORE_HEADERS : CONTENT_CACHE_HEADERS)
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

/**
 * 删除历史：
 * - ?all=1 → 清空全部
 * - ?kind=&id= → 删除单条
 * - body { items: [{kind,id}] } → 批量（清空本页）
 */
async function handleHistoryDelete(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (url.searchParams.get("all") === "1") {
    const removed = store.clearHistory()
    return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
  }

  const kindRaw = url.searchParams.get("kind")
  const idRaw = url.searchParams.get("id")
  if (kindRaw !== null || idRaw !== null) {
    const kind = meKindParam(url)
    const id = meIdParam(url)
    const existed = store.deleteItem(kind, id)
    return jsonOk({ ok: true, removed: existed ? 1 : 0 }, NO_STORE_HEADERS)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(
      "missing all=1, kind+id, or JSON body { items: [{kind,id}] }",
      400
    )
  }
  const items = (body as { items?: unknown })?.items
  if (
    !Array.isArray(items) ||
    !items.every(
      (it) =>
        it &&
        typeof it === "object" &&
        ((it as { kind?: unknown }).kind === "post" ||
          (it as { kind?: unknown }).kind === "book") &&
        typeof (it as { id?: unknown }).id === "string" &&
        /^[A-Za-z0-9]+$/.test((it as { id: string }).id)
    )
  ) {
    return jsonError("items must be {kind,id}[]", 400)
  }
  const pairs = (items as Array<{ kind: "post" | "book"; id: string }>).map(
    (it) => ({ kind: it.kind, id: it.id })
  )
  const removed = store.deleteItems(pairs)
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
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

async function handleFavoriteWrite(
  req: Request,
  favorite: boolean
): Promise<Response> {
  const url = new URL(req.url)
  const kind = meKindParam(url)
  const id = meIdParam(url)
  if (favorite) {
    const ok = store.addFavorite(kind, id)
    if (!ok) return jsonError("item not found", 404)
  } else {
    store.removeFavorite(kind, id)
  }
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

async function handleTagsWrite(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("invalid json body", 400)
  }
  const b = (body ?? {}) as { kind?: unknown; id?: unknown; tags?: unknown }
  if (b.kind !== "post" && b.kind !== "book") {
    return jsonError("invalid kind", 400)
  }
  if (typeof b.id !== "string" || !/^[A-Za-z0-9]+$/.test(b.id)) {
    return jsonError("invalid id", 400)
  }
  if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string")) {
    return jsonError("tags must be string[]", 400)
  }
  const tags = store.setTags(b.kind, b.id, b.tags as string[])
  if (tags === null) return jsonError("item not found", 404)
  return jsonOk({ ok: true, tags }, NO_STORE_HEADERS)
}

/** 全局删除某一标签（所有对象上的该标签行） */
function handleTagDelete(url: URL): Response {
  const tag = url.searchParams.get("tag")?.trim()
  if (!tag) return jsonError("missing tag parameter", 400)
  const removed = store.deleteTag(tag)
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}

async function handleCacheClear(): Promise<Response> {
  const cleared = await clearCache(DATA_DIR)
  return jsonOk({ cleared }, NO_STORE_HEADERS)
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
  return jsonOk({ posts: extractor.extractHotPosts(html) }, LIST_CACHE_HEADERS)
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
      case "/api/me/history": {
        if (req.method === "GET") return handleMeHistory(url)
        if (req.method === "DELETE") return await handleHistoryDelete(req)
        throw new ExtractorError("method not allowed", 405)
      }
      case "/api/me/favorites": {
        if (req.method === "GET") return handleMeFavorites(url)
        if (req.method === "PUT") return await handleFavoriteWrite(req, true)
        if (req.method === "DELETE")
          return await handleFavoriteWrite(req, false)
        throw new ExtractorError("method not allowed", 405)
      }
      case "/api/me/tags": {
        if (req.method === "GET") return handleMeTags()
        if (req.method === "PUT") return await handleTagsWrite(req)
        if (req.method === "DELETE") return handleTagDelete(url)
        throw new ExtractorError("method not allowed", 405)
      }
      case "/api/me/cache": {
        if (req.method === "DELETE") return await handleCacheClear()
        throw new ExtractorError("method not allowed", 405)
      }
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
