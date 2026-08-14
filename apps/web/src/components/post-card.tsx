import { Link } from "react-router-dom"
import { type ReactNode } from "react"
import { IconChevronRight } from "@/components/icons"
import { avatarStyle, initials } from "@/lib/format"
import { cn } from "@workspace/ui/lib/utils"

const RANK_STYLE: Record<number, string> = {
  1: "bg-amber-400 text-black shadow-sm shadow-amber-400/30",
  2: "bg-zinc-300 text-black",
  3: "bg-orange-300 text-black",
}

export function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
        RANK_STYLE[rank] ?? "bg-muted text-muted-foreground"
      )}
    >
      {rank}
    </span>
  )
}

export function AvatarBadge({ seed, label }: { seed: string; label: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-inner"
      style={avatarStyle(seed)}
    >
      {initials(label)}
    </span>
  )
}

export function PostCard({
  href,
  title,
  subtitle,
  leading,
  trailing,
  className,
}: {
  href: string
  title: string
  subtitle?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <Link
      to={href}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border border-border/80 bg-card/80 px-3.5 py-3.5 shadow-sm transition-all duration-200 hover:border-border hover:bg-accent/50 active:scale-[0.99] sm:gap-3.5 sm:px-4 sm:py-4",
        className
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground group-hover:text-foreground">
          {title}
        </span>
        {subtitle != null && subtitle !== "" && (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>
      {trailing ?? (
        <IconChevronRight
          size={16}
          className="shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
        />
      )}
    </Link>
  )
}

export function PostList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:gap-2.5", className)}>
      {children}
    </div>
  )
}
