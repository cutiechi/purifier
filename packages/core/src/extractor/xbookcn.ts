import * as cheerio from "cheerio"
import { fetchUpstream } from "../upstream"
import { decodeHtmlEntities, escapeHtml, stripTags } from "./utils"
import {
  type BookContentResponse,
  type CategoryLink,
  type CategoryPage,
  type CategoryQuery,
  type ChapterLink,
  type ContentResponse,
  type CmtRankPost,
  type Extractor,
  type HomePage,
  type HotPost,
  type RecommendSection,
  type ReplyNode,
  ExtractorError,
} from "./types"

const NOVEL_PATH_RE = /^\/novel\/([^/]+)(?:\/(\d+))?$/

function notSupported(what: string): ExtractorError {
  return new ExtractorError(`xbookcn does not support ${what}`, 404)
}

/** /novel/MjI4NzE/2 → "MjI4NzE"（取第二 path 段 = cid） */
export function cidFromUrl(href: string): string {
  const m = href.match(/^\/novel\/([^/]+)/)
  return m?.[1] ?? ""
}

/** /novel/MjI4NzE/2 → 2（取第三段章号；无章号返回 null） */
export function parseChapterN(href: string): number | null {
  const m = href.match(NOVEL_PATH_RE)
  if (!m?.[2]) return null
  const n = parseInt(m[2], 10)
  return Number.isFinite(n) ? n : null
}

/** "作者：幻想 · 7章 · 12.8万字" → "幻想"；无匹配 null */
export function parseAuthor(meta: string): string | null {
  const m = meta.match(/作者[：:]\s*([^·\n]+)/)
  const name = m?.[1]?.trim()
  return name ? name : null
}

/** "第 1 章 序：不是开始的开始" → "序：不是开始的开始"；无前缀原样返回 */
export function parseChapterTitle(text: string): string {
  const stripped = text.replace(/^\s*第\s*\d+\s*章\s*/, "").trim()
  return stripped || text.trim()
}

export class XbookcnExtractor implements Extractor {
  name = "xbookcn"
  homeUrl = "https://www.xbookcn.org"

  buildUrl(_tid: string): string {
    // 无帖子模型；若被误调，由 extractContent 抛 404
    throw notSupported("posts")
  }
  buildBookUrl(cid: string): string {
    return `${this.homeUrl}/novel/${cid}`
  }
  /** 非接口成员：章节 URL */
  buildChapterUrl(cid: string, chapter: string | number): string {
    return `${this.homeUrl}/novel/${cid}/${chapter}`
  }

  extractContent(_html: string): ContentResponse {
    throw notSupported("posts")
  }
  extractGoldLinks(_html: string): ChapterLink[] {
    throw notSupported("gold/featured links")
  }
  extractCmtRankPosts(_html: string): CmtRankPost[] {
    throw notSupported("comment rank")
  }
  extractRecommendSections(_html: string): RecommendSection[] {
    throw notSupported("picks sections")
  }
  fetchReplies(_tid: string): Promise<ReplyNode[]> {
    throw notSupported("replies")
  }
  fetchRepliesRaw(_tid: string): Promise<string> {
    throw notSupported("replies")
  }
  parseReplies(_raw: string, _tid: string): ReplyNode[] {
    throw notSupported("replies")
  }

  /**
   * opts.chapter 缺省 → 目录页；给定 → 章节正文。
   * 单篇：目录无章节列表，仍可 chapter=1 取正文。
   */
  extractBookContent(
    html: string,
    opts?: { chapter?: string }
  ): BookContentResponse {
    if (!opts?.chapter) return this.extractToc(html)
    return this.extractChapter(html, opts.chapter)
  }

  private extractToc(html: string): BookContentResponse {
    const $ = cheerio.load(html)
    const title = $("main h1").first().text().trim()

    const metaSection = $("main .tk-meta").first()
    const metaText = metaSection.text()
    const author = parseAuthor(metaText) ?? this.authorFromMeta($, metaSection)

    const intro =
      $('section:has(h2:contains("作品简介")) p.tk-body')
        .first()
        .text()
        .trim() || undefined

    const chapterLinks = $("#chapters-list a").toArray()
    const ctaHref = $('a[aria-label^="开始阅读"]').first().attr("href") ?? ""
    const hasChapterList = chapterLinks.length > 0
    const singleShot = !/共\s*\d+\s*章/.test(html) && !hasChapterList

    let chapters: ChapterLink[]
    if (singleShot) {
      const cid = cidFromUrl(ctaHref)
      chapters = [{ index: 1, title, tid: cid }]
    } else {
      chapters = chapterLinks.map((a, i) => ({
        index: i + 1,
        title: parseChapterTitle($(a).text()),
        tid: cidFromUrl($(a).attr("href") ?? ""),
      }))
    }

    const related: ChapterLink[] = $("#related-section a[role=listitem]")
      .map((i, a) => ({
        index: i + 1,
        title: $(a).find("h3").first().text().trim(),
        tid: cidFromUrl($(a).attr("href") ?? ""),
      }))
      .get()

    return {
      title,
      content: intro ?? "",
      intro,
      meta: { author },
      chapters,
      singleShot,
      related,
    }
  }

  private extractChapter(html: string, chapter: string): BookContentResponse {
    const $ = cheerio.load(html)
    const title = $("main h1").first().text().trim()

    // 书名：优先 .book-header a.book-title；回退面包屑里 href 形如 /novel/{cid}（无章号后缀）的链接
    let bookTitle: string | undefined = $(".book-header a.book-title")
      .first()
      .text()
      .trim()
    if (!bookTitle) {
      bookTitle =
        $("nav a[href^='/novel/']")
          .filter((_i, a) => {
            const href = $(a).attr("href") ?? ""
            return /^\/novel\/[^/]+$/.test(href)
          })
          .first()
          .text()
          .trim() || undefined
    }

    const rawArticle = $("#read-article").html() ?? ""
    const cid = cidFromUrl(
      $("nav a[href^='/novel/']").first().attr("href") ?? ""
    )
    const content = this.sanitizeChapterHtml(rawArticle, cid)

    const chapterIndex = Number(chapter)
    let prevChapter: number | undefined
    let nextChapter: number | undefined
    $('nav[aria-label="本章导航"] a[href^="/novel/"]').each((_i, a) => {
      const href = $(a).attr("href") ?? ""
      const n = parseChapterN(href)
      if (n === null || n === chapterIndex) return
      if (n < chapterIndex) prevChapter = n
      else if (nextChapter === undefined || n < nextChapter) nextChapter = n
    })

    return {
      title,
      content,
      bookTitle,
      chapterIndex,
      prevChapter,
      nextChapter,
      meta: { author: null },
    }
  }

  /**
   * 正文清洗（占位法，对齐 Cool18 extractPreHtml）：
   * - /novel/{cid}/{n} 站内章链 → <a href="/book/{cid}?site=2&chapter={n}">
   * - 其余 <a>（推广外链等）剥离标签只留文字
   * - 整体 stripTags + decodeEntities + escapeHtml 后还原占位
   */
  private sanitizeChapterHtml(rawHtml: string, cid: string): string {
    let inner = rawHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")

    const placeholders: string[] = []
    inner = inner.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (_m, attrs, labelHtml) => {
        const hrefMatch = attrs.match(
          /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
        )
        const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? ""
        const decodedHref = decodeHtmlEntities(href)
        const labelText = decodeHtmlEntities(stripTags(labelHtml)).trim()

        const n = cid ? parseChapterN(decodedHref) : null
        const isInSiteChapter =
          !!cid && n !== null && decodedHref.startsWith(`/novel/${cid}/`)

        if (!isInSiteChapter) {
          // 外链或无法映射：只保留文字
          return labelText
        }

        const internal = `/book/${cid}?site=2&chapter=${n}`
        const label = escapeHtml(labelText || `第 ${n} 章`)
        const idx = placeholders.length
        placeholders.push(`<a href="${escapeHtml(internal)}">${label}</a>`)
        return `\u0000L${idx}\u0000`
      }
    )

    let text = stripTags(inner)
    text = decodeHtmlEntities(text)
    text = escapeHtml(text)
    text = text.replace(/\u0000L(\d+)\u0000/g, (_m, idx) => {
      return placeholders[parseInt(idx, 10)] ?? ""
    })

    return text.replace(/\n{3,}/g, "\n\n").trim()
  }

  /**
   * 首页/最新列表游标（mtid 语义在 xbookcn 为页码，不是 cool18 的 tid 游标）：
   * - mtid=0 或空 → 抓首页 `/`，解析「时间线更新」卡片；nextMtid="1"
   * - mtid=n (n≥1) → 抓 `/novels/{n}`（实测 /novels/1 可用）；有「下一页」则 nextMtid=String(n+1)
   */
  async fetchHomeLinks(
    mtid: string,
    signal?: AbortSignal
  ): Promise<HomePage> {
    const page = parseInt(mtid, 10) || 0
    const url = page >= 1 ? `${this.homeUrl}/novels/${page}` : this.homeUrl
    const resp = await fetchUpstream(url, { signal })
    if (!resp.ok)
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    const html = await resp.text()

    if (page >= 1) {
      return {
        links: this.parseNovelCards(html),
        nextMtid: this.hasNextPage(html) ? String(page + 1) : null,
      }
    }
    return {
      links: this.parseNovelCards(html),
      nextMtid: this.hasMoreLink(html, "/novels") ? "1" : null,
    }
  }

  /** 首页时间线「更多 → /novels」链接存在 → 有下一页 */
  hasMoreLink(html: string, target: string): boolean {
    const $ = cheerio.load(html)
    let found = false
    $("a[href]").each((_i, a) => {
      if ($(a).attr("href") === target && $(a).text().includes("更多")) {
        found = true
      }
    })
    return found
  }

  /** 列表分页：`nav.list-pagination` 里存在「下一页」链接 → 还有后续页 */
  hasNextPage(html: string): boolean {
    const $ = cheerio.load(html)
    return (
      $("nav.list-pagination a").filter(
        (_i, a) => $(a).text().trim() === "下一页"
      ).length > 0
    )
  }

  /**
   * 解析首页/最新/标签/搜索的小说卡 → ChapterLink[]。
   * 首页卡片 class=home-feed-item，列表页卡片 class=list-feed-item，结构同构。
   */
  parseNovelCards(html: string): ChapterLink[] {
    const $ = cheerio.load(html)
    const links: ChapterLink[] = []
    const seen = new Set<string>()
    $("article.home-feed-item, article.list-feed-item").each((_i, article) => {
      const a = $(article).find("a[href^='/novel/']").first()
      const href = a.attr("href") ?? ""
      const cid = cidFromUrl(href)
      const title = a.find("h3").first().text().trim()
      if (!cid || !title || seen.has(cid)) return
      seen.add(cid)
      links.push({ index: links.length + 1, title, tid: cid })
    })
    return links
  }

  /** 导航题材 + 有声 → CategoryLink[]；url 必须带 site=2 */
  extractCategoryLinks(html: string): CategoryLink[] {
    const $ = cheerio.load(html)
    const links: CategoryLink[] = []
    const seen = new Set<string>()

    // 「主题浏览」网格里的 /tag/{slug} 题材入口
    $('h2:contains("主题浏览")')
      .closest("section")
      .find('a[href^="/tag/"]')
      .each((_i, a) => {
        const href = $(a).attr("href") ?? ""
        const slug = href.replace(/^\/tag\//, "")
        const label = $(a).text().trim()
        if (!slug || /^\d+$/.test(slug)) return // /tag/999 归到有声入口
        if (!label || seen.has(slug)) return
        seen.add(slug)
        links.push({
          label,
          url: `/browse?type=${encodeURIComponent(slug)}&site=2`,
          kind: "type",
        })
      })

    // 「有声小说」区块「更多 → /tag/999」→ 归一为 audio
    const audioHref =
      $('h2:contains("有声小说")')
        .closest("section")
        .find('a[href^="/tag/"]')
        .first()
        .attr("href") ?? ""
    const audioSlug = audioHref.replace(/^\/tag\//, "")
    if (audioHref && !seen.has("audio")) {
      links.push({
        label: "有声",
        url: "/browse?type=audio&site=2",
        kind: "type",
      })
      seen.add("audio")
      seen.add(audioSlug)
    }

    return links
  }

  /** 今日热读榜：首页 `#hot-ranking` ol；xbookcn 无阅读数，reads=0 */
  extractHotPosts(html: string): HotPost[] {
    const $ = cheerio.load(html)
    const posts: HotPost[] = []
    $("#hot-ranking ol li a").each((_i, a) => {
      const rankText = $(a).find("span").first().text().trim()
      const titleText = $(a).find("span").eq(1).text().trim()
      const tid = cidFromUrl($(a).attr("href") ?? "")
      const rank = parseInt(rankText, 10)
      if (!tid || !titleText) return
      posts.push({
        rank: Number.isFinite(rank) ? rank : posts.length + 1,
        title: titleText,
        tid,
        reads: 0,
      })
    })
    return posts
  }

  /**
   * type → /tag/{slug} 或 /tag/{slug}/{page}
   * keywords → /search?q=&page=  （搜索全支持）
   * page 从 1 起；page=1 时标签不加数字后缀，搜索不带 page
   */
  async fetchCategoryPage(
    query: CategoryQuery,
    page: number
  ): Promise<CategoryPage> {
    const category = query.type ?? query.keywords ?? ""

    let url: string
    if (query.type) {
      const slug = query.type
      url = `${this.homeUrl}/tag/${encodeURIComponent(slug)}${page > 1 ? `/${page}` : ""}`
    } else if (query.keywords) {
      url = `${this.homeUrl}/search?q=${encodeURIComponent(query.keywords)}${page > 1 ? `&page=${page}` : ""}`
    } else {
      throw new ExtractorError("missing type or keywords", 400)
    }

    const resp = await fetchUpstream(url)
    if (!resp.ok)
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    const html = await resp.text()

    return {
      category,
      links: this.parseNovelCards(html),
      nextPage: this.hasNextPage(html) ? page + 1 : null,
    }
  }

  /** 热榜 HTML 来源：xbookcn 抓 `/`（首页含侧栏热榜） */
  async fetchHotHtml(): Promise<string> {
    const resp = await fetchUpstream(this.homeUrl)
    if (!resp.ok)
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    return resp.text()
  }

  /** meta 行里「作者：」后的文本（链接或纯文本） */
  private authorFromMeta(
    $: cheerio.CheerioAPI,
    metaSection: cheerio.Cheerio<any>
  ): string | null {
    let author: string | null = null
    metaSection.find("div").each((_i, row) => {
      const label = $(row).find("span").first().text().trim()
      if (!label.includes("作者")) return
      const value = $(row).find("a").first().text().trim()
      author = value || $(row).text().replace(label, "").trim() || null
    })
    return author
  }
}
