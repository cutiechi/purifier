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

  // 站内栏目前缀/装饰：_ 前缀、★☆◆ 装饰、[贺岁]/迎新__ 等栏目标签
  // （spider 文件名常带 _ 前缀；原站标题常以 ★ 开头标记公告/贺岁帖）
  s = s
    .replace(/^[_\s]+/, "")
    .replace(/^[★☆◇◆]+/, "")
    .replace(/^\[[^\]\n]+\][_\s]*/, "")
    .replace(/^(?:迎新|辞旧|贺岁|新春|元宵)[_\s]*/, "")
    .trim()

  const original = /\[\s*原创\s*\]/.test(s)
  const ai = /\[\s*AI辅助\s*\]/i.test(s)
  // [xxx_原创] 形如 [小小书童_原创]：作者在原创标记内，提前提取
  // （必须带下划线，避免 [女性原创]/[真实原创] 这类题材标记被误当作者）
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
    // 无外层书名号：尽量从「作者」处切开（作者分隔符支持 :：_）
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

  // 标题自身尾巴：（13） / （完）
  if (!rest) {
    const titleCh = title.match(/^(.*?)[（(]([^）)]{1,24})[）)]\s*$/)
    if (titleCh?.[1] && titleCh[1].trim().length >= 2) {
      title = titleCh[1]!.trim()
      chapters = fullwidthToHalf(titleCh[2]!).trim()
    }
  }

  // rest 前缀章节：（第三部 1-2） （075） 1-7  10  14-15  30（完） 第23章…
  // 前导 _ 分隔（原站作者分隔符常见 _）：_作者_xxx、_（01-42完结）_作_者：xxx
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
      // 单章号：10 / 30（完）
      const chSingle = rest.match(
        new RegExp(
          `^(${fullDigit}+(?:\\.${fullDigit}+)?(?:[（(]完[）)]|完)?)\\s*(.*)$`
        )
      )
      if (
        chSingle &&
        (!chSingle[2] || /^(?:原作|作者|译者|翻译|作\s*_?\s*者)/i.test(chSingle[2]!))
      ) {
        chapters = fullwidthToHalf(chSingle[1]!).replace(/\s+/g, "")
        rest = (chSingle[2] ?? "").trim()
      } else if (/^第/.test(rest)) {
        // 第七卷… / 第23章… → 整段当副标
        chapters = rest
        rest = ""
      } else {
        // 「完」单独完结标记：完沉木[原创] → 完 + 作者 沉木
        const doneMark = rest.match(/^完(?:\s*(.*))$/)
        if (doneMark) {
          chapters = "完"
          rest = (doneMark[1] ?? "").trim()
        }
      }
    }
  }

  // 副标题夹在章节与作者之间：如「有人抓奸 作者：」
  if (rest && !/^(?:原作|作者|译者|翻译|作\s*_?\s*者|作)\s*[:：_]/i.test(rest)) {
    const mid = rest.match(
      /^(.*?)\s*((?:原作|作者|译者|翻译|作\s*_?\s*者)\s*[:：_].*)$/i
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
    /^(?:原作|作者|译者|翻译|作\s*_?\s*者)\s*[:：_]\s*(.+)$/i
  )
  if (authorMatch) {
    author = authorMatch[1]!.trim()
    rest = ""
  } else {
    // by / ｂｙ 作者格式：〖短篇合集〗by黑暗、ｂｙ恶魔岛诸位、意乱情迷_by_湾湾
    // （by 前允许 ≤24 字副标题并入标题）
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
        // 仅当明确不像句子时才当作者（精华列表里常见「刘伶醉」）
        if (rest.length <= 16 && !/[。！？\s]/.test(rest) && !/^第/.test(rest)) {
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
