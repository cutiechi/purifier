export interface ParsedTitle {
  title: string
  chapters: string | null
  author: string | null
  original: boolean
  ai: boolean
  genre: string | null
  note: string | null
}

function fullwidthToHalf(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  )
}

export function parseListTitle(raw: string): ParsedTitle {
  let s = raw.replace(/\s+/g, " ").trim()

  s = s
    .replace(/^[_\s]+/, "")
    .replace(/^[★☆◇◆]+/, "")
    .replace(/^\[[^\]\n]+\][_\s]*/, "")
    .replace(/^(?:迎新|辞旧|贺岁|新春|元宵)[_\s]*/, "")
    .trim()

  const original = /\[\s*原创\s*\]/.test(s)
  const ai = /\[\s*AI辅助\s*\]/i.test(s)
  let originalAuthor: string | null = null
  const oaMatch = s.match(/\[\s*([^\]\s]+?)_\s*原创\s*\]/i)
  if (oaMatch) originalAuthor = oaMatch[1]!.trim()
  s = s
    .replace(/\[\s*[^\]\s]+?_\s*原创\s*\]/gi, "")
    .replace(/\[[^\]]*原创[^\]]*\]/gi, "")
    .replace(/\[\s*AI辅助\s*\]/gi, "")
    .trim()

  let genre: string | null = null
  const genreMatch = s.match(/『([^』]+)』\s*$/)
  if (genreMatch) {
    genre = genreMatch[1]!.trim()
    s = s.slice(0, genreMatch.index).trim()
  }

  let title = s
  let rest = ""

  const wrappers: RegExp[] = [
    /^【([^】]+)】(.*)$/,
    /^《([^》]+)》(.*)$/,
    /^「([^」]+)」(.*)$/,
    /^〖([^〗]+)〗(.*)$/,
    /^［([^］]+)］(.*)$/,
    /^\[([^\]]+)\](.*)$/,
  ]
  let matched = false
  for (const re of wrappers) {
    const m = s.match(re)
    if (m) {
      title = m[1]!.trim()
      rest = (m[2] ?? "").trim()
      matched = true
      break
    }
  }
  if (!matched) {
    const splitAuthor = s.match(
      /^(.*?)(?:\s*(?:作者|原作|译者|作\s*_?\s*者)\s*[:：_]\s*.+)$/
    )
    if (splitAuthor?.[1] && splitAuthor[1].length >= 2) {
      title = splitAuthor[1].trim()
      rest = s.slice(title.length).trim()
    } else {
      title = s
      rest = ""
    }
  }

  let chapters: string | null = null
  let author: string | null = null
  let note: string | null = null

  if (!rest) {
    const titleCh = title.match(/^(.*?)[（(]([^）)]{1,24})[）)]\s*$/)
    if (titleCh?.[1] && titleCh[1].trim().length >= 2) {
      title = titleCh[1]!.trim()
      chapters = fullwidthToHalf(titleCh[2]!).trim()
    }
  }

  rest = rest.replace(/^[_\s]+/, "").trim()
  const chParen = rest.match(/^[（(]([^）)]+)[）)]\s*(.*)$/)
  if (chParen) {
    chapters = fullwidthToHalf(chParen[1]!).trim()
    rest = (chParen[2] ?? "").replace(/^[_\s]+/, "").trim()
  } else if (rest) {
    const fullDigit = "[０-９0-9]"
    const chBare = rest.match(
      new RegExp(
        `^(${fullDigit}+(?:\\.${fullDigit}+)?\\s*[-－–~～]\\s*${fullDigit}+(?:\\.${fullDigit}+)?(?:\\s*完)?(?:[（(]完[）)])?(?:部\\s*${fullDigit}+(?:\\s*章)?)?)\\s*(.*)$`
      )
    )
    if (chBare) {
      chapters = fullwidthToHalf(chBare[1]!).replace(/\s+/g, "")
      rest = (chBare[2] ?? "").replace(/^[_\s]+/, "").trim()
    } else {
      const chSingle = rest.match(
        new RegExp(
          `^(${fullDigit}+(?:\\.${fullDigit}+)?(?:[（(]完[）)]|完)?)\\s*(.*)$`
        )
      )
      if (
        chSingle &&
        (!chSingle[2] ||
          /^(?:原作|作者|译者|翻译|作\s*_?\s*者)/i.test(chSingle[2]!))
      ) {
        chapters = fullwidthToHalf(chSingle[1]!).replace(/\s+/g, "")
        rest = (chSingle[2] ?? "").trim()
      } else if (/^第/.test(rest)) {
        chapters = rest
        rest = ""
      } else {
        const doneMark = rest.match(/^完(?:\s*(.*))$/)
        if (doneMark) {
          chapters = "完"
          rest = (doneMark[1] ?? "").trim()
        }
      }
    }
  }

  if (
    rest &&
    !/^(?:原作|作者|译者|翻译|作\s*_?\s*者|作)\s*[:：_]/i.test(rest)
  ) {
    const mid = rest.match(
      /^(.*?)\s*((?:原作|作者|译者|翻译|作\s*_?\s*者)\s*[:：_].*)$/i
    )
    if (mid?.[1] && mid[1].trim().length > 0 && mid[1].trim().length <= 24) {
      const midText = mid[1]!.trim()
      if (/^[（(]/.test(midText)) {
        note = midText.replace(/^[（(]|[）)]$/g, "").trim() || midText
      } else {
        title = `${title} · ${midText}`
      }
      rest = mid[2]!.trim()
    }
  }

  const authorMatch = rest.match(
    /^(?:原作|作者|译者|翻译|作\s*_?\s*者)\s*[:：_]\s*(.+)$/i
  )
  if (authorMatch) {
    author = authorMatch[1]!.trim()
    rest = ""
  } else {
    const authorBy = rest.match(
      /^(.{0,24}?)[_\s]*(?:by|ｂｙ)\s*[:：_]?\s*(.+)$/i
    )
    if (authorBy && authorBy[2]!.trim().length <= 32) {
      const sub = authorBy[1]!.trim()
      if (sub) title = `${title}${sub.length <= 24 ? ` · ${sub}` : ""}`
      author = authorBy[2]!.trim()
      rest = ""
    } else {
      const authorLoose = rest.match(/^作\s*_?\s*[:：_]\s*(.+)$/i)
      if (authorLoose) {
        author = authorLoose[1]!.trim()
        rest = ""
      } else if (rest) {
        if (
          rest.length <= 16 &&
          !/[。！？\s]/.test(rest) &&
          !/^第/.test(rest)
        ) {
          author = rest
          rest = ""
        } else {
          note = rest
        }
      }
    }
  }

  if (author)
    author = author
      .replace(/^[「_]|」$/g, "")
      .replace(/[_]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
  if (!author && originalAuthor) author = originalAuthor

  return {
    title: title || raw.trim(),
    chapters,
    author,
    original,
    ai,
    genre,
    note,
  }
}

export function parseFeaturedTitle(raw: string): ParsedTitle {
  return parseListTitle(raw)
}

export function formatTitleMeta(p: ParsedTitle): string {
  const parts: string[] = []
  if (p.chapters) parts.push(p.chapters)
  if (p.author) parts.push(p.author)
  if (p.original) parts.push("原创")
  if (p.ai) parts.push("AI")
  if (p.genre) parts.push(p.genre)
  if (p.note) parts.push(p.note)
  return parts.join(" · ")
}

export function stripTrailingChapterMarker(title: string): string {
  return title.replace(/(?:[（(][^）)]{1,24}[）)]\s*)+$/, "")
}

export function normalizeTitleKey(title: string): string {
  return stripTrailingChapterMarker(
    title.replace(/^[「《【〖［[]+|[」》】〗］\]]+$/g, "")
  )
    .trim()
    .toLowerCase()
}
