import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"
  /** 面板展开方向：默认 "bottom"（向下），"top" 用于视口底部浮层 trigger */
  side?: "bottom" | "top"
  className?: string
  triggerAriaLabel: string
}

export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  className,
  triggerAriaLabel,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // 统一关闭：三路（外点 / Esc / toggle 关）共用，都回焦到 trigger。
  // 不能各自直接 setOpen(false) —— 外点路径会漏 focus（review Issue 1）。
  const close = () => {
    setOpen(false)
    // 下一帧回焦，避免与触发关闭的 click 同帧冲突
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  // 点外面关闭：wrapperRef contain 检测，面板内交互不冒泡关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  // Escape 关闭：若焦点在文本类可编辑元素上，留给该元素自己处理（如标签编辑态先取消编辑），
  // 不关层（review Issue 2 方案 1 —— 不依赖 stopPropagation 冒泡路径，更硬）。
  // 注意：range/checkbox/button 等 input 不算文本编辑，Esc 应正常关层（plan 复审 Issue 1）。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const editable =
        tag === "TEXTAREA" ||
        t?.isContentEditable === true ||
        (tag === "INPUT" &&
          !["range", "checkbox", "radio", "button", "submit", "reset", "file"].includes(
            (t as HTMLInputElement).type
          ))
      if (editable) return // 文本类可编辑元素的 Esc 由它自己处理
      close()
    }
    // 必须 bubble 阶段监听（默认），capture 会先于 input 触发导致拦不住
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={triggerAriaLabel}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          className={cn(
            "absolute z-50 min-w-[240px] max-h-[min(24rem,calc(100dvh-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg",
            side === "top" ? "bottom-full mb-1" : "top-full mt-1",
            align === "end" ? "right-0" : "left-0",
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
