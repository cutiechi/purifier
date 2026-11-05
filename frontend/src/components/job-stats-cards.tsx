import { Link } from "react-router-dom"
import { formatJobProgress, type ArchiveStatus, type Job } from "@/lib/jobs"
import {
  forumRoutes,
  libraryRoutes,
  SITES,
  type SiteId,
} from "@/lib/routes"

function lastSummary(job: Job | undefined): string {
  if (!job) return "还没跑过"
  if (job.status === "finished")
    return `上次：${formatJobProgress(job.result) || "成功"}`
  if (job.status === "error") return "上次失败"
  if (job.status === "cancelled") return "上次已停止"
  return "上次未完成"
}

function Card({
  to,
  title,
  value,
  sub,
  state,
}: {
  to: string
  title: string
  value: string
  sub: string
  state: string
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm transition-colors hover:bg-accent/50"
    >
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-xl font-semibold text-foreground tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      <div className="mt-2 text-xs font-medium text-foreground/80">{state}</div>
    </Link>
  )
}

export function JobStatsCards({
  statuses,
  groupTotal,
  lastByType,
  activeStates,
}: {
  statuses: Record<SiteId, ArchiveStatus | null>
  groupTotal: number | null
  lastByType: Record<string, Job | undefined>
  activeStates: Map<string, string>
}) {
  const siteState = (type: string, s: ArchiveStatus | null) => {
    // 活动态优先：区分「进行中 / 已暂停」（与验收清单、进行中条一致）
    const active = activeStates.get(type)
    if (active === "running" || active === "pending") return "进行中"
    if (active === "paused") return "已暂停"
    // 可续判定统一为一条：next_mtid 存在且 status !== done（UI 不展示游标值）
    if (s?.cursor?.next_mtid && s.cursor.status !== "done") {
      return "可从中断处接着扫"
    }
    if (s?.cursor?.status === "done") return "已扫完"
    return "—"
  }
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card
        to={forumRoutes.archive}
        title={SITES["1"].label}
        value={statuses["1"] ? `库内 ${statuses["1"].total} 条` : "—"}
        sub={lastSummary(lastByType["archive_posts"])}
        state={siteState("archive_posts", statuses["1"])}
      />
      <Card
        to={libraryRoutes.archive}
        title={SITES["2"].label}
        value={statuses["2"] ? `库内 ${statuses["2"].total} 条` : "—"}
        sub={lastSummary(lastByType["archive_books"])}
        state={siteState("archive_books", statuses["2"])}
      />
      <Card
        to={forumRoutes.groups}
        title="自动分组"
        value={groupTotal != null ? `${groupTotal} 组` : "—"}
        sub={lastSummary(lastByType["archive_auto_group"])}
        state={siteState("archive_auto_group", null)}
      />
    </div>
  )
}
