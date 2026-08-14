import { Link } from "react-router-dom"
import { IconChevronLeft, IconChevronRight } from "@/components/icons"
import { readPath, type SiteId } from "@/lib/routes"
import { type ChapterLinkLike } from "@/lib/chapter-nav"

/**
 * 论坛阅读底栏：上一章/下一章。右端留白避让 ItemActions FAB（fixed right-4 z-50）。
 * z-40：盖正文、低于 FAB；进度条经 bottomOffset 抬升到本底栏之上。
 */
export function ChapterNavBar({
  prev,
  next,
  site,
}: {
  prev?: ChapterLinkLike
  next?: ChapterLinkLike
  site: SiteId
}) {
  if (!prev && !next) return null
  return (
    <nav
      aria-label="章节导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-2 pr-12 pl-3 sm:pr-14 sm:pl-5">
        {prev ? (
          <Link
            to={readPath(prev.tid, site)}
            className="inline-flex min-h-10 min-w-0 flex-1 items-center gap-1 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconChevronLeft size={16} />
            <span className="line-clamp-1">{prev.title}</span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <Link
            to={readPath(next.tid, site)}
            className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="line-clamp-1">{next.title}</span>
            <IconChevronRight size={16} />
          </Link>
        ) : (
          <span className="flex-1" />
        )}
      </div>
    </nav>
  )
}
