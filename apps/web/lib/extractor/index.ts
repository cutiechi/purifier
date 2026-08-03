import { Cool18Extractor } from "./extractor"
import { Extractor, ExtractorError } from "./types"

export * from "./types"
export { Cool18Extractor } from "./extractor"

export function getExtractor(name: string): Extractor {
  switch (name) {
    case "cool18":
      return new Cool18Extractor()
    default:
      throw new ExtractorError(`unsupported site: ${name}`, 400)
  }
}
