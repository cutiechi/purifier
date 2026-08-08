import { useEffect, useRef, useState } from "react"
import { getJobLogs, type JobLog } from "@/lib/jobs"
import { formatDateTime } from "@/lib/format"

/** 日志面板：running 时按 pollMs 轮询 desc 拉尾，UI 反转为 ASC 显示 */
export function JobLogPanel({
  jobId,
  running,
  pollMs,
}: {
  jobId: number
  running: boolean
  pollMs: number
}) {
  const [logs, setLogs] = useState<JobLog[]>([])
  const [truncated, setTruncated] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preRef = useRef<HTMLPreElement | null>(null)
  const stickBottomRef = useRef(true)
  const limit = 200

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const fresh = await getJobLogs(jobId, { order: "desc", limit })
        if (!cancelled) {
          // desc 拉回 → 反转成 ASC 显示
          setLogs(fresh.slice().reverse())
          setTruncated(fresh.length >= limit)
        }
      } catch {
        // 静默
      }
      if (!cancelled && running) {
        timerRef.current = setTimeout(poll, pollMs)
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [jobId, running, pollMs])

  // 贴底：用户未上滚时，日志更新后滚到底
  useEffect(() => {
    const el = preRef.current
    if (!el || !stickBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  if (logs.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">暂无日志</p>
  }

  return (
    <div className="space-y-1.5">
      {truncated && (
        <p className="text-[11px] text-muted-foreground">
          仅显示最近 {limit} 条
        </p>
      )}
      <pre
        ref={preRef}
        onScroll={() => {
          const el = preRef.current
          if (!el) return
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight
          stickBottomRef.current = dist < 40
        }}
        className="max-h-72 overflow-auto rounded-xl bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-foreground sm:text-xs"
      >
        {logs.map((l) => (
          <div
            key={l.id}
            className={
              l.level === "error"
                ? "text-destructive"
                : l.level === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            }
          >
            <span className="text-muted-foreground/60">
              {formatLogTime(l.created_at)}{" "}
            </span>
            <span className="font-medium">[{l.level}]</span>{" "}
            <span className="break-all whitespace-pre-wrap">{l.message}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

function formatLogTime(ms: number): string {
  try {
    // 短时分秒，便于判断卡顿
    const d = new Date(ms)
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    const ss = String(d.getSeconds()).padStart(2, "0")
    return `${hh}:${mm}:${ss}`
  } catch {
    return formatDateTime(ms)
  }
}
