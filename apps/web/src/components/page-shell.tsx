import { type ReactNode } from "react"
import { SiteHeader } from "@/components/site-header"
import { readingMaxWidthClass } from "@/components/reading-settings"
import { cn } from "@workspace/ui/lib/utils"

export function PageShell({
  children,
  showBack,
  className,
  maxWidth,
}: {
  children: ReactNode
  showBack?: boolean
  className?: string
  maxWidth?: "normal" | "wide"
}) {
  const widthClass = maxWidth
    ? readingMaxWidthClass(maxWidth)
    : "max-w-3xl"

  return (
    <div className="relative min-h-svh bg-background">
      {/* soft ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,oklch(0.7_0.08_260_/0.12),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.08_280_/0.18),transparent_70%)]"
      />
      <SiteHeader showBack={showBack} maxWidth={maxWidth} />
      <main
        className={cn(
          "relative mx-auto w-full px-3.5 py-5 sm:px-5 sm:py-8",
          widthClass,
          className
        )}
      >
        {children}
      </main>
    </div>
  )
}

export { Spinner, ErrorBox, EmptyState, AsyncBody } from "@/components/ui-state"
export { PageHeader } from "@/components/page-header"
export { Pager } from "@/components/pager"
