import { Fragment, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronUp, ExternalLink, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { JobLogPanel } from "@/components/job-log-panel"
import {
  deleteJob,
  deleteJobsMany,
  formatJobDuration,
  formatJobProgress,
  isTerminalJob,
  jobTypeLabel,
  STATUS_LABEL,
  type Job,
  type JobSortKey,
} from "@/lib/jobs"
import { routes, siteUrl } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

const POLL_MS = 1500

const STATUS_BADGE: Record<Job["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  paused: "bg-blue-500/15 text-blue-500 dark:text-blue-300",
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
  aborted: "bg-muted text-muted-foreground",
}

function archiveSite(job: Job): string {
  if (typeof job.payload?.site === "string") return job.payload.site
  return job.type === "archive_books" ? "2" : "1"
}

function paramSummary(job: Job): string {
  const site = archiveSite(job) === "2" ? "书库" : "论坛"
  const mode = job.payload?.mode
  const modeLabel =
    mode === "full" ? "全量" : mode === "resume" ? "续跑" : mode === "incremental" ? "增量" : ""
  return [site, modeLabel].filter(Boolean).join(" · ")
}

function jumpTo(job: Job): string {
  if (job.type === "archive_auto_group") return routes.groups
  return siteUrl(routes.archive, archiveSite(job))
}

/** 可排序表头 */
function Th({
  label,
  sortKey,
  sort,
  order,
  onSortChange,
  className,
}: {
  label: string
  sortKey?: JobSortKey
  sort: JobSortKey
  order: "asc" | "desc"
  onSortChange: (k: JobSortKey) => void
  className?: string
}) {
  if (!sortKey) {
    return (
      <th
        className={cn(
          "px-3 py-2 text-left text-xs font-medium text-muted-foreground",
          className
        )}
      >
        {label}
      </th>
    )
  }
  const active = sort === sortKey
  return (
    <th className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
        {active && <span className="text-[10px]">{order === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  )
}

export function JobsTable({
  jobs,
  sort,
  order,
  onSortChange,
  selected,
  onSelectedChange,
  onDeleted,
}: {
  jobs: Job[]
  sort: JobSortKey
  order: "asc" | "desc"
  onSortChange: (k: JobSortKey) => void
  selected: number[]
  onSelectedChange: (ids: number[]) => void
  onDeleted: () => void
}) {
  const confirm = useConfirm()
  const [openLog, setOpenLog] = useState<number | null>(null)
  const terminalIds = jobs.filter(isTerminalJob).map((j) => j.id)
  const allSelected = terminalIds.length > 0 && terminalIds.every((id) => selected.includes(id))

  const toggle = (id: number) => {
    onSelectedChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    )
  }

  const onDeleteOne = async (job: Job) => {
    if (
      !(await confirm({
        title: "删除该任务？",
        description: "任务记录及其日志将被永久删除。",
        confirmLabel: "删除",
        destructive: true,
      }))
    )
      return
    await deleteJob(job.id)
    onSelectedChange(selected.filter((s) => s !== job.id))
    onDeleted()
  }

  const onDeleteMany = async () => {
    if (selected.length === 0) return
    if (
      !(await confirm({
        title: `删除所选 ${selected.length} 条任务？`,
        description: "任务记录及其日志将被永久删除。",
        confirmLabel: "删除",
        destructive: true,
      }))
    )
      return
    await deleteJobsMany(selected)
    onSelectedChange([])
    onDeleted()
  }

  const logRow = (job: Job) => (
    <div className="py-2">
      {job.error && <p className="mb-2 break-all text-xs text-destructive">{job.error}</p>}
      <JobLogPanel
        jobId={job.id}
        active={job.status === "running" || job.status === "paused"}
        pollMs={POLL_MS}
      />
    </div>
  )

  return (
    <div>
      {selected.length > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-sm">
          <span className="text-sm text-muted-foreground">已选 {selected.length} 条</span>
          <button
            type="button"
            onClick={() => void onDeleteMany()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={13} /> 删除所选
          </button>
          <button
            type="button"
            onClick={() => onSelectedChange([])}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            取消选择
          </button>
        </div>
      )}

      {/* 手机：<sm 卡片行 */}
      <ul className="space-y-2.5 sm:hidden">
        {jobs.map((job) => {
          const terminal = isTerminalJob(job)
          return (
            <li key={job.id} className="rounded-2xl border border-border/80 bg-card/80 px-3 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                {terminal && (
                  <input
                    type="checkbox"
                    checked={selected.includes(job.id)}
                    onChange={() => toggle(job.id)}
                    className="size-4"
                  />
                )}
                <span className={cn("rounded-lg px-2 py-0.5 text-xs font-medium", STATUS_BADGE[job.status])}>
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="text-sm font-medium text-foreground">{jobTypeLabel(job.type)}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatJobDuration(job)}
                </span>
              </div>
              {formatJobProgress(job.result) && (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatJobProgress(job.result)}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1 text-xs">
                <Link
                  to={jumpTo(job)}
                  className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  查看
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenLog(openLog === job.id ? null : job.id)}
                  className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {openLog === job.id ? "收起日志" : "日志"}
                </button>
                {terminal && (
                  <button
                    type="button"
                    onClick={() => void onDeleteOne(job)}
                    className="ml-auto rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    删除
                  </button>
                )}
              </div>
              {openLog === job.id && <div className="mt-2 border-t border-border/60 pt-2">{logRow(job)}</div>}
            </li>
          )
        })}
      </ul>

      {/* 手机行操作 ≤3 个平铺；若将来超过 3 个，收进「…」菜单（规格 #16） */}

      {/* 桌面：sm+ 表格 */}
      <table className="hidden w-full border-collapse sm:table">
        <thead>
          <tr className="border-b border-border">
            <th className="w-8 px-3 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectedChange(allSelected ? [] : terminalIds)}
                aria-label="全选本页已结束任务"
                className="size-4"
              />
            </th>
            <Th label="状态" sortKey="status" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="类型" sortKey="type" sort={sort} order={order} onSortChange={onSortChange} />
            <Th
              label="参数"
              sort={sort}
              order={order}
              onSortChange={onSortChange}
              className="hidden lg:table-cell"
            />
            <Th label="进度 / 结果" sort={sort} order={order} onSortChange={onSortChange} />
            <Th label="耗时" sortKey="duration" sort={sort} order={order} onSortChange={onSortChange} />
            <Th
              label="创建时间"
              sortKey="created_at"
              sort={sort}
              order={order}
              onSortChange={onSortChange}
              className="hidden lg:table-cell"
            />
            <Th label="操作" sort={sort} order={order} onSortChange={onSortChange} />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const terminal = isTerminalJob(job)
            const open = openLog === job.id
            return (
              <Fragment key={job.id}>
                <tr className="border-b border-border/60 hover:bg-accent/30">
                  <td className="px-3 py-2.5">
                    {terminal ? (
                      <input
                        type="checkbox"
                        checked={selected.includes(job.id)}
                        onChange={() => toggle(job.id)}
                        className="size-4"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("rounded-lg px-2 py-0.5 text-xs font-medium", STATUS_BADGE[job.status])}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-foreground">{jobTypeLabel(job.type)}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {paramSummary(job)}
                  </td>
                  <td className="max-w-64 truncate px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                    {formatJobProgress(job.result)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                    {formatJobDuration(job)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground tabular-nums lg:table-cell">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Link
                        to={jumpTo(job)}
                        title="查看"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ExternalLink size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setOpenLog(open ? null : job.id)}
                        title={open ? "收起日志" : "展开日志"}
                        aria-expanded={open}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {terminal && (
                        <button
                          type="button"
                          onClick={() => void onDeleteOne(job)}
                          title="删除"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {open && (
                  <tr key={`${job.id}-log`}>
                    <td colSpan={8} className="px-3 pb-3">
                      {logRow(job)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
