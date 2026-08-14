import type { SiteId } from "../extractor"

export type ItemKind = "post" | "book"

/** 列表项：历史/收藏/按标签筛选共用结构 */
export interface ListItem {
  site: SiteId
  kind: ItemKind
  id: string
  title: string
  url: string
  last_visited_at?: number // 历史/按标签筛选返回
  favorited_at?: number // 收藏列表返回
  visit_count: number
  favorited: boolean
  tags: string[]
  read_progress?: number | null
  lastChapter?: number | null
}

export interface ListResult {
  items: ListItem[]
  nextPage?: number
  /** 满足当前筛选的总条数（用于页码/总数展示） */
  total: number
}

/** 单对象状态（/api/me/state 返回） */
export interface ItemState {
  site: SiteId
  kind: ItemKind
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
  read_progress: number | null
  lastChapter: number | null
}

export interface ListQuery {
  site?: SiteId
  q?: string
  kind?: ItemKind | ""
  page?: number
}

export interface TagCount {
  tag: string
  count: number
}

export const PAGE_SIZE = 20

export interface GroupMember {
  tid: string
  title: string
}

export interface Group {
  id: number
  key: string
  title: string
  author: string | null
  genre: string | null
  favorited: boolean
  favorited_at: number | null
  created_at: number
  updated_at: number
  items: GroupMember[]
}

/** 分组列表查询（分页 / 筛选 / 排序） */
export type GroupSort = "updated" | "title" | "chapters"

export interface GroupListQuery {
  q?: string
  page?: number
  /** 默认 PAGE_SIZE，上限 100 */
  limit?: number
  /** true 只返回已收藏 */
  favorited?: boolean
  sort?: GroupSort
}

export interface GroupListResult {
  items: Group[]
  nextPage?: number
  total: number
}

export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload: string | null
  result: string | null
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

export type JobLogLevel = "info" | "warn" | "error"

export interface JobLog {
  id: number
  job_id: number
  level: JobLogLevel
  message: string
  created_at: number
}

export interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
}

export interface Bookmark {
  id: number
  site: SiteId
  kind: ItemKind
  itemId: string
  title: string
  chapter: number | null
  quote: string
  note: string
  scrollProgress: number
  createdAt: number
}

export type AddBookmarkResult =
  | { ok: true; bookmark: Bookmark }
  | { ok: false; reason: "not_found" | "full" | "invalid_quote" }

/** 全站归档游标：续跑 / 状态展示 */
export type ArchiveCursorStatus = "idle" | "running" | "interrupted" | "done"

export interface ArchiveCursor {
  site: string
  /** 下一页抓取游标；done 时为 null */
  next_mtid: string | null
  mode: string
  status: ArchiveCursorStatus
  pages: number
  updated_at: number
}

export type CharacterScopeType = "group" | "post" | "book"

export interface CharacterScope {
  type: CharacterScopeType
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

export interface ReadingSessionInput {
  site: SiteId
  kind: ItemKind
  itemId: string
  title: string
  startedAt: number
  durationS: number
}

export interface StatsSummary {
  totalDurationS: number
  currentStreak: number
  longestStreak: number
  activeDays: number
  thisWeekS: number
  thisMonthS: number
  trackedSince: number | null
  lastActiveAt: number | null
}

export interface StatsCalendarDay {
  date: string
  durationS: number
  estimated: number
}

export interface StatsTopItem {
  kind: ItemKind
  site: SiteId
  id: string
  title: string
  durationS: number
  sessions: number
}

export interface StatsRecentSession {
  startedAt: number
  durationS: number
  kind: ItemKind
  site: SiteId
  id: string
  title: string
}

export interface StatsInventory {
  history: number
  favorites: number
  tags: number
  groups: number
  characters: number
  bookmarks: number
}

export interface StatsResult {
  summary: StatsSummary
  calendar: StatsCalendarDay[]
  timeOfDay: number[]
  topItems: StatsTopItem[]
  recentSessions: StatsRecentSession[]
  inventory: StatsInventory
}
