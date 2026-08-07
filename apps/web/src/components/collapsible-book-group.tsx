import { type ReactNode, useId, useState } from "react"
import { IconBookOpen, IconChevronDown } from "@/components/icons"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { SimilarTrigger } from "@/components/similar-trigger"
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
      <div className="flex items-center gap-1.5 px-3.5 pt-3.5 sm:px-4 sm:pt-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-3 pb-3.5 text-left sm:gap-3.5 sm:pb-4"
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
          <SimilarTrigger
            open={showSimilar}
            onToggle={() => {
              if (!isExpanded) {
                onToggle()
                setShowSimilar(true)
              } else {
                setShowSimilar((v) => !v)
              }
            }}
          />
        )}
      </div>
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
            />
          )}
        </div>
      )}
    </div>
  )
}
