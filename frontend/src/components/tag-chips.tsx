import { Link } from "react-router-dom"
import { IconClose } from "@/components/icons"
import { tagsPath } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export function TagChips({
  tags,
  className,
  onRemove,
  removing,
}: {
  tags: string[]
  className?: string
  /** 提供时每个 chip 显示 ×，用于从当前对象移除标签 */
  onRemove?: (tag: string) => void
  /** 正在删除中的标签，禁用重复点击 */
  removing?: string | null
}) {
  if (!tags.length) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="max-w-full gap-0.5 px-1.5 py-0.5 text-[11px] font-normal"
        >
          <Link
            to={tagsPath({ tag })}
            className="inline-flex min-h-7 max-w-[12rem] items-center truncate transition-colors hover:text-foreground sm:min-h-0"
            title={tag}
          >
            #{tag}
          </Link>
          {onRemove ? (
            <button
              type="button"
              disabled={removing === tag}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove(tag)
              }}
              aria-label={`删除标签 ${tag}`}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
            >
              <IconClose className="size-3" />
            </button>
          ) : null}
        </Badge>
      ))}
    </span>
  )
}
