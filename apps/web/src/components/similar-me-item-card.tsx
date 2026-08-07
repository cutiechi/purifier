import { type ReactNode } from "react"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  type GroupMember,
} from "@/lib/groups"

export function SimilarMeItemCard({
  item,
  trailing,
}: {
  item: MeListItem
  trailing?: ReactNode
}): ReactNode {
  const groupKey = groupKeyFromTitle(item.title)
  if (item.kind !== "post" || item.site !== "1" || !groupKey) {
    return <MeItemCard item={item} trailing={trailing} />
  }
  const seed: GroupMember = { tid: item.id, title: item.title }
  return (
    <div className="flex flex-col gap-1.5">
      <MeItemCard item={item} trailing={trailing} />
      <SimilarSearchPanel
        title={groupSearchTitle(item.title)}
        groupKey={groupKey}
        seedItems={[seed]}
      />
    </div>
  )
}
