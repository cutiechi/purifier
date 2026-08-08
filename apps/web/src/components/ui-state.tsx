import { type ReactNode } from "react"
import { IconSpinner } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center py-16", className)}
      role="status"
      aria-label="加载中"
    >
      <IconSpinner size={22} />
    </div>
  )
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="mb-5 rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3.5 text-sm text-destructive sm:px-5 sm:py-4">
      <p className="leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-destructive/12 px-3.5 py-2 text-sm font-medium transition-colors hover:bg-destructive/20"
        >
          重试
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-16 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

/** 统一列表异步三态 */
export function AsyncBody({
  loading,
  error,
  empty,
  onRetry,
  emptyText = "暂无内容",
  children,
}: {
  loading: boolean
  error: string
  empty: boolean
  onRetry?: () => void
  emptyText?: ReactNode
  children: ReactNode
}) {
  if (loading) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={onRetry} />
  if (empty) return <EmptyState>{emptyText}</EmptyState>
  return <>{children}</>
}
