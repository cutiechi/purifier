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

/**
 * 把 raw 文本折叠成 normalizeBookmarkQuote 同款形态（trim + 连续空白折叠为单空格），
 * 同时记录每个折叠字符对应的 raw [start, end) UTF-16 偏移。
 */
export function collapseText(raw: string): {
  text: string
  starts: number[]
  ends: number[]
} {
  const text: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  const re = /[\s\u00a0]+|[^\s\u00a0]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    text.push(/[\s\u00a0]/.test(m[0].charAt(0)) ? " " : m[0])
    starts.push(m.index)
    ends.push(m.index + m[0].length)
  }
  while (text.length > 0 && text[0] === " ") {
    text.shift()
    starts.shift()
    ends.shift()
  }
  while (text.length > 0 && text[text.length - 1] === " ") {
    text.pop()
    starts.pop()
    ends.pop()
  }
  return { text: text.join(""), starts, ends }
}
