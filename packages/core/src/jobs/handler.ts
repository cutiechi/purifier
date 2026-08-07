export interface JobContext {
  jobId: number
  log(level: "info" | "warn" | "error", message: string): void
  signal: AbortSignal
  payload: Record<string, unknown>
}

export interface JobResult {
  [key: string]: unknown
}

export interface JobHandler {
  /** 该 handler 处理的 job type */
  type: string
  /** 抛错 → Runner 标 failed；正常返回 → succeeded（除非 signal.aborted → aborted） */
  run(ctx: JobContext): Promise<JobResult>
}
