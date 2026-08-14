import type { MergedSearchItem } from "@workspace/core"
import type { MeListItem } from "@/components/me-item-card"

export type SearchItem = Pick<MeListItem, "kind" | "site" | "id" | "title">

/** MergedSearchItem → groupMeListItems 入参形状（分组逻辑复用，不新写） */
export function toMeListItems(items: MergedSearchItem[]): SearchItem[] {
  return items.map((it) => ({
    kind: it.kind,
    site: it.site,
    id: it.link.tid,
    title: it.link.title,
  }))
}

/** React 渲染 key：跨站同 tid 不撞 */
export function mergeItemKey(item: { site: string; id: string }): string {
  return `${item.site}:${item.id}`
}
