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
] as const
