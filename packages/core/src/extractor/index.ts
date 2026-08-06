import { Cool18Extractor } from "./extractor"
import { Extractor, ExtractorError } from "./types"

export * from "./types"
export { Cool18Extractor } from "./extractor"
export {
  SITES,
  DEFAULT_SITE,
  resolveSite,
  isValidSite,
  type SiteId,
} from "./sites"

/**
 * 旧入口（按 name）。Task 3-6 期间 API 仍用它，保持 name 语义不动。
 * Task 7 把 API 全部切到 resolveSite(site) 后，此函数可删。
 */
export function getExtractor(name: string): Extractor {
  switch (name) {
    case "cool18":
      return new Cool18Extractor()
    default:
      throw new ExtractorError(`unsupported site: ${name}`, 400)
  }
}
