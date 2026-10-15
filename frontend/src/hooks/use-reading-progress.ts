import { useEffect, useRef, useState } from "react"
import { api, type SiteId } from "@/lib/routes"

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
    chapter?: string
    restoreChapter?: number | null
    site?: SiteId
  }
) {
  const { chapter, restoreChapter, site } = opts
  const [progress, setProgress] = useState(0)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgress = useRef<number | null>(null)
  const lastSent = useRef<number | null>(null)
  // 恢复决策：每篇文章只决策一次。restore 值会随 reload 刷新而变（flush 落库后
  // 从旧值变为新值），若据此重跑会把读者从当前位置拉回上次落库位置（review Important）。
  const restoreTarget = useRef<number | null | undefined>(undefined)
  const restoreId = useRef<string | null>(null)

  // 恢复滚动位置：内容与 state 都就绪后决策一次；按 书+章 重新挂载。
  // restoreKey 含 chapter（review I4）：同 cid 从 ch1→ch2 时 id 不变，若不含
  // chapter，restoreTarget 已被 ch1 决策填满、早退在章号判断之前、换章不重算。
  const restoreKey = `${id}:${chapter ?? ""}`
  useEffect(() => {
    if (restoreId.current !== restoreKey) {
      restoreId.current = restoreKey
      restoreTarget.current = undefined // 新章/新书：未决策
    }
    if (!opts.ready || !opts.stateReady) return
    // 章号门控：仅当当前章号 === 上次记录章号才恢复（review I4）。
    // cool18（chapter undefined）跳过门控，按原逻辑。
    if (chapter !== undefined) {
      const matches =
        restoreChapter !== null &&
        restoreChapter !== undefined &&
        Number(chapter) === restoreChapter
      if (!matches) {
        restoreTarget.current = null
        return
      }
    }
    if (restoreTarget.current !== undefined) return // 本篇文章已决策：不再重滚
    if (typeof opts.restore !== "number" || opts.restore <= 0.05) {
      // 决策为"无需恢复"：记录结果，后续 reload 刷新 restore 也不重新打开决策
      restoreTarget.current = null
      return
    }
    restoreTarget.current = opts.restore
    const target = opts.restore
    // 双 rAF：等 serif 字体与正文布局稳定后再定位
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max > 0) {
          window.scrollTo(0, Math.round(target * max))
          setProgress(target) // 恢复后立即同步进度条（programmatic scroll 不触发 scroll event）
        } else {
          setProgress(0) // 短文（max<=0）不显示进度，与 onScroll 兜底一致（review Issue 4）
        }
      })
    )
    return () => cancelAnimationFrame(raf2)
    // 依赖里只放能触发"重新决策"的信号；restore 变化不代表要重滚
  }, [opts.ready, opts.stateReady, restoreKey])

  // 写入：滚动时把采样值存进 ref，离开页面 flush 发送 ref（绝不实时重测 scrollY）。
  // 原因：章节导航的 scrollTo(0,0) 与路由切换会在旧页面的 effect cleanup 之前把
  // scrollY 归零；若 flush 实时重测，会把上一篇文章的进度覆盖成 0（review Must-fix）。
  useEffect(() => {
    if (!opts.ready) return
    // id/chapter/site 变化时（同组件实例复用）重置采样，避免串用上一篇/上一章的进度
    lastProgress.current = null
    lastSent.current = null
    setProgress(0)

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
          body: JSON.stringify({
            kind,
            id,
            progress: p,
            site,
            // API 校验 chapter 为有限数字（store 层也是 number）；URL 参数是字符串，
            // 这里统一转 number，否则 400 导致 xbookcn 进度永远写不进去
            chapter: chapter !== undefined ? Number(chapter) : undefined,
          }),
        })
        if (res.ok) lastSent.current = p
      } catch {
        // 写入失败静默：不影响阅读
      }
    }

    const onScroll = () => {
      const p = computeProgress()
      if (p !== null) {
        lastProgress.current = p
        setProgress(p)
      }
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (writeTimer.current) clearTimeout(writeTimer.current)
      void flush()
    }
  }, [opts.ready, kind, id, chapter, site])

  const syncFromViewport = () => {
    const p = computeProgress()
    setProgress(p ?? 0)
  }

  return { progress, syncFromViewport }
}
