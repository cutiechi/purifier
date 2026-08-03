import { type ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

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
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-2 sm:mb-8 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          {title}
        </h1>
        {description != null && (
          <p className="text-muted-foreground text-sm">{description}</p>
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
      <h2 className="text-foreground text-sm font-semibold tracking-tight sm:text-[15px]">
        {children}
      </h2>
      {action}
    </div>
  )
}
