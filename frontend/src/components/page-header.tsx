import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const SITE_TITLE = "Purifier"

/** 页面级标题：每页写入 document.title，便于历史记录与多标签辨识 */
export function useDocumentTitle(title: ReactNode) {
  useEffect(() => {
    const text = typeof title === "string" ? title : ""
    document.title = text ? `${text} · ${SITE_TITLE}` : SITE_TITLE
  }, [title])
}

export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  useDocumentTitle(title)
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-2 sm:mb-8 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]">
          {title}
        </h1>
        {description != null && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-[15px]">
        {children}
      </h2>
      {action}
    </div>
  )
}
