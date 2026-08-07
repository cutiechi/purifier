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
  const raw = Number(localStorage.getItem(POLL_MS_KEY))
  return POLL_OPTIONS.includes(raw as (typeof POLL_OPTIONS)[number])
    ? raw
    : 1500
}

export function setPollMs(ms: number): void {
  if (POLL_OPTIONS.includes(ms as (typeof POLL_OPTIONS)[number])) {
    localStorage.setItem(POLL_MS_KEY, String(ms))
  }
}

export { POLL_OPTIONS }
