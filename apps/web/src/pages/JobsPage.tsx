import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Play, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { JobRow } from "@/components/job-row"
import { useSite } from "@/hooks/use-site"
import {
  clearFinishedJobs,
  deleteJob,
  formatJobProgress,
  getPollMs,
  listJobs,
  setPollMs,
  startJob,
  stopJob,
  POLL_OPTIONS,
  type Job,
} from "@/lib/jobs"
import { routes } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export default function JobsPage() {
  const site = useSite()
  const confirm = useConfirm()
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
    const ok = await confirm({
      title: "删除该任务？",
      description: "任务记录及其日志将被永久删除。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteJob(id)
      await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    }
  }

  const onClear = async () => {
    const ok = await confirm({
      title: "清空已结束任务？",
      description: "将删除所有已成功、失败、中断或已停止的任务及其日志。",
      confirmLabel: "清空",
      destructive: true,
    })
    if (!ok) return
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

  const runningJob = jobs.find((j) => j.status === "running")
  const hasRunning = !!runningJob
  const lastSuccess = jobs.find((j) => j.status === "succeeded")
  const startDisabled = busy || hasRunning || !archiveSupported
  const startHint = !archiveSupported
    ? "当前站点不支持归档（仅论坛站）"
    : hasRunning
      ? "已有任务在运行"
      : busy
        ? "启动中…"
        : undefined

  return (
    <PageShell>
      <PageHeader
        title="任务"
        description="后台长跑任务（全站主帖归档等）"
        action={
          <Link
            to={routes.archive}
            className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            查看归档
          </Link>
        }
      />

      {runningJob && (
        <div className="mb-4 rounded-2xl border border-blue-500/25 bg-blue-500/10 px-3.5 py-3 text-sm text-blue-700 dark:text-blue-300">
          <div className="font-medium">归档进行中</div>
          <div className="mt-0.5 text-xs opacity-90">
            {formatJobProgress(runningJob.result) || "正在抓取首页分页…"}
            {" · "}
            <Link to={routes.archive} className="underline underline-offset-2">
              打开归档目录
            </Link>
          </div>
        </div>
      )}

      {!hasRunning && lastSuccess && lastSuccess.result && (
        <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          <div className="font-medium">最近一次归档成功</div>
          <div className="mt-0.5 text-xs opacity-90">
            {formatJobProgress(lastSuccess.result)}
            {" · "}
            <Link to={routes.archive} className="underline underline-offset-2">
              查看归档
            </Link>
          </div>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={startDisabled}
            title={startHint}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Play size={14} /> 开始归档
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Trash2 size={14} /> 清空已结束
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground sm:ml-auto">
          刷新间隔
          <select
            value={pollMs}
            onChange={(e) => onChangePoll(Number(e.target.value))}
            className={cn(
              "h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            )}
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
          当前站点不支持归档（仅论坛站可归档主帖）。可切换到「论坛」后再启动。
        </p>
      )}
      {startHint && archiveSupported && hasRunning && (
        <p className="mb-4 text-xs text-muted-foreground">{startHint}</p>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={jobs.length === 0}
        onRetry={() => void reload()}
        emptyText={
          archiveSupported ? (
            <>
              暂无任务。点「开始归档」抓取全站主帖目录，完成后可在
              <Link
                to={routes.archive}
                className="text-foreground underline underline-offset-2"
              >
                归档
              </Link>
              浏览。
            </>
          ) : (
            "暂无任务"
          )
        }
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
