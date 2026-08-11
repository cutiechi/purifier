import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  Download,
  FolderTree,
  Play,
  RefreshCw,
  SkipForward,
  Trash2,
} from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { PageShell, Pager } from "@/components/page-shell"
import { useScrollTop } from "@/components/form-controls"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { JobRow } from "@/components/job-row"
import { useSite } from "@/hooks/use-site"
import {
  ME_PAGE_SIZE,
  totalPages as calcTotalPages,
} from "@/lib/list-meta"
import {
  clearFinishedJobs,
  deleteJob,
  downloadBackup,
  formatJobProgress,
  getArchiveStatus,
  getPollMs,
  listJobs,
  setPollMs,
  startJob,
  stopJob,
  POLL_OPTIONS,
  type ArchiveMode,
  type ArchiveStatus,
  type Job,
} from "@/lib/jobs"
import { api, parsePage, routes, siteUrl } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export default function JobsPage() {
  const site = useSite()
  const confirm = useConfirm()
  const isBooks = site === "2"
  const archiveJobType = isBooks ? "archive_books" : "archive_posts"
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams)
  const [jobs, setJobs] = useState<Job[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<ArchiveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [pollMs, setPollMsState] = useState<number>(1500)
  const [toast, setToast] = useState("")
  const prevRunningRef = useRef(false)

  /** 翻页 / 改页：写 page searchParam（page=1 删除参数，保持 URL 干净） */
  function update(next: { page?: number }) {
    const params = new URLSearchParams(searchParams)
    if (next.page != null) {
      if (next.page > 1) params.set("page", String(next.page))
      else params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    setPollMsState(getPollMs())
  }, [])

  const reload = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      if (!opts?.silent) setLoading(true)
      setError("")
      try {
        const [data, st] = await Promise.all([
          listJobs({ page }),
          getArchiveStatus(site),
        ])
        setJobs(data.items)
        setNextPage(data.nextPage)
        setTotal(data.total)
        if (st) setStatus(st)
        // 返回「本次结果是否还有 running」，供轮询决定是否继续
        return data.items.some((j) => j.status === "running")
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
        return false
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [site, page]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  // 删除/清空后页码越界 → 回退到最后一页
  useEffect(() => {
    if (loading || error) return
    if (total <= 0) return
    const maxPage = calcTotalPages(total, ME_PAGE_SIZE)
    if (page > maxPage) update({ page: maxPage })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only on total/page
  }, [loading, error, total, page])

  useScrollTop([page])

  // 有 running job 时按 pollMs silent 刷新（用 ref 读 jobs，避免每次 setJobs 重建计时器）
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  useEffect(() => {
    let cancelled = false
    let t: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const hasRunning = jobsRef.current.some((j) => j.status === "running")
      if (!hasRunning || cancelled) return
      // 用 reload 本次结果决定是否继续轮询：
      // finally 里读 jobsRef 是 React 提交前的旧值，会多排一次冗余 tick
      const stillRunning = await reload({ silent: true })
      if (!cancelled && stillRunning) {
        t = setTimeout(tick, pollMs)
      }
    }
    // 仅当当前已有 running 时启动轮询
    if (jobsRef.current.some((j) => j.status === "running")) {
      t = setTimeout(tick, pollMs)
    }
    return () => {
      cancelled = true
      if (t) clearTimeout(t)
    }
  }, [pollMs, reload, !!jobs.some((j) => j.status === "running")])

  // 运行中 → 结束：完成提示 + 可选系统通知
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running")
    if (prevRunningRef.current && !hasRunning) {
      const last = jobs[0]
      if (last && last.status !== "running" && last.status !== "pending") {
        const title =
          last.status === "succeeded"
            ? "归档任务已完成"
            : last.status === "aborted"
              ? "归档任务已停止"
              : last.status === "failed"
                ? "归档任务失败"
                : "归档任务已结束"
        const detail = formatJobProgress(last.result) || last.error || ""
        setToast(detail ? `${title}：${detail}` : title)
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(title, { body: detail || undefined })
          } catch {
            // ignore
          }
        }
      }
    }
    prevRunningRef.current = hasRunning
  }, [jobs])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const requestNotify = () => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission()
    }
  }

  const onStart = async (mode: ArchiveMode) => {
    setBusy(true)
    setError("")
    try {
      requestNotify()
      await startJob(archiveJobType, { site, mode })
      if (page !== 1) update({ page: 1 })
      else await reload({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  const onAutoGroup = async () => {
    setBusy(true)
    setError("")
    try {
      requestNotify()
      await startJob("archive_auto_group", { site, minMembers: 2 })
      if (page !== 1) update({ page: 1 })
      else await reload({ silent: true })
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

  const onClearCache = async () => {
    const ok = await confirm({
      title: "清空内容缓存？",
      description: "将删除所有正文/书库 HTML 与回复 JSON 缓存，不影响历史、收藏与标签。",
      confirmLabel: "清空",
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(api.meCache, { method: "DELETE" })
      const json = (await res.json()) as { cleared?: number; error?: string }
      if (!res.ok) throw new Error(json.error || "清空失败")
      setToast(`已清除 ${json.cleared ?? 0} 个缓存文件`)
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
  const startDisabled = busy || hasRunning
  const canResume =
    !!status?.cursor?.next_mtid &&
    (status.cursor.status === "interrupted" ||
      status.cursor.status === "running")
  // running cursor during another machine? local only — allow resume when interrupted/done-with-cursor
  const resumeEnabled =
    !startDisabled &&
    !!status?.cursor?.next_mtid &&
    status.cursor.status !== "done"
  const startHint = hasRunning
    ? "已有任务在运行"
    : busy
      ? "启动中…"
      : undefined

  const cursorHint = status
    ? [
        `库内 ${status.total} 条`,
        status.maxTid && !isBooks ? `最新 tid ${status.maxTid}` : null,
        status.cursor
          ? `游标 ${status.cursor.status}${
              status.cursor.next_mtid
                ? ` @ ${status.cursor.next_mtid}`
                : status.cursor.status === "done"
                  ? "（已完成）"
                  : ""
            } · 已记 ${status.cursor.pages} 页`
          : "尚无续跑游标",
      ]
        .filter(Boolean)
        .join(" · ")
    : null

  // 任务页按站可用：论坛 archive_posts、书库 archive_books

  return (
    <PageShell>
      <PageHeader
        title="任务"
        description={isBooks ? "同步书库目录与备份" : "同步目录、自动分组与备份"}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadBackup()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Download size={14} /> 导出备份
            </button>
            <button
              type="button"
              onClick={() => void onClearCache()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Trash2 size={14} /> 清空缓存
            </button>
            <Link
              to={siteUrl(routes.archive, site)}
              className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              返回目录
            </Link>
          </div>
        }
      />
      <PageSiteTabs sites={["1", "2"]} />

      {toast && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-800 dark:text-emerald-300"
        >
          {toast}
        </div>
      )}

      {runningJob && (
        <div className="mb-4 rounded-2xl border border-blue-500/25 bg-blue-500/10 px-3.5 py-3 text-sm text-blue-700 dark:text-blue-300">
          <div className="font-medium">
            {runningJob.type === "archive_auto_group"
              ? "自动分组进行中"
              : "归档进行中"}
          </div>
          <div className="mt-0.5 text-xs opacity-90">
            {formatJobProgress(runningJob.result) ||
              (runningJob.type === "archive_auto_group"
                ? "正在扫描归档并建组…"
                : "正在抓取首页分页…")}
            {" · "}
            <Link
              to={
                runningJob.type === "archive_auto_group"
                  ? routes.groups
                  : siteUrl(routes.archive, site)
              }
              className="underline underline-offset-2"
            >
              {runningJob.type === "archive_auto_group"
                ? "打开分组"
                : "打开归档目录"}
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
            <Link
              to={siteUrl(routes.archive, site)}
              className="underline underline-offset-2"
            >
              查看归档
            </Link>
          </div>
        </div>
      )}

      {cursorHint && (
        <p className="mb-3 text-xs text-muted-foreground tabular-nums">
          {cursorHint}
        </p>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onStart("full")}
            disabled={startDisabled}
            title={startHint ?? (isBooks ? "从第 1 页（最新收录）往后扫" : "从最新帖往回全量扫描")}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Play size={14} /> 全量归档
          </button>
          <button
            type="button"
            onClick={() => void onStart("resume")}
            disabled={!resumeEnabled}
            title={
              resumeEnabled
                ? isBooks
                  ? `从第 ${status?.cursor?.next_mtid} 页继续`
                  : `从游标 ${status?.cursor?.next_mtid} 继续`
                : "没有可续跑的游标（先跑全量或中断后再试）"
            }
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <SkipForward size={14} /> 继续归档
          </button>
          <button
            type="button"
            onClick={() => void onStart("incremental")}
            disabled={startDisabled}
            title={isBooks ? "只补比库内更新收录的书" : "只扫比库内最新 tid 还新的帖子"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={14} /> 增量更新
          </button>
          {!isBooks && (
            <button
              type="button"
              onClick={() => void onAutoGroup()}
              disabled={startDisabled}
              title="按书名把归档里多章帖子自动写入分组（≥2 章）"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <FolderTree size={14} /> 归档自动分组
            </button>
          )}
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

      {startHint && hasRunning && (
        <p className="mb-4 text-xs text-muted-foreground">{startHint}</p>
      )}
      {canResume && !hasRunning && (
        <p className="mb-4 text-xs text-muted-foreground">
          检测到未完成游标，可点「继续归档」从中断处接着扫，无需从头开始。
        </p>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={jobs.length === 0}
        onRetry={() => void reload()}
        emptyText={
          isBooks ? (
            <>
              暂无任务。可用「全量归档」从第 1 页（最新收录）往后扫，「增量更新」只补新书；中断后用「继续归档」。完成后可在
              <Link
                to={siteUrl(routes.archive, site)}
                className="text-foreground underline underline-offset-2"
              >
                归档
              </Link>
              浏览，或点「导出备份」下载本地数据。
            </>
          ) : (
            <>
              暂无任务。可用「全量归档」扫全站，「增量更新」只补新帖；中断后用「继续归档」。完成后可在
              <Link
                to={siteUrl(routes.archive, site)}
                className="text-foreground underline underline-offset-2"
              >
                归档
              </Link>
              浏览，或点「导出备份」下载本地数据。
            </>
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
        {(total > ME_PAGE_SIZE || nextPage !== undefined) && (
          <Pager
            page={page}
            hasNext={nextPage !== undefined}
            totalPages={calcTotalPages(total, ME_PAGE_SIZE)}
            total={total}
            onPrev={() => update({ page: Math.max(1, page - 1) })}
            onNext={() =>
              nextPage !== undefined && update({ page: nextPage })
            }
            disabled={loading}
          />
        )}
      </AsyncBody>
    </PageShell>
  )
}
