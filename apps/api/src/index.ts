/**
 * Pure Bun HTTP — API + optional SPA static files.
 * No Hono / Express / Next.
 */
import { join } from "node:path"
import {
  CONTENT_CACHE_HEADERS,
  DEFAULT_SITE,
  ExtractorError,
  LIST_CACHE_HEADERS,
  NO_STORE_HEADERS,
  UpstreamTimeoutError,
  Store,
  ArchiveAutoGroupJob,
  ArchivePostsJob,
  JobRunner,
  assertSafeId,
  clearCache,
  deleteItemCaches,
  fetchUpstream,
  jsonError,
  jsonOk,
  openDatabase,
  readContentCache,
  readRepliesCache,
  resolveSite,
  writeContentCache,
  writeRepliesCache,
  type CacheEntry,
  type Extractor,
  type ItemKind,
  type ItemState,
  type ListQuery,
  type ReplyNode,
  type Job,
  type JobLog,
  type JobStatus,
} from "@workspace/core"

// Dev: 3001 (Vite on 3000 proxies /api). Prod Docker sets PORT=3000 + WEB_DIST.
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOSTNAME || "0.0.0.0"
/** Vite build output; when present, non-/api routes serve the SPA. */
const WEB_DIST = process.env.WEB_DIST || join(import.meta.dir, "../../web/dist")
const DATA_DIR = process.env.DATA_DIR || "./data"
const store = new Store(openDatabase(DATA_DIR))
const runner = new JobRunner(store)
runner.register(new ArchivePostsJob(store))
runner.register(new ArchiveAutoGroupJob(store))
runner.recoverOnStartup()

function toErrorResponse(err: unknown): Response {
  if (err instanceof UpstreamTimeoutError) {
    return jsonError("upstream timeout", 504)
  }
  if (err instanceof ExtractorError) {
    return jsonError(err.message, err.statusCode)
  }
  // 客户端取消等 AbortError：不当 504
  if (err instanceof Error && err.name === "AbortError") {
    return jsonError("request aborted", 499)
  }
  // 未知错误不回传内部 message（路径/SQL 等）
  console.error("[api] internal error:", err)
  return jsonError("internal error", 500)
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

/** 批量删除历史 body 单条：{site?, kind, id}；site 可选，缺省 API 层补 "1" */
function isDeleteItem(
  it: unknown
): it is { site?: string; kind: "post" | "book"; id: string } {
  if (!it || typeof it !== "object") return false
  const kind = "kind" in it ? it.kind : undefined
  const id = "id" in it ? it.id : undefined
  const site = "site" in it ? it.site : undefined
  return (
    (kind === "post" || kind === "book") &&
    typeof id === "string" &&
    /^[A-Za-z0-9]+$/.test(id) &&
    (site === undefined || typeof site === "string")
  )
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
    site: url.searchParams.get("site") ?? undefined,
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

/** 同 key 并发只打一次上游，避免 cache stampede */
const contentInflight = new Map<string, Promise<string>>()

function contentCacheKey(
  site: string,
  kind: ItemKind,
  id: string,
  chapter?: string
): string {
  return `${site}:${kind}:${id}${chapter ? `:${chapter}` : ""}`
}

async function fetchContentOnce(
  key: string,
  fetchFn: () => Promise<string>
): Promise<string> {
  const existing = contentInflight.get(key)
  if (existing) return existing
  const p = fetchFn().finally(() => {
    contentInflight.delete(key)
  })
  contentInflight.set(key, p)
  return p
}

/**
 * 正文/书库 HTML 加载（**不写盘**）：
 * - 无 refresh：先读缓存，命中直接返回；未命中抓上游
 * - 有 refresh：跳过缓存抓上游；失败回退旧缓存（stale），无旧缓存则抛错
 * - 调用方须在 **解析成功后** 再 `writeContentCache`，避免软 404/验证页把坏 HTML 永久化
 */
async function loadCachedContent(
  site: string,
  kind: ItemKind,
  id: string,
  refresh: boolean,
  fetchFn: () => Promise<string>,
  chapter?: string
): Promise<LoadedContent> {
  if (!refresh) {
    const cached = await readContentCache(DATA_DIR, site, kind, id, chapter)
    if (cached) return { html: cached.data, fromCache: true, refreshed: false }
  }
  const key = contentCacheKey(site, kind, id, chapter)
  try {
    const html = await fetchContentOnce(key, fetchFn)
    return { html, fromCache: false, refreshed: refresh }
  } catch (err) {
    if (!refresh) throw err
    const cached = await readContentCache(DATA_DIR, site, kind, id, chapter)
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

/** 列表接口进程内 TTL + LRU（CDN s-maxage 在自建场景不落地） */
const LIST_MEM_TTL_MS = 45_000
const LIST_MEM_MAX = 256
const LIST_MEM_KEY_MAX = 512
const listMemCache = new Map<string, { expires: number; data: unknown }>()

function getListMemCache<T>(key: string): T | null {
  const e = listMemCache.get(key)
  if (!e) return null
  if (Date.now() > e.expires) {
    listMemCache.delete(key)
    return null
  }
  // LRU：移到末尾
  listMemCache.delete(key)
  listMemCache.set(key, e)
  return e.data as T
}

function setListMemCache(key: string, data: unknown): void {
  if (key.length > LIST_MEM_KEY_MAX) return
  // 顺手清一批过期
  if (listMemCache.size >= LIST_MEM_MAX) {
    const now = Date.now()
    for (const [k, v] of listMemCache) {
      if (v.expires <= now) listMemCache.delete(k)
    }
  }
  while (listMemCache.size >= LIST_MEM_MAX) {
    const oldest = listMemCache.keys().next().value
    if (oldest === undefined) break
    listMemCache.delete(oldest)
  }
  if (listMemCache.has(key)) listMemCache.delete(key)
  listMemCache.set(key, { expires: Date.now() + LIST_MEM_TTL_MS, data })
}

/** 首页游标 mtid：仅非负整数 */
function parseMtid(raw: string | null): string {
  const mtid = (raw ?? "0").trim() || "0"
  if (!/^\d+$/.test(mtid)) {
    throw new ExtractorError("invalid mtid", 400)
  }
  return mtid
}

/**
 * 回复加载：成功才写缓存；失败回退旧回复缓存（无则 []），永不导致整个请求失败、不置 stale。
 * 注意：catch 同时覆盖「上游非 2xx（fetchRepliesRaw 抛 502）」与「body 非 JSON（parseReplies 抛 502）」
 * 两类上游失败，均按规格回退旧缓存 / 空数组，符合部分刷新矩阵第 2、4 行；不要改成只 catch 网络错误。
 */
async function loadCachedReplies(
  site: string,
  tid: string,
  refresh: boolean
): Promise<{ replies: ReplyNode[]; fromCache: boolean }> {
  const extractor = resolveSite(site)
  // 损坏/截断的回复缓存（JSON.parse 抛错）一律按 miss 处理，绝不让它拖垮正文页（刷新会覆盖写坏文件）
  if (!refresh) {
    let cached: CacheEntry<unknown> | null = null
    try {
      cached = await readRepliesCache(DATA_DIR, site, tid)
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
    await writeRepliesCache(DATA_DIR, site, tid, replies)
    return { replies, fromCache: false }
  } catch {
    let cached: CacheEntry<unknown> | null = null
    try {
      cached = await readRepliesCache(DATA_DIR, site, tid)
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
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const extractor = resolveSite(site)
  const tid = url.searchParams.get("tid")

  if (tid && siteId !== "1") {
    // xbookcn 无帖子模型（review S3：两站阶段用 siteId!=="1" 可接受；
    // 加第三站若有书站需改成按 extractor 能力判定，如 `extractor.name === "cool18"`）
    return jsonError("xbookcn does not support posts", 404)
  }

  if (!tid) {
    const mtid = parseMtid(url.searchParams.get("mtid"))
    const cacheKey = `home:${siteId}:${mtid}`
    const hit = getListMemCache<{ links: unknown; nextMtid: unknown }>(
      cacheKey
    )
    if (hit) return jsonOk(hit, LIST_CACHE_HEADERS)
    const { links, nextMtid } = await extractor.fetchHomeLinks(mtid)
    const body = { links, nextMtid }
    setListMemCache(cacheKey, body)
    return jsonOk(body, LIST_CACHE_HEADERS)
  }

  assertSafeId(tid) // 非法 id → 400

  const refresh = url.searchParams.get("refresh") === "1"
  const pageUrl = extractor.buildUrl(tid)

  const [content, repliesResult] = await Promise.all([
    loadCachedContent(siteId, "post", tid, refresh, async () => {
      const resp = await fetchUpstream(pageUrl)
      if (!resp.ok) {
        throw new ExtractorError(`upstream error: ${resp.status}`, 502)
      }
      return resp.text()
    }),
    loadCachedReplies(siteId, tid, refresh),
  ])

  // 先解析再写盘：避免软 404 / 验证页把坏 HTML 永久化
  const {
    title,
    content: bodyHtml,
    meta,
    links,
  } = extractor.extractContent(content.html)
  if (!content.fromCache) {
    await writeContentCache(DATA_DIR, siteId, "post", tid, content.html)
  }

  // cache hit / 刷新时以回复缓存重算评论数（extractContent 不回填 comments）
  if (repliesResult.replies.length > 0) {
    meta.comments = countReplies(repliesResult.replies)
  }

  // 成功解析后记录访问（含 cache hit 与 stale 兜底）
  store.recordVisit(siteId, "post", tid, title, pageUrl)

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
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const extractor = resolveSite(site)
  const chapter = url.searchParams.get("chapter") ?? undefined
  if (chapter !== undefined) assertSafeId(chapter)
  const refresh = url.searchParams.get("refresh") === "1"

  const pageUrl =
    chapter && extractor.buildChapterUrl
      ? extractor.buildChapterUrl(cid, chapter)
      : extractor.buildBookUrl(cid)

  const content = await loadCachedContent(
    siteId,
    "book",
    cid,
    refresh,
    async () => {
      const resp = await fetchUpstream(pageUrl, {
        headers: { Referer: extractor.homeUrl },
      })
      if (!resp.ok) {
        throw new ExtractorError(`upstream error: ${resp.status}`, 502)
      }
      return resp.text()
    },
    chapter
  )

  // 先解析再写盘
  const result = extractor.extractBookContent(
    content.html,
    chapter ? { chapter } : undefined
  )
  if (!content.fromCache) {
    await writeContentCache(
      DATA_DIR,
      siteId,
      "book",
      cid,
      content.html,
      chapter
    )
  }

  // 书名策略（review I2）：有 bookTitle 用书名；无 bookTitle 时不覆盖已有 title。
  // recordVisit 改造为：title 传 undefined 时 SQL 不动 title 列（见 Task 4 recordVisit）。
  const visitTitle = result.bookTitle ?? (chapter ? undefined : result.title)
  store.recordVisit(
    siteId,
    "book",
    cid,
    visitTitle,
    extractor.buildBookUrl(cid)
  )

  const payload: Record<string, unknown> = {
    title: result.title,
    content: result.content,
    meta: result.meta,
    url: pageUrl,
    cid,
  }
  // xbookcn 扩展字段（cool18 这些为 undefined，JSON 里自然省略）
  const extKeys = [
    "intro",
    "chapters",
    "singleShot",
    "related",
    "chapterIndex",
    "prevChapter",
    "nextChapter",
  ] as const
  for (const k of extKeys) {
    const v = result[k]
    if (v !== undefined) payload[k] = v
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
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1)
  if (type && type.length > 200) {
    return jsonError("type too long", 400)
  }
  if (q && q.length > 200) {
    return jsonError("q too long", 400)
  }
  const query = type ? { type } : q ? { keywords: q } : null
  if (!query) return jsonError("missing type or q parameter", 400)

  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const cacheKey = `browse:${siteId}:${type ?? ""}:${q ?? ""}:${page}`
  const hit = getListMemCache<unknown>(cacheKey)
  if (hit) return jsonOk(hit, LIST_CACHE_HEADERS)

  const extractor = resolveSite(site)
  const result = await extractor.fetchCategoryPage(query, page)
  setListMemCache(cacheKey, result)
  return jsonOk(result, LIST_CACHE_HEADERS)
}

async function handleHomeExtract(
  url: URL,
  pick: (extractor: Extractor, html: string) => unknown,
  cacheTag: string
): Promise<Response> {
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const cacheKey = `${cacheTag}:${siteId}`
  const hit = getListMemCache<unknown>(cacheKey)
  if (hit) return jsonOk(hit, LIST_CACHE_HEADERS)

  const extractor = resolveSite(site)
  const resp = await fetchUpstream(extractor.homeUrl)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  const body = pick(extractor, html)
  setListMemCache(cacheKey, body)
  return jsonOk(body, LIST_CACHE_HEADERS)
}

function handleMeHistory(url: URL): Response {
  return jsonOk(store.listHistory(meListQuery(url)), NO_STORE_HEADERS)
}

/**
 * 删除历史：
 * - ?all=1 → 清空全部（可带 ?site= 只清该站）
 * - ?kind=&id= → 删除单条（可带 ?site=）
 * - body { items: [{site?,kind,id}] } → 批量（清空本页；每条独立 site）
 */
async function handleHistoryDelete(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const site = url.searchParams.get("site") ?? undefined
  if (url.searchParams.get("all") === "1") {
    // 全清历史：顺带清全部内容缓存（无按站精确枚举文件，整清 cache/）
    const removed = store.clearHistory(site)
    if (!site) {
      await clearCache(DATA_DIR)
    }
    // 带 site 时不全清 cache 目录（避免误伤他站）；单站孤儿缓存可接受，下次 refresh 覆盖
    return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
  }

  const kindRaw = url.searchParams.get("kind")
  const idRaw = url.searchParams.get("id")
  if (kindRaw !== null || idRaw !== null) {
    const kind = meKindParam(url)
    const id = meIdParam(url)
    const siteId = site ?? "1"
    const existed = store.deleteItem(siteId, kind, id)
    if (existed) await deleteItemCaches(DATA_DIR, siteId, kind, id)
    return jsonOk({ ok: true, removed: existed ? 1 : 0 }, NO_STORE_HEADERS)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(
      "missing all=1, kind+id, or JSON body { items: [{site?,kind,id}] }",
      400
    )
  }
  const items =
    body && typeof body === "object" && "items" in body ? body.items : undefined
  const valid = Array.isArray(items) ? items.filter(isDeleteItem) : []
  if (!Array.isArray(items) || valid.length !== items.length) {
    return jsonError("items must be {site?,kind,id}[]", 400)
  }
  if (valid.length > 1000) {
    return jsonError("items too many (max 1000)", 400)
  }
  // review I1：每条带自己的 site（缺省 "1"），跨站"清空本页"不会删错站
  const pairs = valid.map((it) => ({
    site: it.site ?? "1",
    kind: it.kind,
    id: it.id,
  }))
  const removed = store.deleteItems(pairs)
  await Promise.all(
    pairs.map((p) => deleteItemCaches(DATA_DIR, p.site, p.kind, p.id))
  )
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}

function handleMeFavorites(url: URL): Response {
  return jsonOk(store.listFavorites(meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeTags(url: URL): Response {
  const site = url.searchParams.get("site") ?? undefined
  return jsonOk({ tags: store.listTags(site) }, NO_STORE_HEADERS)
}

function handleMeItems(url: URL): Response {
  const tag = url.searchParams.get("tag")?.trim()
  if (!tag) return jsonError("missing tag parameter", 400)
  return jsonOk(store.listByTag(tag, meListQuery(url)), NO_STORE_HEADERS)
}

function handleMeState(url: URL): Response {
  const kind = meKindParam(url)
  const id = meIdParam(url)
  const siteId = url.searchParams.get("site") ?? DEFAULT_SITE
  const state = store.getState(siteId, kind, id)
  // 对象不存在返回 200 空状态（visit_count 0）：前端 useItemState 对 !res.ok 静默，
  // 空状态与「未收藏/无标签」UI 等价；正文页打开会先 recordVisit 再查询，正常路径不会出现。
  const empty: ItemState = {
    site: siteId,
    kind,
    id,
    title: "",
    url: "",
    first_seen_at: 0,
    last_visited_at: 0,
    visit_count: 0,
    favorited: false,
    tags: [],
    read_progress: null,
    lastChapter: null,
  }
  return jsonOk(state ?? empty, NO_STORE_HEADERS)
}

function handleMeArchive(url: URL): Response {
  const site = url.searchParams.get("site") ?? DEFAULT_SITE
  const q = url.searchParams.get("q") ?? undefined
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50)
  )
  const sortRaw = url.searchParams.get("sort") ?? "tid"
  const sort =
    sortRaw === "title" || sortRaw === "tid" || sortRaw === "archived_at"
      ? sortRaw
      : "tid"
  const orderRaw = url.searchParams.get("order")
  const order =
    orderRaw === "asc" || orderRaw === "desc" ? orderRaw : undefined
  const result = store.listArchivePosts(site, { q, page, limit, sort, order })
  return jsonOk(result, NO_STORE_HEADERS)
}

function handleMeArchiveStatus(url: URL): Response {
  const site = url.searchParams.get("site") ?? DEFAULT_SITE
  return jsonOk(store.getArchiveStatus(site), NO_STORE_HEADERS)
}

function handleMeExport(): Response {
  const backup = store.exportBackup()
  const body = JSON.stringify(backup, null, 2)
  const day = new Date().toISOString().slice(0, 10)
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="purifier-backup-${day}.json"`,
      "cache-control": "no-store",
    },
  })
}

async function handleFavoriteWrite(
  req: Request,
  favorite: boolean
): Promise<Response> {
  const url = new URL(req.url)
  const kind = meKindParam(url)
  const id = meIdParam(url)
  // site 走 body（Task 10 前端 PUT body 带 site）；无 body（旧客户端）默认 "1"
  let site = "1"
  try {
    const body: unknown = await req.json()
    if (body && typeof body === "object" && "site" in body) {
      if (typeof body.site === "string") site = body.site
    }
  } catch {
    // 无 body → site 保持默认 "1"
  }
  if (favorite) {
    const ok = store.addFavorite(site, kind, id)
    if (!ok) return jsonError("item not found", 404)
  } else {
    store.removeFavorite(site, kind, id)
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
  if (!body || typeof body !== "object") {
    return jsonError("invalid json body", 400)
  }
  const kind = "kind" in body ? body.kind : undefined
  const id = "id" in body ? body.id : undefined
  const tags = "tags" in body ? body.tags : undefined
  const site = "site" in body ? body.site : undefined
  if (kind !== "post" && kind !== "book") {
    return jsonError("invalid kind", 400)
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9]+$/.test(id)) {
    return jsonError("invalid id", 400)
  }
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    return jsonError("tags must be string[]", 400)
  }
  const siteId = typeof site === "string" ? site : "1"
  const result = store.setTags(siteId, kind, id, tags)
  if (result === null) return jsonError("item not found", 404)
  return jsonOk({ ok: true, tags: result }, NO_STORE_HEADERS)
}

async function handleProgressWrite(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    return jsonError("invalid json body", 400)
  }
  const kind = "kind" in body ? body.kind : undefined
  const id = "id" in body ? body.id : undefined
  const progress = "progress" in body ? body.progress : undefined
  const site = "site" in body ? body.site : undefined
  const chapter = "chapter" in body ? body.chapter : undefined
  if (kind !== "post" && kind !== "book") {
    return jsonError("invalid kind", 400)
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9]+$/.test(id)) {
    return jsonError("invalid id", 400)
  }
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return jsonError("progress must be a finite number", 400)
  }
  let chapterNum: number | undefined
  if (chapter !== undefined) {
    if (typeof chapter !== "number" || !Number.isFinite(chapter)) {
      return jsonError("chapter must be a finite number", 400)
    }
    chapterNum = chapter
  }
  const siteId = typeof site === "string" ? site : "1"
  const ok = store.setProgress(siteId, kind, id, progress, chapterNum)
  if (!ok) return jsonError("item not found", 404)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

/** 全局删除某一标签（所有对象上的该标签行）；可带 ?site= 只删该站 */
function handleTagDelete(url: URL): Response {
  const tag = url.searchParams.get("tag")?.trim()
  if (!tag) return jsonError("missing tag parameter", 400)
  const site = url.searchParams.get("site") ?? undefined
  const removed = store.deleteTag(site, tag)
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}

async function handleCacheClear(): Promise<Response> {
  const cleared = await clearCache(DATA_DIR)
  return jsonOk({ cleared }, NO_STORE_HEADERS)
}

function handleGroupsList(url: URL): Response {
  const q = url.searchParams.get("q")?.trim() ?? ""
  return jsonOk({ groups: store.listGroups(q) }, NO_STORE_HEADERS)
}

/** jobs 列表 query 解析（limit 默认 20 上限 100，offset 默认 0） */
function jobsListQuery(url: URL) {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20)
  )
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10) || 0
  )
  return {
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit,
    offset,
  }
}

/** Job 行 payload/result JSON → 对象（失败降级 null） */
function parseJob(job: Job) {
  let payload: Record<string, unknown> | null = null
  let result: Record<string, unknown> | null = null
  try {
    payload = job.payload ? JSON.parse(job.payload) : null
  } catch {
    payload = null
  }
  try {
    result = job.result ? JSON.parse(job.result) : null
  } catch {
    result = null
  }
  return { ...job, payload, result }
}

function handleJobsList(url: URL): Response {
  const items = store.listJobs(jobsListQuery(url))
  return jsonOk({ items: items.map(parseJob) }, NO_STORE_HEADERS)
}

async function handleJobStart(req: Request): Promise<Response> {
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // 无 body 走默认
  }
  let type = ""
  let payload: Record<string, unknown> = {}
  if (body && typeof body === "object") {
    if ("type" in body) {
      type = String(body.type)
    }
    if ("payload" in body && body.payload && typeof body.payload === "object") {
      // typeof 已收窄为 object；仅补索引签名以满足 runner.start 参数类型
      payload = body.payload as Record<string, unknown>
    }
  }
  const job = await runner.start(type, payload)
  return jsonOk({ job: parseJob(job) }, NO_STORE_HEADERS)
}

function handleJobGet(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  return jsonOk({ job: parseJob(job) }, NO_STORE_HEADERS)
}

function handleJobDelete(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status === "running") {
    return jsonError("cannot delete running job; stop it first", 409)
  }
  store.deleteJob(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function handleJobsClear(): Response {
  const removed = store.clearFinishedJobs()
  return jsonOk({ ok: true, removed }, NO_STORE_HEADERS)
}

function handleJobLogs(url: URL, id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200)
  )
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10) || 0
  )
  const level = url.searchParams.get("level") ?? undefined
  const order = url.searchParams.get("order") === "desc" ? "desc" : "asc"
  const items = store.listJobLogs(id, { limit, offset, level, order })
  return jsonOk({ items }, NO_STORE_HEADERS)
}

function handleJobStop(id: number): Response {
  const job = store.getJob(id)
  if (!job) return jsonError("job not found", 404)
  if (job.status !== "running") {
    return jsonError(`cannot stop job in status: ${job.status}`, 409)
  }
  runner.stop(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

function isGroupMember(it: unknown): it is { tid: string; title: string } {
  if (!it || typeof it !== "object") return false
  const tid = "tid" in it ? it.tid : undefined
  const title = "title" in it ? it.title : undefined
  return (
    typeof tid === "string" &&
    /^[A-Za-z0-9]+$/.test(tid) &&
    tid.length <= 64 &&
    typeof title === "string" &&
    title.length > 0 &&
    title.length <= 512
  )
}

/** 移除成员 body 单条：只要 { tid }（与 upsert 不同，不含 title） */
function isGroupTidRef(it: unknown): it is { tid: string } {
  if (!it || typeof it !== "object") return false
  const tid = "tid" in it ? it.tid : undefined
  return (
    typeof tid === "string" &&
    /^[A-Za-z0-9]+$/.test(tid) &&
    tid.length <= 64
  )
}

async function handleGroupUpsert(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    throw new ExtractorError("invalid json body", 400)
  }
  const key = "key" in body ? body.key : undefined
  const title = "title" in body ? body.title : undefined
  const items = "items" in body ? body.items : undefined
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 128 ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > 512
  ) {
    throw new ExtractorError("invalid key or title", 400)
  }
  if (!Array.isArray(items) || items.length === 0 || !items.every(isGroupMember)) {
    throw new ExtractorError("items must be a non-empty {tid,title}[]", 400)
  }
  const author = "author" in body ? body.author : null
  const genre = "genre" in body ? body.genre : null
  if (
    (author !== null && (typeof author !== "string" || author.length > 512)) ||
    (genre !== null && (typeof genre !== "string" || genre.length > 512))
  ) {
    throw new ExtractorError("invalid author or genre", 400)
  }
  const group = store.upsertGroup({
    key,
    title,
    author: author as string | null,
    genre: genre as string | null,
    items: items.map((it) => ({ tid: it.tid, title: it.title })),
  })
  return jsonOk({ ok: true, group }, NO_STORE_HEADERS)
}

function handleGroupDelete(id: number): Response {
  store.deleteGroup(id)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

async function handleGroupItemsDelete(
  req: Request,
  id: number
): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ExtractorError("invalid json body", 400)
  }
  if (!body || typeof body !== "object") {
    throw new ExtractorError("invalid json body", 400)
  }
  const items = "items" in body ? body.items : undefined
  if (!Array.isArray(items) || items.length === 0 || !items.every(isGroupTidRef)) {
    throw new ExtractorError("items must be a non-empty {tid}[]", 400)
  }
  const { removed, deleted } = store.removeGroupItems(
    id,
    items.map((it) => it.tid)
  )
  return jsonOk({ ok: true, removed, deleted }, NO_STORE_HEADERS)
}

function handleGroupFavorite(id: number, favorited: boolean): Response {
  const ok = store.setGroupFavorite(id, favorited)
  if (!ok) throw new ExtractorError("group not found", 404)
  return jsonOk({ ok: true }, NO_STORE_HEADERS)
}

async function handleComments(url: URL): Promise<Response> {
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const cacheKey = `comments:${siteId}`
  const hit = getListMemCache<{ posts: unknown }>(cacheKey)
  if (hit) return jsonOk(hit, LIST_CACHE_HEADERS)

  const extractor = resolveSite(site)
  const resp = await fetchUpstream(`${extractor.homeUrl}?act=cmtrank&y=1`)
  if (!resp.ok) return jsonError(`upstream error: ${resp.status}`, 502)
  const html = await resp.text()
  const body = { posts: extractor.extractCmtRankPosts(html) }
  setListMemCache(cacheKey, body)
  return jsonOk(body, LIST_CACHE_HEADERS)
}

async function handleTrending(url: URL): Promise<Response> {
  const site = url.searchParams.get("site") ?? undefined
  const siteId = site ?? DEFAULT_SITE
  const cacheKey = `trending:${siteId}`
  const hit = getListMemCache<{ posts: unknown }>(cacheKey)
  if (hit) return jsonOk(hit, LIST_CACHE_HEADERS)

  const extractor = resolveSite(site)
  try {
    const html = await extractor.fetchHotHtml()
    const body = { posts: extractor.extractHotPosts(html) }
    setListMemCache(cacheKey, body)
    return jsonOk(body, LIST_CACHE_HEADERS)
  } catch (err) {
    if (err instanceof ExtractorError) throw err
    const status = err instanceof UpstreamTimeoutError ? 504 : 502
    return jsonError(`upstream error`, status)
  }
}

async function route(req: Request): Promise<Response> {
  const t0 = Date.now()
  try {
    const res = await routeInner(req)
    const url = new URL(req.url)
    if (url.pathname.startsWith("/api")) {
      console.log(
        `${req.method} ${url.pathname}${url.search} ${res.status} ${Date.now() - t0}ms`
      )
    }
    return res
  } catch (err) {
    // 含 SPA 路径未捕获异常
    const res = toErrorResponse(err)
    const url = new URL(req.url)
    if (url.pathname.startsWith("/api")) {
      console.log(
        `${req.method} ${url.pathname}${url.search} ${res.status} ${Date.now() - t0}ms`
      )
    }
    return res
  }
}

async function routeInner(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  // Static / SPA first for non-API
  if (req.method === "GET" && !pathname.startsWith("/api")) {
    const spa = await serveSpa(pathname)
    if (spa) return spa
  }

  try {
    // /api/me/jobs 子资源（id 数字；放在 switch 前独立前缀分支，不干扰 SPA fallback）
    const jobsSub = pathname.match(
      /^\/api\/me\/jobs\/(\d+)(?:\/(logs|stop))?$/
    )
    if (jobsSub) {
      const id = Number(jobsSub[1])
      const sub = jobsSub[2]
      if (sub === undefined) {
        if (req.method === "GET") return handleJobGet(id)
        if (req.method === "DELETE") return handleJobDelete(id)
        throw new ExtractorError("method not allowed", 405)
      }
      if (sub === "logs") {
        if (req.method !== "GET") {
          throw new ExtractorError("method not allowed", 405)
        }
        return handleJobLogs(url, id)
      }
      if (sub === "stop") {
        if (req.method !== "POST") {
          throw new ExtractorError("method not allowed", 405)
        }
        return handleJobStop(id)
      }
    }
    if (pathname === "/api/me/jobs") {
      if (req.method === "GET") return handleJobsList(url)
      if (req.method === "POST") return await handleJobStart(req)
      if (req.method === "DELETE") return handleJobsClear()
      throw new ExtractorError("method not allowed", 405)
    }
    // /api/me/groups 子资源（id 数字；放在 switch 前独立前缀分支，不干扰 SPA fallback）
    const groupsSub = pathname.match(
      /^\/api\/me\/groups\/(\d+)(?:\/(items|favorite))?$/
    )
    if (groupsSub) {
      const id = Number(groupsSub[1])
      const sub = groupsSub[2]
      if (sub === undefined) {
        if (req.method !== "DELETE") {
          throw new ExtractorError("method not allowed", 405)
        }
        return handleGroupDelete(id)
      }
      if (sub === "items") {
        if (req.method !== "DELETE") {
          throw new ExtractorError("method not allowed", 405)
        }
        return await handleGroupItemsDelete(req, id)
      }
      if (req.method === "PUT") return handleGroupFavorite(id, true)
      if (req.method === "DELETE") return handleGroupFavorite(id, false)
      throw new ExtractorError("method not allowed", 405)
    }
    if (pathname === "/api/me/groups") {
      if (req.method === "GET") return handleGroupsList(url)
      if (req.method === "PUT") return await handleGroupUpsert(req)
      throw new ExtractorError("method not allowed", 405)
    }
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
        return await handleHomeExtract(
          url,
          (ex, html) => ({ links: ex.extractCategoryLinks(html) }),
          "categories"
        )
      case "/api/featured":
        requireGet(req)
        return await handleHomeExtract(
          url,
          (ex, html) => ({ links: ex.extractGoldLinks(html) }),
          "featured"
        )
      case "/api/picks":
        requireGet(req)
        return await handleHomeExtract(
          url,
          (ex, html) => ({ sections: ex.extractRecommendSections(html) }),
          "picks"
        )
      case "/api/comments":
        requireGet(req)
        return await handleComments(url)
      case "/api/trending":
        requireGet(req)
        return await handleTrending(url)
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
        if (req.method === "GET") return handleMeTags(url)
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
      case "/api/me/archive":
        requireGet(req)
        return handleMeArchive(url)
      case "/api/me/archive/status":
        requireGet(req)
        return handleMeArchiveStatus(url)
      case "/api/me/export":
        requireGet(req)
        return handleMeExport()
      case "/api/me/progress":
        if (req.method === "PUT") return await handleProgressWrite(req)
        throw new ExtractorError("method not allowed", 405)
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
    const headers: Record<string, string> = {}
    if (rel === "index.html" || rel.endsWith(".html")) {
      headers["Cache-Control"] = "no-store"
    } else if (
      /assets\//.test(rel) ||
      /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i.test(rel)
    ) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable"
    }
    return new Response(file, { headers })
  }
  // client-side router fallback
  const index = Bun.file(join(WEB_DIST, "index.html"))
  if (await index.exists()) {
    return new Response(index, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
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
