import { type ReactNode, useId, useState } from "react"
import { IconBookOpen, IconChevronDown, IconSearch } from "@/components/icons"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { type GroupMember } from "@/lib/groups"
import { cn } from "@workspace/ui/lib/utils"

export function CollapsibleBookGroup({
  title,
  summary,
  count,
  bookKey,
  isExpanded,
  onToggle,
  trailing,
  similar,
  children,
}: {
  title: string
  summary?: string
  count: number
  bookKey: string
  isExpanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  similar?: {
    title: string
    groupKey: string
    seedItems: GroupMember[]
    onChanged?: () => void
  }
  children: ReactNode
}) {
  const contentId = `book-content-${useId()}`
  void bookKey
  const [showSimilar, setShowSimilar] = useState(false)
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
            isExpanded && "rotate-180"
          )}
        />
      </button>
      {similar && (
        <button
          type="button"
          onClick={() => {
            if (!isExpanded) {
              onToggle()
              setShowSimilar(true)
            } else {
              setShowSimilar((v) => !v)
            }
          }}
          aria-expanded={showSimilar}
          className="flex items-center gap-1.5 border-t border-border/60 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-4"
        >
          <IconSearch size={13} />
          搜索相似
        </button>
      )}
      {isExpanded && (
        <div
          id={contentId}
          role="region"
          aria-label={title}
          className="flex flex-col gap-2 px-3.5 pb-3.5 transition-opacity duration-150 sm:gap-2.5 sm:px-4 sm:pb-4"
        >
          {children}
          {similar && showSimilar && (
            <SimilarSearchPanel
              title={similar.title}
              groupKey={similar.groupKey}
              seedItems={similar.seedItems}
              onChanged={similar.onChanged}
              showTrigger={false}
            />
          )}
        </div>
      )}
    </div>
  )
}
