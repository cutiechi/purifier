import { useEffect, useRef, useState } from "react"
import { getJobLogs, type JobLog } from "@/lib/jobs"

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const fresh = await getJobLogs(jobId, { order: "desc", limit: 200 })
        if (!cancelled) {
          // desc 拉回 → 反转成 ASC 显示
          setLogs(fresh.slice().reverse())
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

  if (logs.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">暂无日志</p>
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-foreground">
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
          [{l.level}] {l.message}
        </div>
      ))}
    </pre>
  )
}
