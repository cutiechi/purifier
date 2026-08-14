import { SITES, type SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

/** 来源标签：论坛 = 中性，书库 = 强调（跨站合并列表用，如搜索页/人气页） */
export function SourceBadge({ site }: { site: SiteId }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        site === "2"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {SITES[site]?.label ?? site}
    </span>
  )
}
