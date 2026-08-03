import { type ReactNode } from "react"
import { SiteHeader } from "@/components/site-header"
import { cn } from "@workspace/ui/lib/utils"

export function PageShell({
  children,
  showBack,
  className,
  wide,
}: {
  children: ReactNode
  showBack?: boolean
  className?: string
  /** 阅读页略窄，列表页默认 */
  wide?: boolean
}) {
  return (
    <div className="bg-background relative min-h-svh">
      {/* soft ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,oklch(0.7_0.08_260_/0.12),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.08_280_/0.18),transparent_70%)]"
      />
      <SiteHeader showBack={showBack} />
      <main
        className={cn(
          "relative mx-auto w-full px-3.5 py-5 sm:px-5 sm:py-8",
          wide ? "max-w-4xl" : "max-w-3xl",
          className
        )}
      >
        {children}
      </main>
    </div>
  )
}

export {
  Spinner,
  ErrorBox,
  EmptyState,
  AsyncBody,
} from "@/components/ui-state"
export { PageHeader } from "@/components/page-header"
export { Pager } from "@/components/pager"
