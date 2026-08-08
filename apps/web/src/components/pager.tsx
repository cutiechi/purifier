import { type ReactNode } from "react"
import { IconChevronLeft, IconChevronRight } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

export function Pager({
  page,
  hasNext,
  onPrev,
  onNext,
  disabled,
  className,
  /** 有总数时展示「第 p / P 页」 */
  totalPages,
  total,
}: {
  page: number
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
  className?: string
  totalPages?: number
  total?: number
}) {
  const label =
    totalPages != null && totalPages > 0
      ? `第 ${page} / ${totalPages} 页`
      : `第 ${page} 页`
  const sub =
    total != null && total >= 0 ? (
      <span className="mt-0.5 block text-center text-xs text-muted-foreground/80 tabular-nums sm:mt-0 sm:inline sm:before:content-['·_']">
        共 {total} 条
      </span>
    ) : null

  return (
    <div
      className={cn("mt-8 flex items-center justify-between gap-3", className)}
    >
      <PagerButton
        onClick={onPrev}
        disabled={disabled || page <= 1}
        label="上一页"
        icon={<IconChevronLeft size={16} />}
      />
      <div className="min-w-0 px-1 text-center text-sm text-muted-foreground tabular-nums">
        <span className="block sm:inline">{label}</span>
        {sub}
      </div>
      <PagerButton
        onClick={onNext}
        disabled={
          disabled ||
          (totalPages != null ? page >= totalPages : !hasNext)
        }
        label="下一页"
        icon={<IconChevronRight size={16} />}
        iconRight
      />
    </div>
  )
}

function PagerButton({
  onClick,
  disabled,
  label,
  icon,
  iconRight,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  icon: ReactNode
  iconRight?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {!iconRight && icon}
      <span className="hidden sm:inline">{label}</span>
      {iconRight && icon}
    </button>
  )
}
