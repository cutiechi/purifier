import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { cn } from "@workspace/ui/lib/utils"

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作：确认按钮用 destructive 样式 */
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * 站内确认对话框。用法：
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: "删除？", destructive: true }))) return
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) {
    // Provider 外降级系统 confirm，避免测试/异常路径崩溃
    return async (opts) => {
      const msg = opts.description
        ? `${opts.title}\n\n${opts.description}`
        : opts.title
      return window.confirm(msg)
    }
  }
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descId = useId()

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // 若上一次未决：先 false 关闭，避免 Promise 悬挂
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setOpts(next)
    })
  }, [])

  const finish = useCallback((value: boolean) => {
    const r = resolveRef.current
    resolveRef.current = null
    setOpts(null)
    r?.(value)
  }, [])

  useEffect(() => {
    if (!opts) return
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [opts])

  useEffect(() => {
    if (!opts) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        finish(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [opts, finish])

  // 打开时锁 body 滚动
  useEffect(() => {
    if (!opts) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [opts])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="presentation"
        >
          <button
            type="button"
            aria-label="关闭对话框"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => finish(false)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={opts.description ? descId : undefined}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
          >
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-foreground"
            >
              {opts.title}
            </h2>
            {opts.description && (
              <p
                id={descId}
                className="mt-2 text-sm leading-relaxed text-muted-foreground"
              >
                {opts.description}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => finish(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                {opts.cancelLabel ?? "取消"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => finish(true)}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors",
                  opts.destructive
                    ? "bg-destructive text-white hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {opts.confirmLabel ?? "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
