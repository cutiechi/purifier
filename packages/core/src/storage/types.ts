export type ItemKind = "post" | "book"

/** 列表项：历史/收藏/按标签筛选共用结构 */
export interface ListItem {
  kind: ItemKind
  id: string
  title: string
  url: string
  last_visited_at?: number // 历史/按标签筛选返回
  favorited_at?: number // 收藏列表返回
  visit_count: number
  favorited: boolean
  tags: string[]
}

export interface ListResult {
  items: ListItem[]
  nextPage?: number
}

/** 单对象状态（/api/me/state 返回） */
export interface ItemState {
  kind: ItemKind
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

export interface ListQuery {
  q?: string
  kind?: ItemKind | ""
  page?: number
}

export interface TagCount {
  tag: string
  count: number
}

export const PAGE_SIZE = 20
