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
    <div className="border-destructive/25 bg-destructive/8 text-destructive mb-5 rounded-2xl border px-4 py-3.5 text-sm sm:px-5 sm:py-4">
      <p className="leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="bg-destructive/12 hover:bg-destructive/20 mt-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          重试
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16 text-center text-sm">
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
