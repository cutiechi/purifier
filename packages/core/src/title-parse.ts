/**
 * 解析列表标题（首页时间线 / 精华等）
 *
 * 【马屌少年…】（第三部 1-2）作者：热爱生活的小东『都市』
 * 为妻子种下一片森林（13）[原创]『都市』
 * 【安环之乱】（01-22）作 者:可乐瓶子[原创]
 */

export interface ParsedTitle {
  /** 主标题（去掉外层括号装饰） */
  title: string
  /** 章节区间等 */
  chapters: string | null
  /** 作者 / 原作 / 译者 */
  author: string | null
  /** [原创] */
  original: boolean
  /** [AI辅助] */
  ai: boolean
  /** 『都市』等题材 */
  genre: string | null
  /** 未能归类的尾巴 */
  note: string | null
}

function fullwidthToHalf(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  )
}

export function parseListTitle(raw: string): ParsedTitle {
  let s = raw.replace(/\s+/g, " ").trim()

  const original = /\[\s*原创\s*\]/.test(s)
  const ai = /\[\s*AI辅助\s*\]/i.test(s)
  s = s
    .replace(/\[\s*原创\s*\]/g, "")
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
    // 无外层书名号：尽量从「作者」处切开
    const splitAuthor = s.match(
      /^(.*?)(?:\s*(?:作者|原作|译者|作\s*者)\s*[:：]\s*.+)$/
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

  // 标题自身尾巴：（13） / （完）
  if (!rest) {
    const titleCh = title.match(/^(.*?)[（(]([^）)]{1,24})[）)]\s*$/)
    if (titleCh?.[1] && titleCh[1].trim().length >= 2) {
      title = titleCh[1]!.trim()
      chapters = fullwidthToHalf(titleCh[2]!).trim()
    }
  }

  // rest 前缀章节：（第三部 1-2） （075） 1-7  10  14-15  30（完） 第23章…
  const chParen = rest.match(/^[（(]([^）)]+)[）)]\s*(.*)$/)
  if (chParen) {
    chapters = fullwidthToHalf(chParen[1]!).trim()
    rest = chParen[2]!.trim()
  } else if (rest) {
    const chBare = rest.match(
      /^(\d+(?:\.\d+)?\s*[-－–~～]\s*\d+(?:\.\d+)?(?:\s*完)?(?:[（(]完[）)])?)\s*(.*)$/
    )
    if (chBare) {
      chapters = fullwidthToHalf(chBare[1]!).replace(/\s+/g, "")
      rest = chBare[2]!.trim()
    } else {
      // 单章号：10 / 30（完）
      const chSingle = rest.match(
        /^(\d+(?:\.\d+)?(?:[（(]完[）)]|完)?)\s*(.*)$/
      )
      if (
        chSingle &&
        (!chSingle[2] || /^(?:原作|作者|译者|翻译|作)/i.test(chSingle[2]!))
      ) {
        chapters = fullwidthToHalf(chSingle[1]!).replace(/\s+/g, "")
        rest = (chSingle[2] ?? "").trim()
      } else if (/^第/.test(rest)) {
        // 第七卷… / 第23章… → 整段当副标
        chapters = rest
        rest = ""
      }
    }
  }

  // 副标题夹在章节与作者之间：如「有人抓奸 作者：」
  if (rest && !/^(?:原作|作者|译者|翻译|作\s*者|作)\s*[:：]/i.test(rest)) {
    const mid = rest.match(
      /^(.*?)\s*((?:原作|作者|译者|翻译|作\s*者)\s*[:：].*)$/i
    )
    if (mid?.[1] && mid[1].trim().length > 0 && mid[1].trim().length <= 24) {
      const midText = mid[1]!.trim()
      // （小三上位）这类备注进 note；「有人抓奸」并入标题
      if (/^[（(]/.test(midText)) {
        note = midText.replace(/^[（(]|[）)]$/g, "").trim() || midText
      } else {
        title = `${title} · ${midText}`
      }
      rest = mid[2]!.trim()
    }
  }

  const authorMatch = rest.match(
    /^(?:原作|作者|译者|翻译|作\s*者)\s*[:：]\s*(.+)$/i
  )
  if (authorMatch) {
    author = authorMatch[1]!.trim()
    rest = ""
  } else {
    const authorLoose = rest.match(/^作\s*[:：]\s*(.+)$/i)
    if (authorLoose) {
      author = authorLoose[1]!.trim()
      rest = ""
    } else if (rest) {
      // 仅当明确不像句子时才当作者（精华列表里常见「刘伶醉」）
      if (rest.length <= 16 && !/[。！？\s]/.test(rest) && !/^第/.test(rest)) {
        author = rest
        rest = ""
      } else {
        note = rest
      }
    }
  }

  if (author) author = author.replace(/\s+/g, " ").trim()

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

/** @deprecated 使用 parseListTitle */
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
