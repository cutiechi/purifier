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

export type JobStatus =
  "pending" | "running" | "succeeded" | "failed" | "interrupted" | "aborted"

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
