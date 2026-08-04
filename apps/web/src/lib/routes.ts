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
  meCache: "/api/me/cache",
  health: "/api/health",
} as const

export function readPath(tid: string): string {
  return `/read/${encodeURIComponent(tid)}`
}

export function bookPath(cid: string): string {
  return `/book/${encodeURIComponent(cid)}`
}

/** Category / column listing (filtered). */
export function browsePath(opts: {
  type?: string | null
  q?: string | null
  page?: number
}): string {
  const params = new URLSearchParams()
  if (opts.type) params.set("type", opts.type)
  if (opts.q) params.set("q", opts.q)
  if (opts.page && opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${routes.browse}?${qs}` : routes.browse
}

export function searchPath(opts: { q: string; page?: number }): string {
  const params = new URLSearchParams()
  params.set("q", opts.q)
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
    match: (p: string) => p === routes.home,
  },
  {
    href: routes.categories,
    label: "分类",
    match: (p: string) =>
      p === routes.categories || p === routes.browse || p.startsWith("/browse"),
  },
  {
    href: routes.featured,
    label: "精华",
    match: (p: string) => p === routes.featured,
  },
  {
    href: routes.picks,
    label: "扫文",
    match: (p: string) => p === routes.picks,
  },
  {
    href: routes.comments,
    label: "评论",
    match: (p: string) => p === routes.comments,
  },
  {
    href: routes.trending,
    label: "人气",
    match: (p: string) => p === routes.trending,
  },
  {
    href: routes.search,
    label: "搜索",
    match: (p: string) => p === routes.search,
  },
  {
    href: routes.history,
    label: "历史",
    match: (p: string) => p === routes.history,
  },
  {
    href: routes.favorites,
    label: "收藏",
    match: (p: string) => p === routes.favorites,
  },
  {
    href: routes.tags,
    label: "标签",
    match: (p: string) => p === routes.tags,
  },
] as const
