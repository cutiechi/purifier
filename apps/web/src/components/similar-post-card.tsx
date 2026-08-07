import { type ReactNode } from "react"
import { ListPostCard } from "@/components/list-post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  type GroupMember,
} from "@/lib/groups"
import type { SiteId } from "@/lib/routes"

export function SimilarPostCard({
  href,
  rawTitle,
  tid,
  site,
  rank,
  index,
  statValue,
  statUnit,
  showGenre,
  className,
}: {
  href: string
  rawTitle: string
  tid: string
  site: SiteId
  rank?: number
  index?: number
  statValue?: number | string
  statUnit?: string
  showGenre?: boolean
  className?: string
}): ReactNode {
  const groupKey = groupKeyFromTitle(rawTitle)
  if (site !== "1" || !groupKey) {
    return (
      <ListPostCard
        href={href}
        rawTitle={rawTitle}
        rank={rank}
        index={index}
        statValue={statValue}
        statUnit={statUnit}
        showGenre={showGenre}
        className={className}
      />
    )
  }
  const seed: GroupMember = { tid, title: rawTitle }
  return (
    <div className="flex flex-col gap-1.5">
      <ListPostCard
        href={href}
        rawTitle={rawTitle}
        rank={rank}
        index={index}
        statValue={statValue}
        statUnit={statUnit}
        showGenre={showGenre}
        className={className}
      />
      <SimilarSearchPanel
        title={groupSearchTitle(rawTitle)}
        groupKey={groupKey}
        seedItems={[seed]}
      />
    </div>
  )
}
