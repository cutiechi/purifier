import {
  normalizeTitleKey,
  pickHeaderMeta,
  stripTrailingChapterMarker,
} from "@/lib/book-groups"
import { parseListTitle } from "@/lib/title-parse"

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

/** 组 key 与折叠分组同源：normalizeTitleKey(parseListTitle(title).title) */
export function groupKeyFromTitle(rawTitle: string): string {
  return normalizeTitleKey(parseListTitle(rawTitle).title)
}

/** 展示书名：解析后 title 再剥尾随章节标记（与折叠组头一致） */
export function groupSearchTitle(rawTitle: string): string {
  const parsed = parseListTitle(rawTitle)
  return stripTrailingChapterMarker(parsed.title || rawTitle).trim()
}

/** 展示作者/题材：包一层复用 book-groups 的 pickHeaderMeta（组内首个非空） */
export function pickGroupMeta(members: { title: string }[]): {
  author: string | null
  genre: string | null
} {
  return pickHeaderMeta(members, (m) => m.title)
}

/** tid 比较：全数字按数值升序，否则字符串序（搜索结果与组内成员展示共用） */
export function compareTid(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}
