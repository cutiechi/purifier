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

/** 无状态 extractor 单例，避免每次请求 new */
const extractorSingletons = new Map<SiteId, Extractor>()

export function resolveSite(id?: string): Extractor {
  const siteId = id ?? DEFAULT_SITE
  const entry = SITES[siteId]
  if (!entry) throw new ExtractorError(`unknown site: ${id ?? "(empty)"}`, 400)
  let ex = extractorSingletons.get(siteId)
  if (!ex) {
    ex = entry.getExtractor()
    extractorSingletons.set(siteId, ex)
  }
  return ex
}

export function isValidSite(id?: string): boolean {
  return !id || id in SITES
}
