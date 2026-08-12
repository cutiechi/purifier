import { useEffect, useRef } from "react"
import { type SiteId } from "@/lib/routes"

const FLUSH_INTERVAL_MS = 60_000
const MIN_SEGMENT_S = 3

/**
 * 可见时计阅读时长，分段 sendBeacon 提交。
 * enabled 与 useReadingProgress 的 ready 一致：仅在「正文就绪」时计时；
 * 目录页 / loading / error 壳传 enabled=false。换 id/chapter 经依赖变化重挂：旧实例 flush + 新实例。
 *
 * 双锚点：segStartPerf（performance.now，单调，算时长）+ segStartWall（Date.now，
 * 作 payload startedAt，归因日/小时按它分桶）。
 * accumulate 无条件把「段起点→now」计入 accMs：visibilitychange→hidden 时 visible()
 * 已是 false，若再要求 visible() 才累加会丢掉当前段（最多近 60s）。
 */
export function useReadingSession(opts: {
  site: SiteId
  kind: "post" | "book"
  id: string
  title: string
  enabled: boolean
}): void {
  const { site, kind, id, title, enabled } = opts
  const accMs = useRef(0)
  const segStartPerf = useRef<number | null>(null)
  const segStartWall = useRef<number | null>(null)
  // 最新 title 进 ref：title 变化不重置计时，只影响后续 flush payload
  const titleRef = useRef(title)
  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    if (!enabled) return
    // 重置段锚点：refs 跨 effect 存活，上次 cleanup 的 re-arm 会留下旧锚点；
    // 不重置会把 enabled=false（loading/换篇）期间的墙钟时间算进第一个段。
    accMs.current = 0
    segStartPerf.current = null
    segStartWall.current = null
    const visible = () => document.visibilityState === "visible"
    const startSegment = () => {
      if (segStartPerf.current === null) {
        segStartPerf.current = performance.now()
        segStartWall.current = Date.now()
      }
    }
    // 无条件累加当前段（hidden 转换点不能因 visible()=false 而漏计）
    const accumulate = () => {
      if (segStartPerf.current !== null) {
        accMs.current += performance.now() - segStartPerf.current
        segStartPerf.current = null
        segStartWall.current = null
      }
    }
    const flush = () => {
      const wallStart = segStartWall.current // accumulate 前先取段起点墙钟
      accumulate()
      const durationS = Math.round(accMs.current / 1000)
      const startedAt = wallStart ?? Date.now() - durationS * 1000
      if (durationS >= MIN_SEGMENT_S) {
        const payload = JSON.stringify({
          site,
          kind,
          id,
          title: titleRef.current,
          startedAt,
          durationS,
        })
        const url = "/api/me/sessions"
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(
              url,
              new Blob([payload], { type: "application/json" })
            )
          } else {
            void fetch(url, {
              method: "POST",
              body: payload,
              keepalive: true,
              headers: { "content-type": "application/json" },
            })
          }
        } catch {
          /* 静默：统计非关键路径 */
        }
      }
      accMs.current = 0
      if (visible()) startSegment() // 仍可见 → 开新段
    }
    const onVisibility = () => {
      if (!visible()) flush()
      else startSegment()
    }
    startSegment()
    const timer = setInterval(flush, FLUSH_INTERVAL_MS)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", flush)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [enabled, site, kind, id]) // 故意不含 title：title 变化不重置计时
}
