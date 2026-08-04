import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  IconBookOpen,
  IconChevronRight,
  IconFileText,
} from "@/components/icons"
import { TagChips } from "@/components/tag-chips"
import { formatDateTime } from "@/lib/format"
import { bookPath, readPath } from "@/lib/routes"

export interface MeListItem {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  last_visited_at?: number
  favorited_at?: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

export function MeItemCard({
  item,
  trailing,
}: {
  item: MeListItem
  trailing?: ReactNode
}) {
  const href = item.kind === "post" ? readPath(item.id) : bookPath(item.id)
  const time = item.last_visited_at ?? item.favorited_at
  return (
    <div className="group flex flex-col rounded-2xl border border-border/80 bg-card/80 px-3.5 py-3.5 shadow-sm transition-all duration-200 hover:border-border sm:px-4 sm:py-4">
      <div className="flex items-center gap-3 sm:gap-3.5">
        <Link
          to={href}
          className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {item.kind === "post" ? (
              <IconFileText size={15} />
            ) : (
              <IconBookOpen size={15} />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {item.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {time != null && <>{formatDateTime(time)} · </>}
              {item.visit_count} 次访问
            </span>
          </span>
          <IconChevronRight
            size={16}
            className="shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
          />
        </Link>
        {trailing}
      </div>
      <div className="mt-1.5 pl-11 sm:pl-[3.25rem]">
        <TagChips tags={item.tags} />
      </div>
    </div>
  )
}
