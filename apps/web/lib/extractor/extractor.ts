import * as cheerio from "cheerio"
import { fetchUpstream } from "../upstream"
import {
  Extractor,
  ChapterLink,
  HomePage,
  HotPost,
  CmtRankPost,
  CategoryLink,
  CategoryQuery,
  CategoryPage,
  RecommendSection,
  PostMeta,
  BookMeta,
  ReplyItem,
  ReplyNode,
  ExtractorError,
} from "./types"

export class Cool18Extractor implements Extractor {
  name = "cool18"
  homeUrl = "https://www.cool18.com/bbs4/index.php"

  buildUrl(tid: string): string {
    return `https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=${tid}`
  }

  extractContent(html: string): {
    title: string
    content: string
    meta: PostMeta
  } {
    const $ = cheerio.load(html)
    const meta = this.extractPostMeta(html, $)

    const title =
      $("h1.main-title").first().text().trim() ||
      $("title")
        .first()
        .text()
        .replace(/\s*[-–|].*$/, "")
        .trim()

    // 优先 #content-section pre；否则取最长的 pre
    let pre = $("#content-section pre").first()
    let preHtml = ""
    if (pre.length) {
      preHtml = pre.html() || ""
    } else {
      $("pre").each((_i, el) => {
        const h = $(el).html() || ""
        if (h.length > preHtml.length) preHtml = h
      })
    }
    if (!preHtml) {
      throw new ExtractorError("content pre not found", 404)
    }

    const content = this.extractPreHtml(preHtml)
    return {
      title: title || "无标题",
      content,
      meta,
    }
  }

  buildBookUrl(cid: string): string {
    return `https://www.cool18.com/bbs4/index.php?app=book&act=bookview&cid=${cid}`
  }

  /** 书库藏文 bookview 页 */
  extractBookContent(html: string): {
    title: string
    content: string
    meta: BookMeta
  } {
    const $ = cheerio.load(html)

    let title =
      $(".show_content center font b, .show_content center b")
        .first()
        .text()
        .trim() ||
      $("center font[size='6'] b, center font[size=\"6\"] b")
        .first()
        .text()
        .trim() ||
      $("title")
        .first()
        .text()
        .replace(/\s*[-–|].*$/, "")
        .trim()

    // 送交者: 佚名
    let author: string | null = null
    const showText = $(".show_content").first().text()
    const senderMatch = showText.match(/送交者\s*[:：]\s*(\S+)/)
    if (senderMatch?.[1]) {
      author = senderMatch[1].trim()
    }

    // bodybegin 后的 pre 为正文
    let preHtml = ""
    const bodyMarker = html.indexOf("<!--bodybegin-->")
    if (bodyMarker !== -1) {
      const slice = html.slice(bodyMarker)
      const m = slice.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)
      if (m?.[1]) preHtml = m[1]
    }
    if (!preHtml) {
      let best = ""
      $("pre").each((_i, el) => {
        const h = $(el).html() || ""
        if (h.length > best.length) best = h
      })
      preHtml = best
    }
    if (!preHtml.trim()) {
      throw new ExtractorError("book content not found", 404)
    }

    const content = this.extractPreHtml(preHtml)
    if (!title) title = "无标题"
    return { title, content, meta: { author } }
  }

  /**
   * 从 threadview 页抽取元信息：
   * .sender / .views body 优先，JSON-LD + threadInfo 补全
   */
  private extractPostMeta(
    html: string,
    $: cheerio.CheerioAPI
  ): PostMeta {
    let author: string | null = null
    let uid: string | null = null
    let badge: string | null = null
    let publishedAt: string | null = null
    let reads: number | null = null
    let likes: number | null = null
    let comments: number | null = null
    let parent: PostMeta["parent"] = null
    let rootTid: string | null = null

    // body: .sender
    const senderEl = $(".sender").first()
    if (senderEl.length) {
      const senderText = senderEl.text().replace(/\s+/g, " ").trim()
      const aText = senderEl.find("a").first().text().trim()
      if (aText) author = aText

      const badgeMatch = senderText.match(/\[([^\]]+)\]/)
      if (badgeMatch?.[1]) badge = badgeMatch[1].trim()

      const dateMatch = senderText.match(
        /于\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/
      )
      if (dateMatch?.[1]) {
        publishedAt = this.normalizeDateTime(dateMatch[1])
      }
    }

    // body: .views — 已读N次 M赞
    const viewsText = $(".views").first().text().replace(/\s+/g, " ").trim()
    if (viewsText) {
      const readsMatch = viewsText.match(/已读\s*([\d,]+)\s*次/)
      if (readsMatch?.[1]) {
        reads = parseInt(readsMatch[1].replace(/,/g, ""), 10)
        if (isNaN(reads)) reads = null
      }
      const likesMatch = viewsText.match(/([\d,]+)\s*赞/)
      if (likesMatch?.[1]) {
        likes = parseInt(likesMatch[1].replace(/,/g, ""), 10)
        if (isNaN(likes)) likes = null
      }
    }

    // 评论页：回复目标
    // <span class="reply-info">回复: <a class="title-link" href="...tid=X">标题</a></span>
    // <span class="author">由 蛋伤 于 2026-04-10 3:59 </span>
    const replyInfo = $(".reply-info").first()
    if (replyInfo.length) {
      const $a = replyInfo.find("a[href*='tid=']").first()
      const parentTid = this.extractTid($a.attr("href") || "")
      const parentTitle = $a.text().replace(/\s+/g, " ").trim()
      if (parentTid && parentTitle) {
        let parentAuthor: string | null = null
        let parentPublishedAt: string | null = null
        // 同一 subtitle-line 里的 .author，或相邻
        const authorSpan = replyInfo.siblings(".author").first()
        const authorText = (
          authorSpan.length
            ? authorSpan.text()
            : replyInfo.parent().find(".author").first().text()
        )
          .replace(/\s+/g, " ")
          .trim()
        // 由 蛋伤 于 2026-04-10 3:59
        const parentMatch = authorText.match(
          /由\s*(.+?)\s+于\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/
        )
        if (parentMatch) {
          parentAuthor = parentMatch[1]?.trim() || null
          parentPublishedAt = this.normalizeDateTime(parentMatch[2] || "")
        } else if (authorText) {
          const nameOnly = authorText.replace(/^由\s*/, "").trim()
          if (nameOnly) parentAuthor = nameOnly
        }
        parent = {
          tid: parentTid,
          title: parentTitle,
          author: parentAuthor,
          publishedAt: parentPublishedAt,
        }
      }
    }

    // 根帖：表单 rootid 或「返回主帖」链接
    const rootInput = $("input[name='rootid']").attr("value")?.trim()
    if (rootInput && /^\d+$/.test(rootInput)) {
      rootTid = rootInput
    }
    if (!rootTid) {
      $("a[href*='tid=']").each((_i, el) => {
        const text = $(el).text().replace(/\s+/g, "")
        if (text.includes("返回主帖")) {
          const t = this.extractTid($(el).attr("href") || "")
          if (t) rootTid = t
        }
      })
    }

    // threadInfo JS
    const threadInfoMatch = html.match(
      /const\s+threadInfo\s*=\s*(\{[\s\S]*?\});/
    )
    if (threadInfoMatch?.[1]) {
      try {
        const info = JSON.parse(threadInfoMatch[1]) as {
          uid?: string | number
          username?: string
        }
        if (info.username && !author) author = String(info.username)
        if (info.uid != null && info.uid !== "") uid = String(info.uid)
      } catch {
        // ignore malformed
      }
    }

    // gift script path: .../getgift/{dbname}/{tid}/{uid}/get.js
    if (!uid) {
      const giftMatch = html.match(
        /getgift\/[^/]+\/\d+\/(\d+)\/get\.js/
      )
      if (giftMatch?.[1]) uid = giftMatch[1]
    }

    // JSON-LD Article
    const ldMatch = html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/i
    )
    if (ldMatch?.[1]) {
      try {
        const ld = JSON.parse(ldMatch[1]) as {
          author?: { name?: string }
          datePublished?: string
          commentCount?: string | number
        }
        if (!author && ld.author?.name) author = ld.author.name
        if (!publishedAt && ld.datePublished) {
          const d = ld.datePublished
          const m = d.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
          publishedAt = m ? `${m[1]} ${m[2]}` : d
        }
        if (ld.commentCount != null && ld.commentCount !== "") {
          const n = parseInt(String(ld.commentCount), 10)
          if (!isNaN(n)) comments = n
        }
      } catch {
        // ignore
      }
    }

    // meta author 兜底
    if (!author) {
      const metaAuthor = $('meta[name="author"]').attr("content")?.trim()
      if (metaAuthor) author = metaAuthor
    }

    return {
      author,
      uid,
      badge,
      publishedAt,
      reads,
      likes,
      comments,
      parent,
      rootTid,
    }
  }

  private normalizeDateTime(raw: string): string {
    return raw.replace(
      /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/,
      (_, y, mo, d, h, mi) =>
        `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${mi}`
    )
  }

  /**
   * 扩展链接：只收集「正文 pre 之外」的帖子链接。
   * 正文里的链接保留在 content 中可点击，不再重复进此列表。
   */
  extractLinks(html: string): ChapterLink[] {
    const $ = cheerio.load(html)
    const links: ChapterLink[] = []

    $("#content-section a[href*='tid=']").each((_i, elem) => {
      // 跳过正文 pre 内链接
      if ($(elem).closest("pre").length > 0) return

      const href = $(elem).attr("href") || ""
      const tid = this.extractTid(href)
      const title = $(elem).text().trim()
      if (tid && title) {
        links.push({ index: 0, title, tid })
      }
    })

    // 去重：按 tid
    const seen = new Set<string>()
    const unique = links.filter((link) => {
      if (seen.has(link.tid)) return false
      seen.add(link.tid)
      return true
    })

    // 按 tid 从小到大排序
    unique.sort((a, b) => {
      const aNum = parseInt(a.tid, 10) || 0
      const bNum = parseInt(b.tid, 10) || 0
      return aNum - bNum
    })

    // 重新赋值 index
    unique.forEach((link, idx) => {
      link.index = idx + 1
    })

    return unique
  }

  extractGoldLinks(html: string): ChapterLink[] {
    const $ = cheerio.load(html)
    const links: ChapterLink[] = []

    // 首页右侧「精华热贴」列表：#d_gold_list 里的帖子链接
    $("#d_gold_list table a[href*='tid=']").each((_i, elem) => {
      const href = $(elem).attr("href") || ""
      const tid = this.extractTid(href)
      const title = $(elem).text().trim()
      if (tid && title) {
        links.push({ index: 0, title, tid })
      }
    })

    // 去重：按 tid
    const seen = new Set<string>()
    const unique = links.filter((link) => {
      if (seen.has(link.tid)) return false
      seen.add(link.tid)
      return true
    })

    // 保留页面排列顺序，重新赋值 index
    unique.forEach((link, idx) => {
      link.index = idx + 1
    })

    return unique
  }

  /**
   * 首页「扫文推荐」：#post_pre_ext_content1
   * 原站为混合文本 + 链接，用 ★ 分段。
   */
  extractRecommendSections(html: string): RecommendSection[] {
    const $ = cheerio.load(html)
    const root = $("#post_pre_ext_content1")
    if (!root.length) return []

    const sections: RecommendSection[] = []
    let current: RecommendSection = { title: "推荐", links: [] }
    const seen = new Set<string>()

    const normalizeSectionTitle = (raw: string) => {
      return raw
        .replace(/^扫文推荐[：:]?\s*/g, "")
        .replace(/^[★\s]+/, "")
        .replace(/[：:\s]+$/g, "")
        .trim()
    }

    const startSection = (raw: string) => {
      const title = normalizeSectionTitle(raw)
      if (!title) return
      if (current.links.length > 0) {
        sections.push(current)
      }
      current = { title, links: [] }
    }

    const addLink = (href: string, label: string) => {
      const tid = this.extractTid(href)
      let title = label.trim()
      if (!tid || !title || seen.has(tid)) return
      seen.add(tid)

      // 链接标题自带 ★：多为独立精选帖，不并入上一分组说明
      const isStandalone = /^★/.test(title) && title.length > 6
      if (isStandalone) {
        title = title.replace(/^★\s*/, "")
        if (current.links.length > 0 && current.title !== "精选") {
          sections.push(current)
          current = { title: "精选", links: [] }
        } else if (current.title !== "精选") {
          current = { title: "精选", links: [] }
        }
      }

      current.links.push({ index: 0, title, tid })
    }

    root.contents().each((_i, node) => {
      if (node.type === "text") {
        const text = (node as unknown as { data?: string }).data ?? ""
        if (!text.includes("★")) return

        // 按 ★ 拆出多个段标题（链接之间的说明文字）
        const startsWithStar = text.trimStart().startsWith("★")
        const parts = text.split("★")
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]?.trim() ?? ""
          if (!part) continue
          // 首段若不带 ★ 前缀，是上一节尾巴（空说明），忽略
          if (i === 0 && !startsWithStar) continue
          startSection(part)
        }
        return
      }

      if (node.type !== "tag") return

      const tag = (node as { name?: string; tagName?: string }).name
        ?? (node as { tagName?: string }).tagName
        ?? ""

      if (tag === "a") {
        const $a = $(node)
        addLink($a.attr("href") || "", $a.text())
        return
      }

      if (tag === "b") {
        // 「扫文推荐：」标题，忽略
        return
      }

      // 兜底：嵌套节点里的链接
      $(node)
        .find("a[href*='tid=']")
        .each((_j, el) => {
          const $a = $(el)
          addLink($a.attr("href") || "", $a.text())
        })
    })

    if (current.links.length > 0) {
      sections.push(current)
    }

    // 合并同名分组（「精选」可能被书库分段打断）
    const merged: RecommendSection[] = []
    const byTitle = new Map<string, RecommendSection>()
    for (const section of sections) {
      const existing = byTitle.get(section.title)
      if (existing) {
        existing.links.push(...section.links)
      } else {
        const copy = { title: section.title, links: [...section.links] }
        byTitle.set(section.title, copy)
        merged.push(copy)
      }
    }

    // 「精选」置底，更符合原站「分段目录 → 独立条目」的阅读顺序
    const picks = merged.find((s) => s.title === "精选")
    const ordered = merged.filter((s) => s.title !== "精选")
    if (picks) ordered.push(picks)

    // 每组内重新编号
    for (const section of ordered) {
      section.links.forEach((link, idx) => {
        link.index = idx + 1
      })
    }

    return ordered.filter((s) => s.links.length > 0)
  }

  extractHotPosts(html: string): HotPost[] {
    const $ = cheerio.load(html)
    const posts: HotPost[] = []

    // 「近期热贴速览」人气榜：table.rank-table，每行一个帖子
    $("table.rank-table tbody tr").each((_i, tr) => {
      const $tr = $(tr)
      const $a = $tr.find("td.title-col a").first()
      const href = $a.attr("href") || ""
      const tid = this.extractTid(href)
      if (!tid) return

      const rawText = $a.text()

      // 标题取 <i>（日期标签）之前的文本节点，再去掉 " - 作者 (bytes)" 尾巴
      // 分隔符要求 "-" 前后都有空白，避免误伤标题内的连字符（如「1-１０2」）
      const title = $a
        .contents()
        .filter((_i, el) => el.type === "text")
        .first()
        .text()
        .replace(/\s+-\s+\S+\s*\(\d+\s*bytes\)\s*$/, "")
        .trim()

      const readsMatch = rawText.match(/\((\d+)\s*reads\)/)
      const readsNum = readsMatch?.[1]
      const reads = readsNum ? parseInt(readsNum, 10) : 0

      const rankText = $tr.find("td.rank-col").first().text().trim()
      const rankMatch = rankText.match(/(\d+)/)
      const rankNum = rankMatch?.[1]
      const rank = rankNum ? parseInt(rankNum, 10) : posts.length + 1

      posts.push({ rank, title, tid, reads })
    })

    return posts
  }

  extractCmtRankPosts(html: string): CmtRankPost[] {
    const $ = cheerio.load(html)
    const posts: CmtRankPost[] = []

    // 「《禁忌书屋》评论榜」：table.rank-table，列：排名/发帖人/标题/发布时间/评论数
    $("table.rank-table tbody tr").each((_i, tr) => {
      const $tr = $(tr)
      const $a = $tr
        .find("td")
        .eq(2)
        .find("a[href*='tid=']")
        .first()
      const href = $a.attr("href") || ""
      const tid = this.extractTid(href)
      if (!tid) return

      const title = $a.text().trim()

      // 原站 rank 只输出奇数（1,3,5…，疑似输出 bug），按行序修正为连续名次
      const rank = posts.length + 1

      const cmtText = $tr.find("td").eq(4).text().trim()
      const cmtMatch = cmtText.match(/(\d+)\s*评/)
      const cmtNum = cmtMatch?.[1]
      const comments = cmtNum ? parseInt(cmtNum, 10) : 0

      posts.push({ rank, title, tid, comments })
    })

    return posts
  }

  extractCategoryLinks(html: string): CategoryLink[] {
    const $ = cheerio.load(html)
    const links: CategoryLink[] = []

    // 首页「书屋原创区」等栏目分类链接组：.ext_org_title a
    $(".ext_org_title a").each((_i, elem) => {
      const raw = $(elem).text().trim()
      const href = $(elem).attr("href") || ""
      if (!raw || !href) return

      const label = raw.replace(/[『』〖〗【】\[\]]/g, "").trim() || raw
      const url = new URL(href, this.homeUrl)
      const type = url.searchParams.get("type")
      const keywords = url.searchParams.get("keywords")

      // 指向本地浏览页：type 分类 / q 栏目关键词
      if (type) {
        links.push({
          label: label || type,
          url: `/browse?type=${encodeURIComponent(type)}`,
          kind: "type",
        })
      } else if (keywords) {
        links.push({
          label: label || keywords,
          url: `/browse?q=${encodeURIComponent(keywords)}`,
          kind: "column",
        })
      } else {
        links.push({ label, url: href, kind: "other" })
      }
    })

    return links
  }

  /**
   * 跟帖列表：原站 achildlist JSON，再按 uptid 组树。
   */
  async fetchReplies(tid: string): Promise<ReplyNode[]> {
    const url = `${this.homeUrl}?app=forum&act=achildlist&tid=${encodeURIComponent(tid)}`
    const resp = await fetchUpstream(url, {
      headers: { Referer: this.buildUrl(tid) },
    })

    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }

    let data: unknown
    try {
      data = await resp.json()
    } catch {
      throw new ExtractorError("invalid replies response", 502)
    }

    if (!Array.isArray(data)) return []

    const items: ReplyItem[] = []
    for (const raw of data) {
      if (!raw || typeof raw !== "object") continue
      const r = raw as Record<string, unknown>
      const replyTid = String(r.tid ?? "")
      if (!replyTid) continue
      items.push({
        tid: replyTid,
        uptid: String(r.uptid ?? tid),
        rootid: String(r.rootid ?? tid),
        uid: String(r.uid ?? ""),
        username: this.stripHtml(String(r.username ?? "")),
        subject: this.stripHtml(String(r.subject ?? "")),
        dateline: String(r.dateline ?? ""),
        size: parseInt(String(r.size ?? "0"), 10) || 0,
      })
    }

    return this.buildReplyTree(items, tid)
  }

  private buildReplyTree(items: ReplyItem[], parentId: string): ReplyNode[] {
    const children = items.filter(
      (item) => String(item.uptid) === String(parentId)
    )
    return children.map((item) => ({
      ...item,
      children: this.buildReplyTree(items, item.tid),
    }))
  }

  async fetchCategoryPage(
    query: CategoryQuery,
    page: number
  ): Promise<CategoryPage> {
    const category = query.type ?? query.keywords ?? ""

    let url: string
    if (query.type) {
      url = `${this.homeUrl}?action=search&act=threadsearch&app=forum&type=${encodeURIComponent(query.type)}&submit=${encodeURIComponent("查询")}${page > 1 ? `&p=${page}` : ""}`
    } else if (query.keywords) {
      url = `${this.homeUrl}?act=threadsearch&app=forum&keywords=${encodeURIComponent(query.keywords)}&submit=${encodeURIComponent("栏目搜索")}&first=1${page > 1 ? `&p=${page}` : ""}`
    } else {
      throw new ExtractorError("missing type or keywords", 400)
    }

    const resp = await fetchUpstream(url, {
      headers: { Referer: this.homeUrl },
    })

    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }

    const html = await resp.text()
    return this.parseCategoryPage(html, category, page)
  }

  private parseCategoryPage(
    html: string,
    category: string,
    page: number
  ): CategoryPage {
    const $ = cheerio.load(html)
    const links: ChapterLink[] = []

    // 分类搜索结果列表：ul.post-list.thread-list li.l-m1 a
    $("ul.thread-list li.l-m1 a").each((_i, elem) => {
      const href = $(elem).attr("href") || ""
      const tid = this.extractTid(href)
      const title = $(elem).text().trim()
      if (tid && title) {
        links.push({ index: 0, title, tid })
      }
    })

    // 去重：按 tid
    const seen = new Set<string>()
    const unique = links.filter((link) => {
      if (seen.has(link.tid)) return false
      seen.add(link.tid)
      return true
    })

    unique.forEach((link, idx) => {
      link.index = idx + 1
    })

    // 分页：原站分页栏有「下一页」链接则还有后续页
    const hasNext = $("nav.pagination-bar a.next").length > 0
    const nextPage = hasNext ? page + 1 : null

    return { category, links: unique, nextPage }
  }

  /**
   * 把正文 pre 转成安全 HTML：
   * - 换行标签 → \n（配合 pre-wrap）
   * - tid 帖子链接 → /read/:tid
   * - cid 书库链接 → /book/:cid
   * - 其余标签剥离，文本 HTML 转义
   */
  private extractPreHtml(html: string): string {
    let inner = html
    // 去掉外层 <pre> 若存在
    const firstGt = inner.indexOf(">")
    if (inner.trimStart().toLowerCase().startsWith("<pre") && firstGt !== -1) {
      inner = inner.slice(firstGt + 1)
    }
    const lastPre = inner.toLowerCase().lastIndexOf("</pre>")
    if (lastPre !== -1) {
      inner = inner.slice(0, lastPre)
    }

    // 水印字体等噪音
    inner = inner.replace(
      /<font[^>]*color\s*=\s*[#]?E6E6DD[^>]*>[\s\S]*?<\/font>/gi,
      ""
    )

    inner = inner
      .replace(/<p><\/p>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")

    const placeholders: string[] = []
    // 抽出可识别链接为占位符（支持有/无引号 href）
    inner = inner.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (_match, attrs: string, labelHtml: string) => {
        const hrefMatch = attrs.match(
          /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
        )
        const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? ""
        const decodedHref = this.decodeHtmlEntities(href)
        const labelText = this.decodeHtmlEntities(
          this.stripTags(labelHtml)
        ).trim()

        const tid = this.extractTid(decodedHref)
        const cid = this.extractCid(decodedHref)

        let internal: string | null = null
        if (tid) {
          internal = `/read/${tid}`
        } else if (cid) {
          internal = `/book/${cid}`
        }

        if (!internal) {
          // 无法映射的链接：只保留文字
          return labelText
        }

        const label = this.escapeHtml(labelText || tid || cid || "链接")
        const idx = placeholders.length
        placeholders.push(
          `<a href="${this.escapeHtml(internal)}">${label}</a>`
        )
        return `\u0000L${idx}\u0000`
      }
    )

    // 去掉剩余 HTML 标签，解码实体，再转义
    let text = this.stripTags(inner)
    text = this.decodeHtmlEntities(text)
    text = this.escapeHtml(text)

    // 还原内部阅读链接
    text = text.replace(/\u0000L(\d+)\u0000/g, (_m, n) => {
      return placeholders[parseInt(n, 10)] ?? ""
    })

    return text.trim()
  }

  private stripTags(s: string): string {
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

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  private decodeHtmlEntities(s: string): string {
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

    // 数字实体 &#123;
    s = s.replace(/&#(\d+);/g, (_match, num) => {
      const code = parseInt(num, 10)
      if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code)
      }
      return _match
    })

    // 十六进制实体 &#xHH;
    s = s.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = parseInt(hex, 16)
      if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code)
      }
      return _match
    })

    return s
  }

  async fetchHomeLinks(mtid: string): Promise<HomePage> {
    const resp = await fetchUpstream(
      `https://www.cool18.com/bbs4/index.php?app=forum&act=ajax&mtid=${mtid}&aifilter=0`,
      {
        headers: {
          Referer: "https://www.cool18.com/bbs4/index.php",
        },
      }
    )

    if (!resp.ok) {
      throw new ExtractorError(`upstream error: ${resp.status}`, 502)
    }

    const data = (await resp.json()) as Array<{
      tid: string
      subject: string
      rootid: string
    }>

    // 只取主帖（rootid === "0"），去重，清理标题中的 HTML
    const seen = new Set<string>()
    const links: ChapterLink[] = []
    let nextMtid: string | null = null

    for (const item of data) {
      if (item.rootid !== "0") continue
      if (!item.tid || seen.has(item.tid)) continue
      seen.add(item.tid)

      // 下一页游标：本批主帖中最小的 tid（与原站 _mtid 推进逻辑一致）
      if (nextMtid === null || parseInt(item.tid, 10) < parseInt(nextMtid, 10)) {
        nextMtid = item.tid
      }

      links.push({
        index: 0,
        title: this.stripHtml(item.subject),
        tid: item.tid,
      })
    }

    // 按 tid 从大到小排序（新的在前面）
    links.sort((a, b) => {
      const aNum = parseInt(a.tid, 10) || 0
      const bNum = parseInt(b.tid, 10) || 0
      return bNum - aNum
    })

    // 重新赋值 index
    links.forEach((link, idx) => {
      link.index = idx + 1
    })

    return { links, nextMtid }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, "")
      .replace(/\\\//g, "/")
      .trim()
  }

  private extractTid(href: string): string | null {
    const m = href.match(/[?&#]tid=([^&#"'\s]+)/i)
    if (m?.[1]) return m[1]
    // bare query: tid=123
    const bare = href.match(/(?:^|[?&])tid=([^&#"'\s]+)/i)
    return bare?.[1] ?? null
  }

  private extractCid(href: string): string | null {
    const m = href.match(/[?&#]cid=([^&#"'\s]+)/i)
    if (m?.[1]) return m[1]
    if (/bookview/i.test(href)) {
      const bare = href.match(/(?:^|[?&])cid=([^&#"'\s]+)/i)
      return bare?.[1] ?? null
    }
    return null
  }
}
