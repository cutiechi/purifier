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
 */

export type SiteId = string
export const DEFAULT_SITE: SiteId = "1"
export const SITES: Record<SiteId, { label: string }> = {
  "1": { label: "论坛" },
  "2": { label: "书库" },
}

export const routes = {
  home: "/",
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
} as const

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
  meItems: "/api/me/items",
  meState: "/api/me/state",
  meProgress: "/api/me/progress",
  meCache: "/api/me/cache",
  meGroups: "/api/me/groups",
  health: "/api/health",
} as const

function withSite(params: URLSearchParams, site?: string) {
  if (site && site !== DEFAULT_SITE) params.set("site", site)
}

export function readPath(tid: string, site?: SiteId): string {
  const p = new URLSearchParams()
  withSite(p, site)
  const qs = p.toString()
  return `/read/${encodeURIComponent(tid)}${qs ? `?${qs}` : ""}`
}

export function bookPath(
  cid: string,
  opts?: { site?: SiteId; chapter?: string }
): string {
  const p = new URLSearchParams()
  withSite(p, opts?.site)
  if (opts?.chapter) p.set("chapter", opts.chapter)
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

export const NAV_ITEMS = [
  {
    href: routes.home,
    label: "首页",
    sites: ["1", "2"],
    match: (p: string) => p === routes.home,
  },
  {
    href: routes.categories,
    label: "分类",
    sites: ["1", "2"],
    match: (p: string) =>
      p === routes.categories || p === routes.browse || p.startsWith("/browse"),
  },
  {
    href: routes.featured,
    label: "精华",
    sites: ["1"],
    match: (p: string) => p === routes.featured,
  },
  {
    href: routes.picks,
    label: "扫文",
    sites: ["1"],
    match: (p: string) => p === routes.picks,
  },
  {
    href: routes.comments,
    label: "评论",
    sites: ["1"],
    match: (p: string) => p === routes.comments,
  },
  {
    href: routes.trending,
    label: "人气",
    sites: ["1", "2"],
    match: (p: string) => p === routes.trending,
  },
  {
    href: routes.search,
    label: "搜索",
    sites: ["1", "2"],
    match: (p: string) => p === routes.search,
  },
  {
    href: routes.history,
    label: "历史",
    sites: ["1", "2"],
    match: (p: string) => p === routes.history,
  },
  {
    href: routes.favorites,
    label: "收藏",
    sites: ["1", "2"],
    match: (p: string) => p === routes.favorites,
  },
  {
    href: routes.tags,
    label: "标签",
    sites: ["1", "2"],
    match: (p: string) => p === routes.tags,
  },
] as const
