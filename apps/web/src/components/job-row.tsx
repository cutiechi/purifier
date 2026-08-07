import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { Job } from "@/lib/jobs"
import { JobLogPanel } from "./job-log-panel"

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
  aborted: "bg-muted text-muted-foreground",
}

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "等待",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  interrupted: "中断",
  aborted: "已停止",
}

export function JobRow({
  job,
  pollMs,
  onStop,
  onDelete,
}: {
  job: Job
  pollMs: number
  onStop: (id: number) => void
  onDelete: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const running = job.status === "running"
  const duration =
    job.started_at != null && job.finished_at != null
      ? `${Math.round((job.finished_at - job.started_at) / 1000)}s`
      : job.started_at != null
        ? "进行中"
        : "-"
  return (
    <li className="rounded-2xl border border-border/80 bg-card/80 shadow-sm">
      <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label={open ? "收起日志" : "展开日志"}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <span
          className={`rounded-lg px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[job.status]}`}
        >
          {STATUS_LABEL[job.status]}
        </span>
        <span className="text-sm font-medium text-foreground">{job.type}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          #{job.id}
        </span>
        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {duration}
        </span>
        {job.result && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {Object.entries(job.result)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {running && (
            <button
              type="button"
              onClick={() => onStop(job.id)}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              停止
            </button>
          )}
          {!running && (
            <button
              type="button"
              onClick={() => onDelete(job.id)}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              删除
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          {job.error && (
            <p className="mb-2 text-xs text-destructive">{job.error}</p>
          )}
          <JobLogPanel jobId={job.id} running={running} pollMs={pollMs} />
        </div>
      )}
    </li>
  )
}
