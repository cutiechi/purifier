/**
 * Canonical app routes & query helpers.
 *
 * | Page        | Path                         |
 * |-------------|------------------------------|
 * | Timeline    | `/`                          |
 * | Article     | `/read/:tid`                 |
 * | Book        | `/book/:cid` （书库）          |
 * | Featured    | `/featured`                  |
 * | Picks       | `/picks` （扫文推荐）         |
 * | Trending    | `/trending`                  |
 * | Comments    | `/comments`                  |
 * | Categories  | `/categories`                |
 * | Browse      | `/browse?type|q=&page=`      |
 * | Search      | `/search?q=&page=`           |
 * | History     | `/history`                   |
 * | Favorites   | `/favorites`                 |
 * | Tags        | `/tags?tag=&q=&kind=&page=`  |
 * | Bookmarks   | `/bookmarks`                 |
 * | Group       | `/groups`                    |
 * | Archive     | `/archive`                   |
 * | Jobs        | `/jobs`                      |
 */

export type SiteId = string
export const DEFAULT_SITE: SiteId = "1"
export const SITES: Record<SiteId, { label: string }> = {
  "1": { label: "论坛" },
  "2": { label: "书库" },
}

export const routes = {
  home: "/",
  /** OIDC 登录页（不进 NAV_ITEMS） */
  login: "/login",
  discover: "/discover",
  me: "/me",
  featured: "/featured",
  picks: "/picks",
  trending: "/trending",
  comments: "/comments",
  categories: "/categories",
  browse: "/browse",
  search: "/search",
  history: "/history",
  favorites: "/favorites",
  tags: "/tags",
  bookmarks: "/bookmarks",
  groups: "/groups",
  /** 全站目录（原归档） */
  archive: "/archive",
  jobs: "/jobs",
  stats: "/stats",
} as const

/** 发现页栏目（按站过滤） */
export const DISCOVER_TABS: {
  href: string
  label: string
  sites: readonly SiteId[]
}[] = [
  { href: routes.featured, label: "精华", sites: ["1"] },
  { href: routes.picks, label: "扫文", sites: ["1"] },
  { href: routes.comments, label: "评论", sites: ["1"] },
  { href: routes.trending, label: "人气", sites: ["1", "2"] },
]

/** 我的页栏目（个人阅读数据） */
export const ME_TABS: {
  href: string
  label: string
  sites: readonly SiteId[]
}[] = [
  { href: routes.history, label: "历史", sites: ["1", "2"] },
  { href: routes.favorites, label: "收藏", sites: ["1", "2"] },
  { href: routes.tags, label: "标签", sites: ["1", "2"] },
  { href: routes.bookmarks, label: "书签", sites: ["1", "2"] },
]

/** 目录页栏目（归档整理视图；书库站无分组） */
export const ALL_TABS: {
  href: string
  label: string
  sites: readonly SiteId[]
}[] = [
  { href: routes.archive, label: "目录", sites: ["1", "2"] },
  { href: routes.groups, label: "分组", sites: ["1"] },
]

export const api = {
  posts: "/api/posts",
  books: "/api/books",
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

function withSite(params: URLSearchParams, site?: string) {
  if (site && site !== DEFAULT_SITE) params.set("site", site)
}

/** 站点参数拼接到路径（默认站不加参数） */
export function siteUrl(path: string, site?: SiteId): string {
  if (!site || site === DEFAULT_SITE) return path
  return `${path}?site=${site}`
}

export function readPath(tid: string, site?: SiteId, bm?: string): string {
  const p = new URLSearchParams()
  withSite(p, site)
  if (bm) p.set("bm", bm)
  const qs = p.toString()
  return `/read/${encodeURIComponent(tid)}${qs ? `?${qs}` : ""}`
}

export function bookPath(
  cid: string,
  opts?: { site?: SiteId; chapter?: string; bm?: string }
): string {
  const p = new URLSearchParams()
  withSite(p, opts?.site)
  if (opts?.chapter) p.set("chapter", opts.chapter)
  if (opts?.bm) p.set("bm", opts.bm)
  const qs = p.toString()
  return `/book/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`
}

/** Category / column listing (filtered). */
export function browsePath(opts: {
  type?: string | null
  q?: string | null
  page?: number
  site?: SiteId
}): string {
  const params = new URLSearchParams()
  withSite(params, opts.site)
  if (opts.type) params.set("type", opts.type)
  if (opts.q) params.set("q", opts.q)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${routes.browse}?${qs}` : routes.browse
}

export function searchPath(opts: {
  q: string
  page?: number
  site?: SiteId
}): string {
  const params = new URLSearchParams()
  params.set("q", opts.q)
  withSite(params, opts.site)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  return `${routes.search}?${params.toString()}`
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

/** 一级导航：站点切换改页内 Tab，顶栏只保留这些 */
export const NAV_ITEMS = [
  {
    href: routes.home,
    label: "首页",
    match: (p: string) => p === routes.home,
  },
  {
    href: routes.archive,
    label: "目录",
    match: (p: string) =>
      p === routes.archive || p === routes.groups,
  },
  {
    href: routes.categories,
    label: "分类",
    match: (p: string) =>
      p === routes.categories || p === routes.browse || p.startsWith("/browse"),
  },
  {
    href: routes.discover,
    label: "发现",
    match: (p: string) =>
      p === routes.discover ||
      p === routes.featured ||
      p === routes.picks ||
      p === routes.comments ||
      p === routes.trending,
  },
  {
    href: routes.search,
    label: "搜索",
    match: (p: string) => p === routes.search,
  },
  {
    href: routes.me,
    label: "我的",
    match: (p: string) =>
      p === routes.me ||
      p === routes.history ||
      p === routes.favorites ||
      p === routes.tags ||
      p === routes.bookmarks,
  },
  {
    href: routes.stats,
    label: "统计",
    match: (p: string) => p === routes.stats,
  },
  {
    href: routes.jobs,
    label: "任务",
    match: (p: string) => p === routes.jobs,
  },
] as const
