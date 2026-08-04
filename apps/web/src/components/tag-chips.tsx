import { Link } from "react-router-dom"
import { tagsPath } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export function TagChips({
  tags,
  className,
}: {
  tags: string[]
  className?: string
}) {
  if (!tags.length) return null
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <Link
          key={tag}
          to={tagsPath({ tag })}
          className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          #{tag}
        </Link>
      ))}
    </span>
  )
}
