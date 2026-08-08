import { useEffect, type ReactNode } from "react"
import { IconSearch } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/** 列表翻页 / 筛选变化时滚回顶部 */
export function useScrollTop(
  deps: unknown[],
  opts?: { behavior?: ScrollBehavior }
) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: opts?.behavior ?? "smooth" })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional dep array
  }, deps)
}

/** 统一全宽搜索表单 */
export function SearchForm({
  value,
  defaultValue,
  onChange,
  onSubmit,
  placeholder = "搜索…",
  buttonLabel = "搜索",
  name = "q",
  maxLength,
  className,
  showIcon = false,
}: {
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
  onSubmit: (q: string) => void
  placeholder?: string
  buttonLabel?: string
  name?: string
  maxLength?: number
  className?: string
  showIcon?: boolean
}) {
  return (
    <form
      className={cn("mb-3 flex gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const raw = fd.get(name)
        const q = typeof raw === "string" ? raw.trim() : ""
        onSubmit(q)
      }}
    >
      <div className="relative min-w-0 flex-1">
        {showIcon && (
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <input
          name={name}
          type="search"
          value={value}
          defaultValue={defaultValue}
          onChange={
            onChange ? (e) => onChange(e.target.value) : undefined
          }
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(
            "h-11 w-full rounded-xl border border-border bg-card text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60",
            showIcon ? "pr-3.5 pl-10" : "px-3.5"
          )}
        />
      </div>
      <button
        type="submit"
        className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent/80"
      >
        {buttonLabel}
      </button>
    </form>
  )
}

/** 筛选 / 排序 chips */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  className,
  variant = "accent",
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
  /** accent：浅色选中；primary：深色选中（排序等） */
  variant?: "accent" | "primary"
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-1.5", className)}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              "min-h-9 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors sm:min-h-0 sm:px-3",
              active
                ? variant === "primary"
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent/70"
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function SoftButton({
  children,
  onClick,
  disabled,
  destructive,
  className,
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  destructive?: boolean
  className?: string
  type?: "button" | "submit"
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        destructive
          ? "text-muted-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

export function ListMeta({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-xs text-muted-foreground tabular-nums">{children}</p>
  )
}
