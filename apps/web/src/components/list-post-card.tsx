import { type ReactNode } from "react"
import { PostCard, RankBadge } from "@/components/post-card"
import {
  formatTitleMeta,
  parseListTitle,
  type ParsedTitle,
} from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

export function IndexBadge({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-xs font-semibold text-muted-foreground tabular-nums">
      {n}
    </span>
  )
}

export function GenrePill({ genre }: { genre: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
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
    <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
      <span className="font-semibold text-foreground/80">{value}</span>
      <span className="ml-0.5 text-muted-foreground">{unit}</span>
    </span>
  )
}

/**
 * 统一列表帖：解析标题 + 可选排名/序号/统计（题材并入副标题）
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
  trailing,
}: {
  href: string
  rawTitle: string
  rank?: number
  index?: number
  statValue?: number | string
  statUnit?: string
  /** 兼容保留：题材统一并入副标题行，不再渲染右侧胶囊 */
  showGenre?: boolean
  className?: string
  /** 右侧附加插槽（如搜索相似触发器），与统计/题材胶囊并存 */
  trailing?: ReactNode
}) {
  const parsed = parseListTitle(rawTitle)
  const subtitle = formatTitleMeta(parsed)

  let leading: ReactNode
  if (rank != null) leading = <RankBadge rank={rank} />
  else if (index != null) leading = <IndexBadge n={index} />

  let defaultTrailing: ReactNode
  if (statValue != null && statUnit) {
    defaultTrailing = <StatTrailing value={statValue} unit={statUnit} />
  }

  const combined = trailing ? (
    <span className="flex shrink-0 items-center gap-2">
      {defaultTrailing}
      {trailing}
    </span>
  ) : (
    defaultTrailing
  )

  return (
    <PostCard
      href={href}
      title={parsed.title}
      subtitle={subtitle || undefined}
      leading={leading}
      trailing={combined}
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
  return cn("mb-3 text-xs text-muted-foreground")
}
