import type { CSSProperties } from "react"
import { clampHue } from "@/lib/character-highlight"
import { cn } from "@/lib/utils"

export function CharacterSwatch({
  hue,
  className,
}: {
  hue: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "character-swatch size-2.5 shrink-0 rounded-full",
        className
      )}
      style={{ ["--character-mark-h"]: String(clampHue(hue)) } as CSSProperties}
    />
  )
}
