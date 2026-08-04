import { type ReactNode } from "react"
import {
  PostCard,
  RankBadge,
} from "@/components/post-card"
import {
  formatTitleMeta,
  parseListTitle,
  type ParsedTitle,
} from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

export function IndexBadge({ n }: { n: number }) {
  return (
    <span className="text-muted-foreground bg-muted/80 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums">
      {n}
    </span>
  )
}

export function GenrePill({ genre }: { genre: string }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide">
      {genre}
    </span>
  )
}

export function StatTrailing({
  value,
  unit,
}: {
  value: number | string
  unit: string
}) {
  return (
    <span className="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
      <span className="text-foreground/80 font-semibold">{value}</span>
      <span className="text-muted-foreground ml-0.5">{unit}</span>
    </span>
  )
}

/**
 * 统一列表帖：解析标题 + 可选排名/序号/统计/题材胶囊
 */
export function ListPostCard({
  href,
  rawTitle,
  rank,
  index,
  statValue,
  statUnit,
  showGenre = true,
  className,
}: {
  href: string
  rawTitle: string
  rank?: number
  index?: number
  statValue?: number | string
  statUnit?: string
  /** 是否把题材放到右侧胶囊（默认 true，有统计时题材进副标题） */
  showGenre?: boolean
  className?: string
}) {
  const parsed = parseListTitle(rawTitle)
  const genreAsPill = showGenre && !!parsed.genre && statValue == null
  const subtitle = formatTitleMeta(
    genreAsPill ? { ...parsed, genre: null } : parsed
  )

  let leading: ReactNode
  if (rank != null) leading = <RankBadge rank={rank} />
  else if (index != null) leading = <IndexBadge n={index} />

  let trailing: ReactNode
  if (statValue != null && statUnit) {
    trailing = <StatTrailing value={statValue} unit={statUnit} />
  } else if (genreAsPill && parsed.genre) {
    trailing = <GenrePill genre={parsed.genre} />
  }

  return (
    <PostCard
      href={href}
      title={parsed.title}
      subtitle={subtitle || undefined}
      leading={leading}
      trailing={trailing}
      className={className}
    />
  )
}

export function useParsedTitle(raw: string): ParsedTitle {
  return parseListTitle(raw)
}

export function pageCountLabel(
  count: number,
  unit: string,
  extra?: string
): string {
  const base = `共 ${count} ${unit}`
  return extra ? `${base} · ${extra}` : base
}

export function listMetaClassName() {
  return cn("text-muted-foreground mb-3 text-xs")
}
