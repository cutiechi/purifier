import { useEffect, useRef } from "react"
import { api } from "@/lib/routes"

const WRITE_DEBOUNCE_MS = 1500

function computeProgress(): number | null {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return null // 内容不足一屏：不写入
  return Math.max(0, Math.min(1, window.scrollY / max))
}

export function useReadingProgress(
  kind: "post" | "book",
  id: string,
  opts: {
    ready: boolean
    stateReady: boolean
    restore: number | null | undefined
  }
) {
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgress = useRef<number | null>(null)
  const lastSent = useRef<number | null>(null)

  // 恢复滚动位置：内容与 state 都就绪后执行一次；按 id 重新挂载
  useEffect(() => {
    if (!opts.ready || !opts.stateReady) return
    if (typeof opts.restore !== "number" || opts.restore <= 0.05) return
    const target = opts.restore
    // 双 rAF：等 serif 字体与正文布局稳定后再定位
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max > 0) window.scrollTo(0, Math.round(target * max))
      })
    )
    return () => cancelAnimationFrame(raf2)
    // 依赖里只放能触发"重新恢复"的信号；ready/stateReady/id 变才重跑
  }, [opts.ready, opts.stateReady, opts.restore, id])

  // 写入：滚动时把采样值存进 ref，离开页面 flush 发送 ref（绝不实时重测 scrollY）。
  // 原因：章节导航的 scrollTo(0,0) 与路由切换会在旧页面的 effect cleanup 之前把
  // scrollY 归零；若 flush 实时重测，会把上一篇文章的进度覆盖成 0（review Must-fix）。
  useEffect(() => {
    if (!opts.ready) return
    // id 变化时（同组件实例复用）重置采样，避免串用上一篇的进度
    lastProgress.current = null
    lastSent.current = null

    const flush = async () => {
      const p = lastProgress.current
      if (p === null) return // 尚未采样过（例如内容刚就绪、用户未滚动）
      if (lastSent.current !== null && Math.abs(p - lastSent.current) < 0.01) {
        return
      }
      try {
        const res = await fetch(api.meProgress, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, id, progress: p }),
        })
        if (res.ok) lastSent.current = p
      } catch {
        // 写入失败静默：不影响阅读
      }
    }

    const onScroll = () => {
      const p = computeProgress()
      if (p !== null) lastProgress.current = p
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (writeTimer.current) clearTimeout(writeTimer.current)
      void flush()
    }
  }, [opts.ready, kind, id])
}
