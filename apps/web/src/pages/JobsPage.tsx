import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Download, Plus, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { PageShell, Pager } from "@/components/page-shell"
import { useScrollTop } from "@/components/form-controls"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { JobStatsCards } from "@/components/job-stats-cards"
import { JobsActiveStrip } from "@/components/jobs-active-strip"
import { JobsTable } from "@/components/jobs-table"
import { CreateJobModal } from "@/components/create-job-modal"
import { ME_PAGE_SIZE, totalPages as calcTotalPages } from "@/lib/list-meta"
import {
  downloadBackup,
  formatJobProgress,
  getArchiveStatus,
  getJob,
  listJobs,
  type ArchiveStatus,
  type Job,
  type JobSortKey,
} from "@/lib/jobs"
import { api, parsePage, type SiteId } from "@/lib/routes"

const POLL_MS = 1500
const JOB_TYPES = ["archive_posts", "archive_books", "archive_auto_group"] as const

export default function JobsPage() {
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams)
  const type = searchParams.get("type") ?? ""
  const status = searchParams.get("status") ?? ""
  const sort = (searchParams.get("sort") ?? "created_at") as JobSortKey
  const order = searchParams.get("order") === "asc" ? "asc" : "desc"

  const [jobs, setJobs] = useState<Job[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<number[]>([])

  const [active, setActive] = useState<Job[]>([])
  const [statuses, setStatuses] = useState<Record<SiteId, ArchiveStatus | null>>({
    "1": null,
    "2": null,
  })
  const [groupTotal, setGroupTotal] = useState<number | null>(null)
  const [lastByType, setLastByType] = useState<Record<string, Job | undefined>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState("")
  const prevActiveRef = useRef<Set<number>>(new Set())

  /** 筛选/排序/翻页写 URL；改筛选或排序时 page 重置 */
  function update(next: {
    page?: number
    type?: string
    status?: string
    sort?: string
    order?: string
  }) {
    const params = new URLSearchParams(searchParams)
    let resetPage = false
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") params.delete(k)
      else params.set(k, String(v))
      if (k !== "page") resetPage = true
    }
    if (resetPage) params.delete("page")
    else if (next.page === 1) params.delete("page")
    setSearchParams(params, { replace: true })
  }

  const loadTable = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError("")
      try {
        const data = await listJobs({
          page,
          type: type || undefined,
          status: status || undefined,
          sort,
          order,
        })
        setJobs(data.items)
        setNextPage(data.nextPage)
        setTotal(data.total)
        setSelected((prev) => prev.filter((id) => data.items.some((j) => j.id === id)))
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, type, status, sort, order]
  )

  /** 进行中条 + 统计卡数据（与表格筛选无关，独立请求） */
  const loadSide = useCallback(async () => {
    const [activeRes, s1, s2, groupsRes, ...lasts] = await Promise.all([
      listJobs({ status: "active", limit: 10, sort: "created_at", order: "desc" }),
      getArchiveStatus("1"),
      getArchiveStatus("2"),
      fetch(`${api.meGroups}?limit=1`).then((r) => r.json() as Promise<{ total?: number }>),
      ...JOB_TYPES.map((t) =>
        listJobs({ type: t, status: "finished", limit: 1, sort: "created_at", order: "desc" })
      ),
    ])
    setActive(activeRes.items)
    setStatuses({ "1": s1, "2": s2 })
    setGroupTotal(typeof groupsRes.total === "number" ? groupsRes.total : null)
    const byType: Record<string, Job | undefined> = {}
    lasts.forEach((res, i) => {
      byType[JOB_TYPES[i]] = res.items[0]
    })
    setLastByType(byType)

    // 结束通知：active 集合从非空变空（running→paused 不算结束）
    const prev = prevActiveRef.current
    const now = new Set(activeRes.items.map((j) => j.id))
    if (prev.size > 0 && now.size === 0) {
      for (const id of prev) {
        try {
          const job = await getJob(id)
          if (
            job &&
            job.status !== "running" &&
            job.status !== "paused" &&
            job.status !== "pending"
          ) {
            const title =
              job.status === "succeeded"
                ? "任务已完成"
                : job.status === "aborted"
                  ? "任务已停止"
                  : job.status === "failed"
                    ? "任务失败"
                    : "任务已结束"
            const detail = formatJobProgress(job.result) || job.error || ""
            setToast(detail ? `${title}：${detail}` : title)
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                new Notification(title, { body: detail || undefined })
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // 任务可能已被删除
        }
      }
    }
    prevActiveRef.current = now
  }, [])

  useEffect(() => {
    void loadTable()
  }, [loadTable])
  useEffect(() => {
    void loadSide()
  }, [loadSide])

  // 越界回退
  useEffect(() => {
    if (loading || error || total <= 0) return
    const maxPage = calcTotalPages(total, ME_PAGE_SIZE)
    if (page > maxPage) update({ page: maxPage })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only
  }, [loading, error, total, page])

  useScrollTop([page])

  // active 存在时 1.5s 轮询（绑实例级 active，不绑当前页表格）
  const hasActive = active.length > 0
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => {
      void loadTable(true)
      void loadSide()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [hasActive, loadTable, loadSide])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const onClearCache = async () => {
    if (
      !(await confirm({
        title: "清空内容缓存？",
        description: "将删除所有正文/书库 HTML 与回复 JSON 缓存，不影响历史、收藏与标签。",
        confirmLabel: "清空",
        destructive: true,
      }))
    )
      return
    const res = await fetch(api.meCache, { method: "DELETE" })
    const json = (await res.json()) as { cleared?: number; error?: string }
    setToast(res.ok ? `已清除 ${json.cleared ?? 0} 个缓存文件` : json.error || "清空失败")
  }

  return (
    <PageShell maxWidth="xwide">
      <PageHeader
        title="任务"
        description="同步目录、自动分组与备份"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission()
                }
                setModalOpen(true)
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus size={14} /> 创建任务
            </button>
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
          </div>
        }
      />

      {toast && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-800 dark:text-emerald-300"
        >
          {toast}
        </div>
      )}

      <JobStatsCards
        statuses={statuses}
        groupTotal={groupTotal}
        lastByType={lastByType}
        activeStates={new Map(active.map((j) => [j.type, j.status] as const))}
      />
      <JobsActiveStrip jobs={active} onChanged={() => { void loadSide(); void loadTable(true) }} />

      {/* 筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => update({ type: e.target.value })}
          aria-label="类型筛选"
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">全部类型</option>
          <option value="archive_posts">论坛归档</option>
          <option value="archive_books">书库归档</option>
          <option value="archive_auto_group">自动分组</option>
        </select>
        <select
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          aria-label="状态筛选"
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">全部状态</option>
          <option value="running">运行中</option>
          <option value="paused">已暂停</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="interrupted">中断</option>
          <option value="aborted">已停止</option>
        </select>
      </div>

      <AsyncBody
        loading={loading}
        error={error}
        empty={jobs.length === 0}
        onRetry={() => void loadTable()}
        emptyText="暂无任务记录"
      >
        <JobsTable
          jobs={jobs}
          sort={sort}
          order={order}
          onSortChange={(k) =>
            update({ sort: k, order: k === sort && order === "desc" ? "asc" : "desc" })
          }
          selected={selected}
          onSelectedChange={setSelected}
          onDeleted={() => {
            void loadTable(true)
            void loadSide()
          }}
        />
        {(total > ME_PAGE_SIZE || nextPage !== undefined) && (
          <Pager
            page={page}
            hasNext={nextPage !== undefined}
            totalPages={calcTotalPages(total, ME_PAGE_SIZE)}
            total={total}
            onPrev={() => update({ page: Math.max(1, page - 1) })}
            onNext={() => nextPage !== undefined && update({ page: nextPage })}
            onPage={(n) => update({ page: n })}
            disabled={loading}
          />
        )}
      </AsyncBody>

      <CreateJobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        statuses={statuses}
        hasActive={hasActive}
        onStarted={() => {
          void loadSide()
          void loadTable(true)
        }}
      />
    </PageShell>
  )
}
