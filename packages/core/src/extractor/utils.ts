export function stripTags(s: string): string {
  let result = ""
  let inTag = false
  for (const ch of s) {
    if (ch === "<") {
      inTag = true
    } else if (ch === ">") {
      inTag = false
    } else if (!inTag) {
      result += ch
    }
  }
  return result
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function decodeHtmlEntities(s: string): string {
  const namedEntities: Record<string, string> = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#x3000;": "\u3000",
    "&#12288;": "\u3000",
  }
  for (const [entity, ch] of Object.entries(namedEntities)) {
    s = s.split(entity).join(ch)
  }
  s = s.replace(/&#(\d+);/g, (_match, num) => {
    const code = parseInt(num, 10)
    if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code)
    }
    return _match
  })
  s = s.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
    const code = parseInt(hex, 16)
    if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code)
    }
    return _match
  })
  return s
}
