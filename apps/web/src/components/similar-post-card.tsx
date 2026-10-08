import { type ReactNode, useState } from "react"
import { ListPostCard } from "@/components/list-post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { SimilarTrigger } from "@/components/similar-trigger"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  type GroupMember,
} from "@/lib/groups"
import type { SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

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
  badge,
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
  badge?: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
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
        trailing={badge}
      />
    )
  }
  const seed: GroupMember = { tid, title: rawTitle }
  return (
    <div className="flex flex-col gap-1.5">
      {/* 触发器渲染在卡片 (Link) 之外：button 嵌套在 a 内是非法 HTML */}
      <div className="flex items-center gap-2">
        <ListPostCard
          href={href}
          rawTitle={rawTitle}
          rank={rank}
          index={index}
          statValue={statValue}
          statUnit={statUnit}
          showGenre={showGenre}
          className={cn("min-w-0 flex-1", className)}
          trailing={badge}
        />
        <SimilarTrigger open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      {open && (
        <SimilarSearchPanel
          title={groupSearchTitle(rawTitle)}
          groupKey={groupKey}
          seedItems={[seed]}
        />
      )}
    </div>
  )
}
