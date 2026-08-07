import { useCallback, useEffect, useState } from "react"
import { Play, Trash2 } from "lucide-react"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { JobRow } from "@/components/job-row"
import { useSite } from "@/hooks/use-site"
import {
  clearFinishedJobs,
  deleteJob,
  getPollMs,
  listJobs,
  setPollMs,
  startJob,
  stopJob,
  POLL_OPTIONS,
  type Job,
} from "@/lib/jobs"

export default function JobsPage() {
  const site = useSite()
  const archiveSupported = site === "1"
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [pollMs, setPollMsState] = useState<number>(1500)

  useEffect(() => {
    setPollMsState(getPollMs())
  }, [])

  // silent：轮询/操作后局部刷新，不闪 loading；首屏 loading 由调用方控制
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError("")
    try {
      setJobs(await listJobs())
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 有 running job 时按 pollMs silent 刷新列表；每次轮询完成后无条件续期，
  // 静默失败（jobs 未变化）也不会中断轮询链
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running")
    if (!hasRunning) return
    let cancelled = false
    let t: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        await reload({ silent: true })
      } finally {
        if (!cancelled) t = setTimeout(tick, pollMs)
      }
    }
    t = setTimeout(tick, pollMs)
    return () => {
      cancelled = true
      if (t) clearTimeout(t)
    }
  }, [jobs, pollMs, reload])

  const onStart = async () => {
    setBusy(true)
    setError("")
    try {
      await startJob("archive_posts", { site: "1" })
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  const onStop = async (id: number) => {
    try {
      await stopJob(id)
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止失败")
    }
  }

  const onDelete = async (id: number) => {
    if (!confirm("删除该任务及其日志？")) return
    try {
      await deleteJob(id)
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    }
  }

  const onClear = async () => {
    if (!confirm("清空所有已结束的任务？")) return
    try {
      await clearFinishedJobs()
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "清空失败")
    }
  }

  const onChangePoll = (ms: number) => {
    setPollMs(ms)
    setPollMsState(ms)
  }

  const hasRunning = jobs.some((j) => j.status === "running")

  return (
    <PageShell>
      <PageHeader
        title="任务"
        description="后台长跑任务（全站主帖归档等）"
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={busy || hasRunning || !archiveSupported}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          title={!archiveSupported ? "当前站点不支持归档" : undefined}
        >
          <Play size={14} /> 开始归档
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 size={14} /> 清空已结束
        </button>
        <label className="ml-auto text-xs text-muted-foreground">
          刷新间隔
          <select
            value={pollMs}
            onChange={(e) => onChangePoll(Number(e.target.value))}
            className="ml-2 rounded-lg border border-border bg-background px-1.5 py-1"
          >
            {POLL_OPTIONS.map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000}s
              </option>
            ))}
          </select>
        </label>
      </div>
      {!archiveSupported && (
        <p className="mb-4 text-sm text-muted-foreground">
          当前站点不支持归档（仅论坛站可归档主帖）。
        </p>
      )}
      <AsyncBody
        loading={loading}
        error={error}
        empty={jobs.length === 0}
        onRetry={() => void reload()}
        emptyText="暂无任务"
      >
        <ul className="space-y-2.5">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              pollMs={pollMs}
              onStop={onStop}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </AsyncBody>
    </PageShell>
  )
}
