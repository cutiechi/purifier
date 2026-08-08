import { Link } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"

export type SectionTab = {
  to: string
  label: string
  active: boolean
}

/** 页内功能分段（发现/我的 等），与站点 Tab 区分开 */
export function SectionTabs({
  items,
  className,
}: {
  items: SectionTab[]
  className?: string
}) {
  if (items.length <= 1) {
    // 仅一项时仍显示，避免「找不到当前栏目」
    const only = items[0]
    if (!only) return null
    return (
      <div className={cn("mb-4", className)}>
        <span className="inline-flex min-h-9 items-center rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">
          {only.label}
        </span>
      </div>
    )
  }
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap gap-1.5 rounded-xl bg-muted/40 p-1",
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
            "inline-flex min-h-9 items-center rounded-lg px-3.5 text-[13px] font-medium transition-colors",
            it.active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  )
}
