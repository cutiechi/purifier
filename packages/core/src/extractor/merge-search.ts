import { normalizeTitleKey, parseListTitle } from "../title-parse"
import type { SiteId } from "./sites"
import type { CategoryPage, ChapterLink } from "./types"

/** 站点 → 内容类型；未来加站需补表项（SITES 键序也是排序平局顺序） */
export const SITE_KIND: Record<SiteId, "post" | "book"> = {
  "1": "post",
  "2": "book",
}

export interface MergedSearchItem {
  site: SiteId
  kind: "post" | "book"
  link: ChapterLink
}

export interface MergedSearchPage {
  items: MergedSearchItem[]
  nextPage: number | null
  errors?: Record<string, string>
}

/** 排序键 = 前端分组键同一条管线：normalizeTitleKey(parseListTitle(title).title) */
export function searchSortKey(title: string): string {
  return normalizeTitleKey(parseListTitle(title).title)
}

const collator = new Intl.Collator("zh", { numeric: true })

export function mergeSearchPages(
  results: Array<{ site: SiteId; page: CategoryPage | null; error?: string }>
): MergedSearchPage {
  const items: MergedSearchItem[] = []
  const errors: Record<string, string> = {}
  let nextPage: number | null = null

  for (const r of results) {
    if (r.page) {
      for (const link of r.page.links) {
        items.push({ site: r.site, kind: SITE_KIND[r.site] ?? "post", link })
      }
      if (r.page.nextPage !== null) nextPage = r.page.nextPage
    } else if (r.error) {
      errors[r.site] = r.error
    }
  }

  // 稳定排序：平局保持输入顺序（= SITES 键序，site1 先于 site2）
  items.sort((a, b) =>
    collator.compare(searchSortKey(a.link.title), searchSortKey(b.link.title))
  )

  const out: MergedSearchPage = { items, nextPage }
  if (Object.keys(errors).length > 0) out.errors = errors
  return out
}
