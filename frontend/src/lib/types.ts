export type SiteId = "1" | "2"
export type ItemKind = "post" | "book"

export interface ChapterLink {
  index: number
  title: string
  tid: string
}

export interface ParentPost {
  tid: string
  title: string
  author?: string
  publishedAt?: string
}

export interface PostMeta {
  author?: string
  uid?: string
  badge?: string
  publishedAt?: string
  reads?: number
  likes?: number
  comments?: number
  parent?: ParentPost
  rootTid?: string
}

export interface ReplyNode {
  tid: string
  uptid: string
  rootid: string
  uid: string
  username: string
  subject: string
  dateline: string
  children: ReplyNode[]
}

export interface PostDetail {
  title: string
  content: string
  links: ChapterLink[]
  meta: PostMeta
  replies: ReplyNode[]
  url: string
  stale?: boolean
  refreshError?: string
}

export interface BookDetail {
  title: string
  intro?: string
  meta: { author?: string | null }
  chapters: Array<{ index: number; title: string; n: number }>
}

export interface ChapterDetail {
  title: string
  bookTitle?: string
  content: string
  chapterIndex: number
  prevChapter?: number
  nextChapter?: number
  meta: { author?: string | null }
}

export interface Item {
  site: SiteId
  kind: ItemKind
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  read_progress?: number
  last_chapter?: number
}

export interface Favorite {
  site: SiteId
  kind: ItemKind
  id: string
  favorited_at: number
}

export interface Tag {
  site: SiteId
  kind: ItemKind
  id: string
  tag: string
  created_at: number
}

export interface TagCount {
  tag: string
  count: number
}

export interface Bookmark {
  id: number
  site: SiteId
  kind: ItemKind
  item_id: string
  chapter?: number
  quote: string
  note: string
  scroll_progress: number
  created_at: number
}

export interface BookmarkDetail extends Bookmark {
  title?: string
}

export interface CharacterScope {
  type: "post" | "group" | "book"
  id: string
}

export interface CharacterCluster {
  id: number
  hue: number
  names: string[]
}

export interface CharacterMark {
  name: string
  hue: number
}

export interface Group {
  id: number
  key: string
  title: string
  author?: string
  genre?: string
  favorited: number
  favorited_at?: number
  created_at: number
  updated_at: number
  items?: GroupItem[]
}

export interface GroupItem {
  group_id: number
  tid: string
  title: string
  added_at: number
}

export type JobStatus = "pending" | "running" | "paused" | "finished" | "error"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload?: string
  result?: string
  error?: string
  started_at?: number
  finished_at?: number
  created_at: number
}

export interface JobLog {
  id: number
  job_id: number
  level: string
  message: string
  created_at: number
}

export interface ReadingSession {
  id: number
  site: SiteId
  kind: ItemKind
  item_id: string
  title: string
  started_at: number
  duration_s?: number
  estimated: number
}

export interface MergedSearchItem {
  site: SiteId
  kind: ItemKind
  link: ChapterLink
}

export interface MergedSearchPage {
  items: MergedSearchItem[]
  nextPage: number | null
  errors?: Record<string, string>
}

export interface CategoryLink {
  category: string
  title: string
  url: string
}

export interface HotPost {
  rank: number
  title: string
  tid: string
  views: number
}

export interface CmtRankPost {
  rank: number
  title: string
  tid: string
  author: string
  replies: number
}

export interface RecommendSection {
  title: string
  links: ChapterLink[]
}

export interface CategoryPage {
  category: string
  links: ChapterLink[]
  nextPage?: number | null
}
