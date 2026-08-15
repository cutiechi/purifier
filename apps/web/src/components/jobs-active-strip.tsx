import { useState } from "react"
import { Pause, Play, Square } from "lucide-react"
import {
  formatJobProgress,
  jobTypeLabel,
  pauseJob,
  resumeJob,
  stopJob,
  type Job,
} from "@/lib/jobs"
import { JobLogPanel } from "@/components/job-log-panel"

const POLL_MS = 1500

export function JobsActiveStrip({
  jobs,
  onChanged,
}: {
  jobs: Job[]
  onChanged: () => void
}) {
  const [openLog, setOpenLog] = useState<number | null>(null)
  if (jobs.length === 0) return null
  return (
    <section
      aria-label="进行中"
      className="mb-4 space-y-2 rounded-2xl border border-blue-500/25 bg-blue-500/10 px-3.5 py-3"
    >
      {jobs.map((job) => {
        const paused = job.status === "paused"
        return (
          <div key={job.id} className="text-sm text-blue-700 dark:text-blue-300">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {jobTypeLabel(job.type)}
                {paused ? "（已暂停）" : ""}
              </span>
              <span className="text-xs opacity-90 tabular-nums">
                {formatJobProgress(job.result) || "启动中…"}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {paused ? (
                  <button
                    type="button"
                    title="继续"
                    onClick={() => {
                      void resumeJob(job.id).then(onChanged).catch(() => onChanged())
                    }}
                    className="rounded-lg p-1.5 hover:bg-blue-500/15"
                  >
                    <Play size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="暂停"
                    onClick={() => {
                      void pauseJob(job.id).then(onChanged).catch(() => onChanged())
                    }}
                    className="rounded-lg p-1.5 hover:bg-blue-500/15"
                  >
                    <Pause size={14} />
                  </button>
                )}
                <button
                  type="button"
                  title="停止"
                  onClick={() => {
                    void stopJob(job.id).then(onChanged).catch(() => onChanged())
                  }}
                  className="rounded-lg p-1.5 hover:bg-blue-500/15"
                >
                  <Square size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenLog(openLog === job.id ? null : job.id)}
                  className="rounded-lg px-2 py-1 text-xs underline underline-offset-2"
                >
                  {openLog === job.id ? "收起日志" : "日志"}
                </button>
              </span>
            </div>
            {openLog === job.id && (
              <div className="mt-2 rounded-xl bg-background/60 p-2">
                <JobLogPanel
                  jobId={job.id}
                  active={job.status === "running" || job.status === "paused"}
                  pollMs={POLL_MS}
                />
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
