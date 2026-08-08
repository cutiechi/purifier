import { api } from "@/lib/routes"

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "aborted"

export interface Job {
  id: number
  type: string
  status: JobStatus
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

export interface JobLog {
  id: number
  job_id: number
  level: "info" | "warn" | "error"
  message: string
  created_at: number
}

export type ArchiveMode = "full" | "resume" | "incremental"

export const JOB_TYPE_LABEL: Record<string, string> = {
  archive_posts: "全站主帖归档",
  archive_auto_group: "归档自动分组",
}

export const ARCHIVE_MODE_LABEL: Record<ArchiveMode, string> = {
  full: "全量",
  resume: "续跑",
  incremental: "增量",
}

export function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABEL[type] ?? type
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "等待",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  interrupted: "中断",
  aborted: "已停止",
}

export interface ArchiveStatus {
  total: number
  maxTid: string | null
  cursor: {
    site: string
    next_mtid: string | null
    mode: string
    status: "idle" | "running" | "interrupted" | "done"
    pages: number
    updated_at: number
  } | null
}

/** 从 result 拼可读进度/结果摘要 */
export function formatJobProgress(
  result: Record<string, unknown> | null | undefined
): string {
  if (!result) return ""
  const parts: string[] = []
  const mode = result.mode
  if (mode === "full" || mode === "resume" || mode === "incremental") {
    parts.push(ARCHIVE_MODE_LABEL[mode])
  }
  if (typeof result.pages === "number") parts.push(`${result.pages} 页`)
  if (typeof result.inserted === "number") parts.push(`${result.inserted} 新增`)
  if (typeof result.updated === "number") parts.push(`${result.updated} 更新`)
  if (typeof result.groupsUpserted === "number") {
    parts.push(`${result.groupsUpserted} 组`)
  }
  if (typeof result.membersLinked === "number") {
    parts.push(`${result.membersLinked} 成员`)
  }
  if (typeof result.scanned === "number" && result.groupsUpserted != null) {
    parts.push(`扫 ${result.scanned}`)
  }
  if (typeof result.nextMtid === "string" && result.nextMtid) {
    parts.push(`游标 ${result.nextMtid}`)
  }
  return parts.join(" · ")
}

export async function getArchiveStatus(site = "1"): Promise<ArchiveStatus> {
  const res = await fetch(`${api.meArchiveStatus}?site=${site}`)
  await throwIfNotOk(res)
  return (await res.json()) as ArchiveStatus
}

export function downloadBackup(): void {
  // 用 a[download] 触发浏览器保存，走同源 cookie/鉴权
  const a = document.createElement("a")
  a.href = api.meExport
  a.download = ""
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function formatJobDuration(job: Job): string {
  if (job.started_at == null) return "-"
  const end = job.finished_at ?? Date.now()
  const sec = Math.max(0, Math.round((end - job.started_at) / 1000))
  if (job.finished_at == null) {
    if (sec < 60) return `${sec}s`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}m${s > 0 ? `${s}s` : ""}`
  }
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m${s}s` : `${m}m`
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
}

export async function startJob(
  type: string,
  payload?: Record<string, unknown>
): Promise<Job> {
  const res = await fetch(api.meJobs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload: payload ?? {} }),
  })
  await throwIfNotOk(res)
  const json = (await res.json()) as { job: Job }
  return json.job
}

export async function listJobs(opts?: {
  type?: string
  status?: string
}): Promise<Job[]> {
  const params = new URLSearchParams()
  if (opts?.type) params.set("type", opts.type)
  if (opts?.status) params.set("status", opts.status)
  const qs = params.toString()
  const res = await fetch(`${api.meJobs}${qs ? `?${qs}` : ""}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { items: Job[] }
  return json.items
}

export async function getJob(id: number): Promise<Job> {
  const res = await fetch(`${api.meJobs}/${id}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { job: Job }
  return json.job
}

export async function getJobLogs(
  id: number,
  opts?: { level?: string; order?: "asc" | "desc"; limit?: number }
): Promise<JobLog[]> {
  const params = new URLSearchParams()
  if (opts?.level) params.set("level", opts.level)
  if (opts?.order) params.set("order", opts.order)
  if (opts?.limit) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const res = await fetch(`${api.meJobs}/${id}/logs${qs ? `?${qs}` : ""}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as { items: JobLog[] }
  return json.items
}

export async function stopJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/stop`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function deleteJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}`, { method: "DELETE" })
  await throwIfNotOk(res)
}

export async function clearFinishedJobs(): Promise<number> {
  const res = await fetch(api.meJobs, { method: "DELETE" })
  await throwIfNotOk(res)
  const json = (await res.json()) as { removed: number }
  return json.removed
}

/** 轮询间隔持久化（localStorage） */
const POLL_MS_KEY = "purifier:jobs:pollMs"
const POLL_OPTIONS = [1000, 1500, 2000, 5000, 10000] as const

export function getPollMs(): number {
  try {
    const raw = Number(localStorage.getItem(POLL_MS_KEY))
    return POLL_OPTIONS.includes(raw as (typeof POLL_OPTIONS)[number])
      ? raw
      : 1500
  } catch {
    // 隐私模式/配额：静默，用默认值
    return 1500
  }
}

export function setPollMs(ms: number): void {
  if (POLL_OPTIONS.includes(ms as (typeof POLL_OPTIONS)[number])) {
    try {
      localStorage.setItem(POLL_MS_KEY, String(ms))
    } catch {
      // 隐私模式/配额：静默，仅内存态生效
    }
  }
}

export { POLL_OPTIONS }
