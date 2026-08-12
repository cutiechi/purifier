import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { colorSlot } from "@workspace/core/character-highlight"
import { cn } from "@workspace/ui/lib/utils"

const GAP = 8
const EDGE = 8

/**
 * 点击正文 mark 后的浮层：显示人名（+色点）与「取消标记」。
 * fixed 定位于 mark 矩形上方；Esc / 滚动 / 点空白关闭。
 */
export function CharacterMarkPopover({
  name,
  rect,
  colorIndex,
  onRemove,
  onClose,
}: {
  name: string
  rect: DOMRect
  /** 提供时渲染色点（color_index % 6 对应 .character-mark--N 色） */
  colorIndex?: number
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let top = rect.top - el.offsetHeight - GAP
    if (top < EDGE) top = rect.bottom + GAP
    top = Math.min(top, window.innerHeight - el.offsetHeight - EDGE)
    const left = Math.max(
      EDGE,
      Math.min(rect.left, window.innerWidth - el.offsetWidth - EDGE)
    )
    setPos({ top, left })
  }, [rect])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const onScroll = () => onClose()
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", onScroll, true)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", onScroll, true)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [onClose])

  if (!pos) return null

  return (
    <div
      ref={ref}
      className="fixed z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-md"
      style={{ top: pos.top, left: pos.left }}
    >
      {colorIndex !== undefined && (
        <span
          aria-hidden
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            `character-mark--${colorSlot(colorIndex)}`
          )}
          style={{ background: "var(--character-mark-bg)" }}
        />
      )}
      <span
        className="max-w-40 truncate text-sm font-medium text-foreground"
        title={name}
      >
        {name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-md px-2 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10"
      >
        取消标记
      </button>
    </div>
  )
}
