/**
 * Canonical app routes & query helpers.
 *
 * 信息架构（2026-11）：一级 = 内容类型（首页/分类/榜单/目录/搜索/我的），
 * 二级 = 内容源，由路径前缀表达：
 *
 * | 源   | 前缀        |
 * |------|-------------|
 * | 论坛 | `/cool-18`  |
 * | 书库 | `/xbook-cn` |
 *
 * | 页面        | 路由                                          |
 * |-------------|-----------------------------------------------|
 * | Home        | `/cool-18`                                    |
 * | LibraryHome | `/xbook-cn`                                   |
 * | Featured    | `/cool-18/featured`                           |
 * | Picks       | `/cool-18/picks`（扫文推荐）                  |
 * | Trending    | `/cool-18/trending` · `/xbook-cn/trending`    |
 * | Comments    | `/cool-18/comments`                           |
 * | Categories  | `/cool-18/categories` · `/xbook-cn/categories`|
 * | Browse      | `/cool-18/browse?type|q=&page=` · `/xbook-cn/browse?…` |
 * | Search      | `/cool-18/search?q=&page=` · `/xbook-cn/search?…` |
 * | Read        | `/cool-18/:tid`                               |
 * | Book        | `/xbook-cn/:cid`（`?chapter=` 章节）          |
 * | Me（跨站）  | `/me` `/history` `/favorites` `/tags` `/bookmarks` `/stats` `/jobs`，可选 `?site=` 过滤 |
 */

export type SiteId = string
export const DEFAULT_SITE: SiteId = "1"
export const SITES: Record<SiteId, { label: string }> = {
  "1": { label: "论坛" },
  "2": { label: "书库" },
}

/** 与源无关的固定路由 */
export const routes = {
  /** OIDC 登录页（不进导航） */
  login: "/login",
  me: "/me",
  history: "/history",
  favorites: "/favorites",
  tags: "/tags",
  bookmarks: "/bookmarks",
  stats: "/stats",
  jobs: "/jobs",
} as const

/** 论坛源（cool18）一级页路由 */
export const forumRoutes = {
  home: "/cool-18",
  categories: "/cool-18/categories",
  browse: "/cool-18/browse",
  featured: "/cool-18/featured",
  picks: "/cool-18/picks",
  comments: "/cool-18/comments",
  trending: "/cool-18/trending",
  archive: "/cool-18/archive",
  groups: "/cool-18/groups",
  search: "/cool-18/search",
} as const

/** 书库源（xbookcn）一级页路由 */
export const libraryRoutes = {
  home: "/xbook-cn",
  categories: "/xbook-cn/categories",
  browse: "/xbook-cn/browse",
  trending: "/xbook-cn/trending",
  archive: "/xbook-cn/archive",
  search: "/xbook-cn/search",
} as const

/** 按源取对应一级路由组 */
export function sourceRoutes(site: SiteId) {
  return site === "2" ? libraryRoutes : forumRoutes
}

export const api = {
  posts: "/api/posts",
  books: "/api/books",
  booksHome: "/api/books/home",
  featured: "/api/featured",
  picks: "/api/picks",
  trending: "/api/trending",
  comments: "/api/comments",
  categories: "/api/categories",
  browse: "/api/browse",
  meHistory: "/api/me/history",
  meFavorites: "/api/me/favorites",
  meTags: "/api/me/tags",
  meBookmarks: "/api/me/bookmarks",
  meItems: "/api/me/items",
  meState: "/api/me/state",
  meProgress: "/api/me/progress",
  meCache: "/api/me/cache",
  meCharacters: "/api/me/characters",
  meGroups: "/api/me/groups",
  meJobs: "/api/me/jobs",
  meArchive: "/api/me/archive",
  meArchiveStatus: "/api/me/archive/status",
  meExport: "/api/me/export",
  meSessions: "/api/me/sessions",
  meStats: "/api/me/stats",
  authConfig: "/api/auth/config",
  authMe: "/api/auth/me",
  authAuthorize: "/api/auth/authorize",
  authCallback: "/api/auth/callback",
  authLogout: "/api/auth/logout",
  health: "/api/health",
} as const

export function readPath(tid: string, bm?: string): string {
  const p = new URLSearchParams()
  if (bm) p.set("bm", bm)
  const qs = p.toString()
  return `${forumRoutes.home}/${encodeURIComponent(tid)}${qs ? `?${qs}` : ""}`
}

export function bookPath(
  cid: string,
  opts?: { chapter?: string; bm?: string }
): string {
  const p = new URLSearchParams()
  if (opts?.chapter) p.set("chapter", opts.chapter)
  if (opts?.bm) p.set("bm", opts.bm)
  const qs = p.toString()
  return `${libraryRoutes.home}/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`
}

/** 源内分类/关键词列表路径（站点由路径前缀表达，不再带 ?site=） */
export function browsePath(opts: {
  site?: SiteId
  type?: string | null
  q?: string | null
  page?: number
}): string {
  const params = new URLSearchParams()
  if (opts.type) params.set("type", opts.type)
  if (opts.q) params.set("q", opts.q)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  const base = sourceRoutes(opts.site ?? DEFAULT_SITE).browse
  return qs ? `${base}?${qs}` : base
}

export function searchPath(opts: {
  site?: SiteId
  q: string
  page?: number
}): string {
  const params = new URLSearchParams()
  params.set("q", opts.q)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return `${sourceRoutes(opts.site ?? DEFAULT_SITE).search}?${params.toString()}`
}

/** /api/me/* 列表查询串（q/kind/page），page>1 才带 */
export function meListQuery(opts: {
  q?: string
  kind?: string
  page?: number
}): string {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.kind) params.set("kind", opts.kind)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return params.toString()
}

/** 标签页筛选路径：/tags?tag=xxx[&q=&kind=&page=] */
export function tagsPath(opts: {
  tag: string
  q?: string
  kind?: string
  page?: number
}): string {
  const params = new URLSearchParams()
  params.set("tag", opts.tag)
  if (opts.q) params.set("q", opts.q)
  if (opts.kind) params.set("kind", opts.kind)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return `${routes.tags}?${params.toString()}`
}

export function parsePage(
  searchParams: URLSearchParams | { get(name: string): string | null }
): number {
  const raw = searchParams.get("page") ?? "1"
  return Math.max(1, parseInt(raw, 10) || 1)
}

export function parseQuery(
  searchParams: URLSearchParams | { get(name: string): string | null }
): string {
  return (searchParams.get("q") ?? "").trim()
}

export interface NavItem {
  href: string
  label: string
  match: (pathname: string) => boolean
}

/**
 * 一级导航（首页/分类/榜单/目录/搜索/我的）。href 取当前源的同名页：
 * 在书库任意页点「分类」去 /xbook-cn/categories，论坛侧同理。
 */
export function navItems(site: SiteId): NavItem[] {
  const s = sourceRoutes(site)
  const endsWithAny = (...suffixes: string[]) => (p: string) =>
    suffixes.some((suf) => p === suf || p.startsWith(`${suf}/`)) ||
    suffixes.some((suf) => p.endsWith(suf))
  return [
    {
      href: s.home,
      label: "首页",
      match: (p) =>
        p === "/" || p === forumRoutes.home || p === libraryRoutes.home,
    },
    {
      href: s.categories,
      label: "分类",
      match: endsWithAny(forumRoutes.categories, forumRoutes.browse),
    },
    {
      href: site === "2" ? s.trending : forumRoutes.featured,
      label: "榜单",
      match: endsWithAny(
        forumRoutes.featured,
        forumRoutes.picks,
        forumRoutes.comments,
        forumRoutes.trending
      ),
    },
    {
      href: s.archive,
      label: "目录",
      match: endsWithAny(forumRoutes.archive, forumRoutes.groups),
    },
    { href: s.search, label: "搜索", match: endsWithAny(s.search) },
    {
      href: routes.me,
      label: "我的",
      match: endsWithAny(
        routes.me,
        routes.history,
        routes.favorites,
        routes.tags,
        routes.bookmarks,
        routes.stats,
        routes.jobs
      ),
    },
  ]
}

/** 页内二级「论坛 / 书库」切换目标：每个一级页给出两源对应落地路径，缺失的源不显示 */
export type SiteTabTargets = Partial<Record<SiteId, string>>

/** 发现页栏目：label + 各源落地路径（缺源的栏目在该源不显示） */
export const DISCOVER_TABS: { label: string; paths: SiteTabTargets }[] = [
  { label: "精华", paths: { "1": forumRoutes.featured } },
  { label: "扫文", paths: { "1": forumRoutes.picks } },
  { label: "评论", paths: { "1": forumRoutes.comments } },
  {
    label: "人气",
    paths: { "1": forumRoutes.trending, "2": libraryRoutes.trending },
  },
]

/** 我的页栏目（个人阅读数据，跨站） */
export const ME_TABS: { label: string; path: string }[] = [
  { label: "概览", path: routes.me },
  { label: "历史", path: routes.history },
  { label: "收藏", path: routes.favorites },
  { label: "标签", path: routes.tags },
  { label: "书签", path: routes.bookmarks },
  { label: "统计", path: routes.stats },
  { label: "任务", path: routes.jobs },
]

/** 目录页栏目（归档整理视图；分组仅论坛有） */
export const ALL_TABS: { label: string; paths: SiteTabTargets }[] = [
  {
    label: "目录",
    paths: { "1": forumRoutes.archive, "2": libraryRoutes.archive },
  },
  { label: "分组", paths: { "1": forumRoutes.groups } },
]
