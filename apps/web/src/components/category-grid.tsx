import { Link } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"

export type CategoryKind = "type" | "column" | "other"

export interface CategoryItem {
  label: string
  url: string
  kind: CategoryKind
}

export function CategoryGrid({ items }: { items: CategoryItem[] }) {
  if (!items.length) return null

  const columns = items.filter((i) => i.kind === "column")
  const types = items.filter((i) => i.kind === "type")
  const others = items.filter((i) => i.kind === "other")

  return (
    <div className="flex flex-col gap-8">
      {columns.length > 0 && (
        <section className="flex flex-col gap-2.5">
          {columns.map((item) => (
            <Link
              key={item.url + item.label}
              to={item.url}
              className={cn(
                "border-border/80 bg-card hover:border-border hover:bg-accent/40",
                "group flex items-center justify-between gap-3 rounded-2xl border px-4 py-4 shadow-sm transition-all active:scale-[0.99]",
                "sm:px-5 sm:py-4.5"
              )}
            >
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
                  {item.label}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">栏目精选</p>
              </div>
              <span className="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">
                →
              </span>
            </Link>
          ))}
        </section>
      )}

      {types.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">
            题材
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2.5 md:grid-cols-4">
            {types.map((item) => (
              <Link
                key={item.url + item.label}
                to={item.url}
                className={cn(
                  "border-border/70 bg-card/90 hover:border-border hover:bg-accent/50",
                  "flex h-11 items-center justify-center rounded-xl border px-2 text-center",
                  "text-[13px] font-medium text-foreground transition-all active:scale-[0.98] sm:h-12 sm:text-sm"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">
            其它
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2.5">
            {others.map((item) => (
              <Link
                key={item.url + item.label}
                to={item.url}
                className={cn(
                  "border-border/70 bg-card/90 hover:border-border hover:bg-accent/50",
                  "flex h-11 items-center justify-center rounded-xl border px-2 text-center",
                  "text-[13px] font-medium text-foreground transition-all active:scale-[0.98] sm:h-12 sm:text-sm"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
