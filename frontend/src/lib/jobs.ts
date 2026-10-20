import { api } from "@/lib/routes"

/**
 * 后端 model.JobStatus 的实际取值（见 backend/internal/model/model.go）。
 * 聚合值 `active` = running|paused|pending、`finished` = finished|error 由
 * /api/me/jobs 的 status 参数识别，不要与下面的单个状态混用。
 */
export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "finished"
  | "error"
  | "cancelled"

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "finished",
  "error",
  "cancelled",
]

export function isTerminalJob(j: Job): boolean {
  return TERMINAL_JOB_STATUSES.includes(j.status)
}

export interface Job {
  id: number
  type: string
  status: JobStatus
  /** 后端以 JSON 字符串存储（model.Job.Payload *string），用 parseJobField 解析 */
  payload: string | null
  /** 同上；用 parseJobField 解析后再交给 formatJobProgress */
  result: string | null
  error: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

/** 解析后端以字符串承载的 JSON 字段（payload/result）；非法或空返回 null */
export function parseJobField(
  raw: string | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
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
  archive_posts: "论坛归档",
  archive_books: "书库归档",
  archive_auto_group: "自动分组",
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
  paused: "已暂停",
  finished: "已完成",
  error: "失败",
  cancelled: "已停止",
}

export interface ArchiveStatus {
  total: number
  maxTid: string | null
  cursor: {
    site: string
    next_mtid: string | null
    mode: string
    /** 后端 SetArchiveCursor 实际写入：running|aborted|error|done（idle 为初始） */
    status: "idle" | "running" | "aborted" | "error" | "done"
    pages: number
    updated_at: number
  } | null
}

/** 从 result 拼可读进度/结果摘要（接受后端原始 JSON 字符串或已解析对象） */
export function formatJobProgress(
  result: string | Record<string, unknown> | null | undefined
): string {
  const parsed = typeof result === "string" ? parseJobField(result) : result
  if (!parsed) return ""
  const parts: string[] = []
  const mode = parsed.mode
  if (mode === "full" || mode === "resume" || mode === "incremental") {
    parts.push(ARCHIVE_MODE_LABEL[mode])
  }
  if (typeof parsed.pages === "number") parts.push(`${parsed.pages} 页`)
  if (typeof parsed.inserted === "number") parts.push(`${parsed.inserted} 新增`)
  if (typeof parsed.updated === "number") parts.push(`${parsed.updated} 更新`)
  if (typeof parsed.groupsUpserted === "number") {
    parts.push(`${parsed.groupsUpserted} 组`)
  }
  if (typeof parsed.membersLinked === "number") {
    parts.push(`${parsed.membersLinked} 成员`)
  }
  if (typeof parsed.scanned === "number" && parsed.groupsUpserted != null) {
    parts.push(`扫 ${parsed.scanned}`)
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

export type JobSortKey = "created_at" | "type" | "status" | "duration"

export async function listJobs(opts?: {
  type?: string
  status?: string
  page?: number
  limit?: number
  sort?: JobSortKey
  order?: "asc" | "desc"
}): Promise<{ items: Job[]; nextPage?: number; total: number }> {
  const params = new URLSearchParams()
  const page = Math.max(1, opts?.page ?? 1)
  const limit = opts?.limit ?? 20
  // 后端用 limit+offset 分页（无 page 参数）；nextPage 已由后端按 offset 换算
  params.set("limit", String(limit))
  params.set("offset", String((page - 1) * limit))
  if (opts?.type) params.set("type", opts.type)
  if (opts?.status) params.set("status", opts.status)
  if (opts?.sort) params.set("sort", opts.sort)
  if (opts?.order) params.set("order", opts.order)
  const res = await fetch(`${api.meJobs}?${params.toString()}`)
  await throwIfNotOk(res)
  const json = (await res.json()) as {
    items: Job[]
    nextPage?: number
    total?: number
  }
  return {
    items: json.items,
    nextPage: json.nextPage,
    total: typeof json.total === "number" ? json.total : 0,
  }
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

export async function pauseJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/pause`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function resumeJob(id: number): Promise<void> {
  const res = await fetch(`${api.meJobs}/${id}/resume`, { method: "POST" })
  await throwIfNotOk(res)
}

export async function deleteJobsMany(ids: number[]): Promise<number> {
  const res = await fetch(api.meJobs, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  await throwIfNotOk(res)
  const json = (await res.json()) as { removed: number }
  return json.removed
}
