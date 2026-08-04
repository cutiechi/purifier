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
          className="bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-1.5 py-0.5 text-[11px] leading-4 transition-colors"
        >
          #{tag}
        </Link>
      ))}
    </span>
  )
}
