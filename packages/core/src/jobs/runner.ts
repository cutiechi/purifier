import { ExtractorError } from "../extractor"
import type { Store } from "../storage/store"
import type { Job } from "../storage/types"
import type { JobHandler, JobContext, JobResult } from "./handler"
import { sleep } from "./sleep"

export class JobRunner {
  private running = new Map<number, AbortController>()
  /** 同进程内运行中 type 集合：与 DB 检查互为补充，堵住 TOCTOU 双启动 */
  private runningTypes = new Set<string>()

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
    // 先查内存再查 DB（本进程内 start 同步段原子，两个并发 start 不会同时通过）
    if (this.runningTypes.has(type) || this.store.hasRunningOfType(type)) {
      throw new ExtractorError("job already running", 409)
    }
    const job = this.store.createJob(type, payload ?? null)
    const ok = this.store.markRunning(job.id)
    if (!ok) {
      // 行已不在 pending（异常路径）：兜底转 failed，避免悬挂 pending
      this.store.markFinished(job.id, "failed", null, "failed to mark running")
      throw new ExtractorError("failed to start job", 500)
    }
    this.runningTypes.add(type)
    const controller = new AbortController()
    this.running.set(job.id, controller)
    // 推迟到下一个 macrotask 再跑：
    // 1) start() 的 HTTP 响应能先写出
    // 2) 全同步 handler（如 auto_group）不会在 start 调用栈里堵死事件循环
    const jobId = job.id
    const payloadCopy = payload ?? {}
    setTimeout(() => {
      void this.runJob(jobId, handler, payloadCopy, controller.signal).catch(
        (err) => {
          console.error(`[jobs] runJob ${jobId} unhandled:`, err)
        }
      )
    }, 0)
    return this.store.getJob(job.id)!
  }

  /** 触发 abort；返回是否命中在跑的 job。真正改 status 由 runJob finally 处理 */
  stop(jobId: number): boolean {
    const controller = this.running.get(jobId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /** 进程关闭：abort 全部在跑任务，让 runJob finally 尽快收尾 */
  abortAll(): void {
    for (const controller of this.running.values()) {
      controller.abort()
    }
  }

  /**
   * 等待在跑任务全部收尾（running 清空，即 runJob finally 已执行完）；
   * 超时返回 false。供进程优雅关闭用：等 markFinished / 游标写完再关库。
   */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.running.size > 0) {
      if (Date.now() >= deadline) return false
      await sleep(50)
    }
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
      // 再让出一拍，给并发 HTTP 请求机会
      await sleep(0)
      if (signal.aborted) {
        status = "aborted"
        return
      }
      result = await handler.run(ctx)
      if (signal.aborted) status = "aborted"
    } catch (err) {
      status = "failed"
      error = err instanceof Error ? err.message : String(err)
      ctx.log("error", `job failed: ${error}`)
    } finally {
      this.running.delete(jobId)
      this.runningTypes.delete(handler.type)
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
