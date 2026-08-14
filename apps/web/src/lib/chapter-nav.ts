/**
 * 论坛章节邻居提取。
 *
 * 数据源（spec §6-2，双来源标题模式，不当作序列）：
 *  - contentLinks：正文 pre 外扩展链接（extractLinksFromDom 输出，tid 数值序、index 非章节号）
 *  - bodyLinks：正文 content 内的站内链接（extractBodyChapterLinks 解析清洗后 HTML）
 * 当前帖 tid 不在任一来源时，依赖标题匹配而非位置。
 */

export type ChapterLinkLike = { tid: string; title: string }
export type ChapterNeighbor = {
  prev?: ChapterLinkLike
  next?: ChapterLinkLike
}

const PREV_RE = /^(上一章|上一回|上章)$/
const NEXT_RE = /^(下一章|下一回|下章)$/

export function extractChapterNeighbors(
  contentLinks: ChapterLinkLike[],
  bodyLinks: ChapterLinkLike[]
): ChapterNeighbor {
  const pick = (re: RegExp) => {
    const fromBody = bodyLinks.find((l) => re.test(l.title.trim()))
    if (fromBody) return fromBody
    return contentLinks.find((l) => re.test(l.title.trim()))
  }
  // 归一化为声明的 ChapterLinkLike 形状：调用方夹具可携带额外字段（如 index），
  // 但输出只保留 tid/title，避免破坏输出契约。
  const normalize = (l?: ChapterLinkLike) =>
    l ? { tid: l.tid, title: l.title } : undefined
  const prev = normalize(pick(PREV_RE))
  const next = normalize(pick(NEXT_RE))
  if (!prev && !next) return {}
  return { prev, next }
}

/** 解析清洗后正文 HTML 的站内 /read/:tid 链接。
 * 后端 extractPreHtml（cheerio sanitizeContentHtml）输出规范为 <a href="/read/:tid">文本</a>，
 * 属性仅 href、顺序可控；article-view 渲染时的 DOMPurify 只是兜底、不改变结构。
 * 用正则以支持 bun test（bun 环境无 DOMParser），替代 spec 中的 DOMParser 表述。 */
export function extractBodyChapterLinks(html: string): ChapterLinkLike[] {
  const out: ChapterLinkLike[] = []
  const re = /<a\s+href="([^"]*\/read\/([^"?#]+)[^"]*)">([^<]*)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tid = decodeURIComponent(m[2]!)
    const title = m[3]!.trim()
    if (tid && title) out.push({ tid, title })
  }
  return out
}
