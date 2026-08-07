import { type ReactNode, useId } from "react"
import { IconBookOpen, IconChevronDown } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

export function CollapsibleBookGroup({
  title,
  summary,
  count,
  bookKey,
  isExpanded,
  onToggle,
  trailing,
  children,
}: {
  title: string
  summary?: string
  count: number
  bookKey: string
  isExpanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  children: ReactNode
}) {
  // bookKey 用于稳定 contentId 前缀（a11y 关联），useId 保证唯一性
  const contentId = `book-content-${useId()}`
  void bookKey // 父级用作 React key；此处保留以便未来扩展（如稳定 id）
  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left sm:gap-3.5 sm:px-4 sm:py-4"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconBookOpen size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
            {title}
          </span>
          {summary && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        {trailing}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          共 {count} 章
        </span>
        <IconChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground/50 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
        />
      </button>
      {isExpanded && (
        <div
          id={contentId}
          role="region"
          className="flex flex-col gap-2 px-3.5 pb-3.5 opacity-100 transition-opacity duration-150 sm:gap-2.5 sm:px-4 sm:pb-4"
        >
          {children}
        </div>
      )}
    </div>
  )
}
