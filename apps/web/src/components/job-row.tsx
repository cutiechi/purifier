import { useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronUp } from "lucide-react"
import {
  formatJobDuration,
  formatJobProgress,
  jobTypeLabel,
  STATUS_LABEL,
  type Job,
} from "@/lib/jobs"
import { routes, siteUrl } from "@/lib/routes"
import { JobLogPanel } from "./job-log-panel"
import { cn } from "@workspace/ui/lib/utils"

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
  aborted: "bg-muted text-muted-foreground",
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
  const [open, setOpen] = useState(job.status === "running")
  const running = job.status === "running"
  const progress = formatJobProgress(job.result)
  const duration = formatJobDuration(job)
  const isArchive =
    job.type === "archive_posts" || job.type === "archive_books"
  // 链接按任务 payload 的 site 落站（书库任务看书库归档）
  const archiveSite =
    typeof job.payload?.site === "string"
      ? job.payload.site
      : job.type === "archive_books"
        ? "2"
        : "1"
  const showArchiveLink =
    isArchive && (job.status === "succeeded" || job.status === "running")

  return (
    <li className="rounded-2xl border border-border/80 bg-card/80 shadow-sm">
      <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
        <div className="flex items-start gap-2 sm:items-center sm:gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={open ? "收起日志" : "展开日志"}
            aria-expanded={open}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-lg px-2 py-0.5 text-xs font-medium",
                  STATUS_BADGE[job.status]
                )}
              >
                {STATUS_LABEL[job.status]}
              </span>
              <span className="text-sm font-medium text-foreground">
                {jobTypeLabel(job.type)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                #{job.id}
              </span>
              <span className="text-xs text-muted-foreground/70 tabular-nums">
                {running ? `已运行 ${duration}` : duration}
              </span>
            </div>
            {progress && (
              <span className="text-xs text-muted-foreground tabular-nums sm:truncate">
                {progress}
              </span>
            )}
          </div>

          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            {showArchiveLink && (
              <Link
                to={siteUrl(routes.archive, archiveSite)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                查看归档
              </Link>
            )}
            {running && (
              <button
                type="button"
                onClick={() => onStop(job.id)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                停止
              </button>
            )}
            {!running && (
              <button
                type="button"
                onClick={() => onDelete(job.id)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          {job.error && (
            <p className="mb-2 break-all text-xs text-destructive">
              {job.error}
            </p>
          )}
          <JobLogPanel jobId={job.id} active={running} pollMs={pollMs} />
        </div>
      )}
    </li>
  )
}
