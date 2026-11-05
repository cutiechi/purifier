/**
 * 跨页面共享的最小类型集合。
 * 各领域自己的响应类型留在对应模块（如 ReplyNode 在 components/reply-list.tsx、
 * Group 在 lib/groups.ts、书签在 hooks/use-bookmarks.ts），此处不再重复定义。
 */

export interface ChapterLink {
  index: number
  title: string
  tid: string
}

export interface CharacterScope {
  type: "group" | "post" | "book"
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
