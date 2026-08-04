import { Link } from "react-router-dom"
import { IconClose } from "@/components/icons"
import { tagsPath } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

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
        <span
          key={tag}
          className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-muted/70 text-[11px] leading-4 text-muted-foreground"
        >
          <Link
            to={tagsPath({ tag })}
            className="inline-flex min-h-7 max-w-[12rem] items-center truncate px-2 py-1 transition-colors hover:bg-accent hover:text-foreground sm:min-h-0 sm:px-1.5 sm:py-0.5"
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
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50 sm:size-5"
            >
              <IconClose size={11} />
            </button>
          ) : null}
        </span>
      ))}
    </span>
  )
}
