import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

export type SectionTab = {
  to: string
  label: string
  active: boolean
}

/** 页内功能分段（发现/我的 等），基于 shadcn 风格 tabs 容器 */
export function SectionTabs({
  items,
  className,
}: {
  items: SectionTab[]
  className?: string
}) {
  if (items.length <= 1) {
    const only = items[0]
    if (!only) return null
    return (
      <div className={cn("mb-4", className)}>
        <span className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
          {only.label}
        </span>
      </div>
    )
  }
  return (
    <div
      className={cn(
        "mb-4 inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      role="tablist"
    >
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          role="tab"
          aria-selected={it.active}
          className={cn(
            "inline-flex items-center justify-center rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap ring-offset-background transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            it.active
              ? "bg-background text-foreground shadow"
              : "hover:bg-background/50 hover:text-foreground"
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  )
}
