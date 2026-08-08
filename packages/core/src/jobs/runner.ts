import { ExtractorError } from "../extractor"
import type { Store } from "../storage/store"
import type { Job } from "../storage/types"
import type { JobHandler, JobContext, JobResult } from "./handler"

export class JobRunner {
  private running = new Map<number, AbortController>()

  constructor(
    private store: Store,
    private handlers: Map<string, JobHandler> = new Map()
  ) {}

  register(h: JobHandler): void {
    this.handlers.set(h.type, h)
  }

  async start(type: string, payload?: Record<string, unknown>): Promise<Job> {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new ExtractorError("unknown job type", 400)
    }
    if (this.store.hasRunningOfType(type)) {
      throw new ExtractorError("job already running", 409)
    }
    const job = this.store.createJob(type, payload ?? null)
    const ok = this.store.markRunning(job.id)
    if (!ok) {
      // 行已不在 pending（异常路径）：兜底转 failed，避免悬挂 pending
      this.store.markFinished(job.id, "failed", null, "failed to mark running")
      throw new ExtractorError("failed to start job", 500)
    }
    const controller = new AbortController()
    this.running.set(job.id, controller)
    // 不 await：后台跑，立即返回 running job；挂 catch 防未处理 rejection
    void this.runJob(job.id, handler, payload ?? {}, controller.signal).catch(
      (err) => {
        console.error(`[jobs] runJob ${job.id} unhandled:`, err)
      }
    )
    return this.store.getJob(job.id)!
  }

  /** 触发 abort；返回是否命中在跑的 job。真正改 status 由 runJob finally 处理 */
  stop(jobId: number): boolean {
    const controller = this.running.get(jobId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /** 进程启动时调：崩溃残留的 running/pending 标 interrupted */
  recoverOnStartup(): void {
    this.store.markStaleJobsInterrupted()
  }

  private async runJob(
    jobId: number,
    handler: JobHandler,
    payload: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    const ctx: JobContext = {
      jobId,
      payload,
      signal,
      log: (level, message) => this.store.appendJobLog(jobId, level, message),
      reportProgress: (progress) => this.store.setJobResult(jobId, progress),
    }
    let status: "succeeded" | "failed" | "aborted" = "succeeded"
    let result: JobResult | null = null
    let error: string | null = null
    try {
      result = await handler.run(ctx)
      if (signal.aborted) status = "aborted"
    } catch (err) {
      status = "failed"
      error = err instanceof Error ? err.message : String(err)
      ctx.log("error", `job failed: ${error}`)
    } finally {
      this.running.delete(jobId)
      try {
        this.store.markFinished(jobId, status, result, error)
      } catch (finalizeErr) {
        console.error(`[jobs] markFinished ${jobId} failed:`, finalizeErr)
        try {
          this.store.markFinished(
            jobId,
            "failed",
            null,
            "finalize failed"
          )
        } catch (e2) {
          console.error(`[jobs] markFinished fallback ${jobId} failed:`, e2)
        }
      }
    }
  }
}
