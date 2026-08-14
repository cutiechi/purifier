export interface JobContext {
  jobId: number
  log(level: "info" | "warn" | "error", message: string): void
  /** 运行中写入中间进度到 jobs.result，供列表轮询展示 */
  reportProgress(progress: JobResult): void
  signal: AbortSignal
  payload: Record<string, unknown>
  /**
   * 暂停检查点：未暂停直通；暂停则挂起直到 resume 或 abort。
   * abort 时 resolve 不抛（与 sleep 协作取消一致），循环随后看 signal.aborted 退出。
   */
  checkpoint(): Promise<void>
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
