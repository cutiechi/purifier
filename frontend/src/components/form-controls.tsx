import { useEffect, type ReactNode } from "react"
import { IconSearch } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

/** 列表翻页 / 筛选变化时滚回顶部 */
export function useScrollTop(
  deps: unknown[],
  opts?: { behavior?: ScrollBehavior }
) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: opts?.behavior ?? "smooth" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** 统一全宽搜索表单，基于 shadcn Input 与 Button */
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
      className={cn("mb-3 flex items-center gap-2", className)}
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
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <Input
          name={name}
          type="search"
          value={value}
          defaultValue={defaultValue}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(showIcon && "pl-9")}
        />
      </div>
      <Button type="submit" variant="secondary" className="shrink-0">
        {buttonLabel}
      </Button>
    </form>
  )
}

/** 筛选 / 排序 tabs */
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
          <Button
            key={opt.value}
            type="button"
            title={opt.title}
            variant={
              active
                ? variant === "primary"
                  ? "default"
                  : "secondary"
                : "ghost"
            }
            size="sm"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-8 rounded-lg px-3 text-xs",
              !active && "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </Button>
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
    <Button
      type={type}
      variant={destructive ? "destructive" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </Button>
  )
}

export function ListMeta({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-xs text-muted-foreground tabular-nums">
      {children}
    </p>
  )
}
