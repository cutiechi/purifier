import Link from "next/link"
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

export function AvatarBadge({
  seed,
  label,
}: {
  seed: string
  label: string
}) {
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
      href={href}
      className={cn(
        "border-border/80 bg-card/80 hover:border-border hover:bg-accent/50 group flex items-center gap-3 rounded-2xl border px-3.5 py-3.5 shadow-sm transition-all duration-200 active:scale-[0.99] sm:gap-3.5 sm:px-4 sm:py-4",
        className
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground group-hover:text-foreground line-clamp-2 text-[15px] leading-snug font-medium">
          {title}
        </span>
        {subtitle != null && subtitle !== "" && (
          <span className="text-muted-foreground text-xs">{subtitle}</span>
        )}
      </div>
      {trailing ?? (
        <IconChevronRight
          size={16}
          className="text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors"
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
