import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

interface SegmentedOption<T> {
  value: T
  label: ReactNode
}

interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  "aria-label"?: string
}

export function SegmentedControl<T>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg bg-muted/60 p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex min-h-9 items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
