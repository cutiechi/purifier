export const BOOKMARK_QUOTE_MAX = 200
export const BOOKMARK_NOTE_MAX = 80
export const BOOKMARKS_PER_SCOPE_CAP = 50

function collapseWs(raw: string): string {
  return raw.trim().replace(/[\s\u00a0]+/g, " ")
}

export function normalizeBookmarkQuote(raw: string): string | null {
  const cleaned = collapseWs(raw)
  if (cleaned.length === 0) return null
  return Array.from(cleaned).slice(0, BOOKMARK_QUOTE_MAX).join("")
}

export function normalizeBookmarkNote(raw: string): string {
  const cleaned = collapseWs(raw)
  return Array.from(cleaned).slice(0, BOOKMARK_NOTE_MAX).join("")
}

export function findQuoteIndex(haystack: string, quote: string): number {
  if (!quote) return -1
  return haystack.indexOf(quote)
}
