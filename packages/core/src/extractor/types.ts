export interface ChapterLink {
  index: number
  title: string
  tid: string
}

/** 评论所回复的父帖 */
export interface PostParent {
  tid: string
  title: string
  author: string | null
  publishedAt: string | null
}

/** 帖子（tid）元信息 */
export interface PostMeta {
  author: string | null
  uid: string | null
  badge: string | null
  publishedAt: string | null
  reads: number | null
  likes: number | null
  comments: number | null
  /** 本帖回复的目标（评论页才有） */
  parent: PostParent | null
  /** 主题根帖 tid（评论页） */
  rootTid: string | null
}

/** 跟帖 / 评论（扁平，可组树） */
export interface ReplyItem {
  tid: string
  uptid: string
  rootid: string
  uid: string
  username: string
  subject: string
  dateline: string
  size: number
}

export interface ReplyNode extends ReplyItem {
  children: ReplyNode[]
}

/** 书库（cid）元信息 */
export interface BookMeta {
  author: string | null
}

export interface ContentResponse {
  title: string
  /** Sanitized HTML: escaped text + internal `/read/:tid` anchors only */
  content: string
  /** Links outside the body (pre); in-body links stay in `content` */
  links: ChapterLink[]
  meta: PostMeta
}

export interface BookContentResponse {
  title: string
  content: string
  meta: BookMeta
  // —— xbookcn 扩展（可选，cool18 不填，行为不变）——
  intro?: string
  chapters?: ChapterLink[]
  singleShot?: boolean
  related?: ChapterLink[]
  /** 章节正文页的书名（recordVisit 书名策略用）；目录页不需填 */
  bookTitle?: string
  chapterIndex?: number
  prevChapter?: number
  nextChapter?: number
}

export interface HomePage {
  links: ChapterLink[]
  nextMtid: string | null
}

export interface HotPost {
  rank: number
  title: string
  tid: string
  reads: number
}

export interface CmtRankPost {
  rank: number
  title: string
  tid: string
  comments: number
}

export interface CategoryLink {
  /** 展示名（已去掉 『』〖〗 等装饰） */
  label: string
  url: string
  /** type=题材分类 / column=栏目关键词 / other */
  kind: "type" | "column" | "other"
}

export interface CategoryQuery {
  type?: string
  keywords?: string
}

export interface CategoryPage {
  category: string
  links: ChapterLink[]
  nextPage: number | null
}

/** 首页「扫文推荐」分组 */
export interface RecommendSection {
  title: string
  links: ChapterLink[]
}

export interface Extractor {
  name: string
  homeUrl: string
  buildUrl(tid: string): string
  buildBookUrl(cid: string): string
  /** 解析正文并复用同一次 DOM 解析产出站外链接 */
  extractContent(html: string): ContentResponse
  extractBookContent(
    html: string,
    opts?: { chapter?: string }
  ): BookContentResponse
  extractGoldLinks(html: string): ChapterLink[]
  extractHotPosts(html: string): HotPost[]
  extractCmtRankPosts(html: string): CmtRankPost[]
  extractCategoryLinks(html: string): CategoryLink[]
  extractRecommendSections(html: string): RecommendSection[]
  /** 热榜 HTML 来源（handleTrending 统一调用） */
  fetchHotHtml(): Promise<string>
  /** 章节 URL（xbookcn 用；cool18 不实现即 undefined，API 层可选链调用） */
  buildChapterUrl?(cid: string, chapter: string | number): string
  fetchCategoryPage(query: CategoryQuery, page: number): Promise<CategoryPage>
  fetchHomeLinks(mtid: string, signal?: AbortSignal): Promise<HomePage>
  fetchReplies(tid: string): Promise<ReplyNode[]>
  /** 拉取 achildlist 原始文本（Referer: buildUrl(tid)）；网络失败抛 ExtractorError(502) */
  fetchRepliesRaw(tid: string): Promise<string>
  /** 纯函数：JSON 文本 → 回复树；非法 JSON 抛 ExtractorError(502)，非数组返回 [] */
  parseReplies(raw: string, tid: string): ReplyNode[]
}

export class ExtractorError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500
  ) {
    super(message)
    this.name = "ExtractorError"
  }
}
