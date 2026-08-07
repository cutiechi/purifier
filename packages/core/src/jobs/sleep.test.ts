import { describe, expect, test } from "bun:test"
import { sleep } from "./sleep"

describe("sleep", () => {
  test("正常等待后 resolve", async () => {
    const start = Date.now()
    await sleep(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(20)
  })

  test("abort 立即 resolve，不等完整 delay", async () => {
    const controller = new AbortController()
    const start = Date.now()
    const p = sleep(1000, controller.signal)
    controller.abort()
    await p
    expect(Date.now() - start).toBeLessThan(100)
  })

  test("已 aborted 的 signal 立即 resolve", async () => {
    const controller = new AbortController()
    controller.abort()
    const start = Date.now()
    await sleep(1000, controller.signal)
    expect(Date.now() - start).toBeLessThan(50)
  })
})
