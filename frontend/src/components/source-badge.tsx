import { SITES, type SiteId } from "@/lib/routes"
import { Badge } from "@/components/ui/badge"

/** 来源标签：论坛 = secondary，书库 = default（跨站合并列表用，如搜索页/人气页） */
export function SourceBadge({ site }: { site: SiteId }) {
  return (
    <Badge
      variant={site === "2" ? "default" : "secondary"}
      className="shrink-0 text-[11px] font-medium"
    >
      {SITES[site]?.label ?? site}
    </Badge>
  )
}
