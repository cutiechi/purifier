import { Cool18Extractor } from "./extractor"
import { Extractor, ExtractorError } from "./types"
import { XbookcnExtractor } from "./xbookcn"

export type SiteId = string

interface SiteEntry {
  name: string
  getExtractor: () => Extractor
}

// 新增站点 = 在此加一行 + 实现 Extractor。
export const SITES: Record<SiteId, SiteEntry> = {
  "1": { name: "cool18", getExtractor: () => new Cool18Extractor() },
  "2": { name: "xbookcn", getExtractor: () => new XbookcnExtractor() },
}

export const DEFAULT_SITE: SiteId = "1"

export function resolveSite(id?: string): Extractor {
  const entry = SITES[id ?? DEFAULT_SITE]
  if (!entry) throw new ExtractorError(`unknown site: ${id ?? "(empty)"}`, 400)
  return entry.getExtractor()
}

export function isValidSite(id?: string): boolean {
  return !id || id in SITES
}
