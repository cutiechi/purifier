import type { CSSProperties } from "react"
import { clampHue } from "@workspace/core/character-highlight"
import { cn } from "@workspace/ui/lib/utils"

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
      className={cn("character-swatch size-2.5 shrink-0 rounded-full", className)}
      style={{ ["--character-mark-h"]: String(clampHue(hue)) } as CSSProperties}
    />
  )
}
