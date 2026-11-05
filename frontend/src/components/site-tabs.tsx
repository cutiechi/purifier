import { Link } from "react-router-dom"
import { SITES, type SiteId, type SiteTabTargets } from "@/lib/routes"
import { cn } from "@/lib/utils"

/**
 * 页内二级「论坛 / 书库」切换：一级页给出两源的对应落地路径，
 * 缺失的源不渲染该项（如书库无精华/扫文/评论/分组）。
 */
export function SiteTabs({
  site,
  targets,
  className,
}: {
  site: SiteId
  targets: SiteTabTargets
  className?: string
}) {
  const entries = (["1", "2"] as SiteId[]).filter((s) => targets[s])
  if (entries.length === 0) return null
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-xl bg-muted/60 p-0.5 text-xs font-medium",
        className
      )}
      role="tablist"
      aria-label="内容源"
    >
      {entries.map((s) => (
        <Link
          key={s}
          to={targets[s]!}
          role="tab"
          aria-selected={s === site}
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 transition-all select-none",
            s === site
              ? "bg-background font-semibold text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {SITES[s].label}
        </Link>
      ))}
    </div>
  )
}
