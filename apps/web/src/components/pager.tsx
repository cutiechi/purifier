import { type ReactNode, useState } from "react"
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
  onPage,
}: {
  page: number
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
  className?: string
  totalPages?: number
  total?: number
  onPage?: (page: number) => void
}) {
  const [jump, setJump] = useState("")

  const submitJump = () => {
    if (totalPages == null || !onPage) return
    const n = parseInt(jump, 10)
    if (!Number.isFinite(n)) return
    onPage(Math.min(Math.max(n, 1), totalPages))
    setJump("")
  }
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
        {totalPages != null && totalPages > 1 && onPage && (
          <span className="mt-1 block sm:mt-0 sm:ml-2 sm:inline-flex sm:items-center sm:gap-1">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitJump()
                }
              }}
              aria-label="跳转到页码"
              className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-xs tabular-nums"
            />
            <button
              type="button"
              onClick={submitJump}
              className="inline-flex min-h-7 items-center rounded-md bg-accent px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent/70"
            >
              跳转
            </button>
          </span>
        )}
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
