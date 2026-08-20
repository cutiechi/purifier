import { expect, test } from "bun:test"
import {
  extractCandidates,
  computeSimilarity,
  filterCandidates,
} from "./group-supplement"
import type { ReplyNode } from "@/components/reply-list"

function makeReply(overrides: Partial<ReplyNode> = {}): ReplyNode {
  return {
    tid: "1",
    uptid: "1",
    rootid: "1",
    uid: "1",
    username: "u",
    subject: "",
    dateline: "2024-01-01",
    size: 0,
    children: [],
    ...overrides,
  }
}

test("extractCandidates from links and subject text", () => {
  const replies: ReplyNode[] = [
    makeReply({
      tid: "100",
      subject: "Next chapter",
      links: [{ tid: "200", title: "Title 200" }],
    }),
    makeReply({
      tid: "101",
      subject: "See also tid=300 and 12345678",
    }),
  ]
  const sources = extractCandidates(replies)
  expect(sources.map((s) => s.tid).sort()).toEqual([
    "100",
    "101",
    "12345678",
    "200",
    "300",
  ])
  expect(sources.find((s) => s.tid === "200")?.sourceTitle).toBe("Title 200")
  expect(sources.find((s) => s.tid === "300")?.sourceTitle).toBe(
    "See also tid=300 and 12345678"
  )
  expect(sources.find((s) => s.tid === "100")?.sourceTitle).toBe("Next chapter")
})

test("computeSimilarity for chapter pairs", () => {
  const s1 = computeSimilarity("小说A 第一章", "小说A 第二章")
  expect(s1).toBeGreaterThan(0.5)

  const s2 = computeSimilarity("完全不同的标题", "另一个世界")
  expect(s2).toBeLessThan(0.3)

  const s3 = computeSimilarity("小说A 第一章", "小说A 第一章")
  expect(s3).toBe(1)
})

test("filterCandidates thresholds", () => {
  const current = "小说A 第一章"
  const candidates = [
    { tid: "1", title: "小说A 第二章" },
    { tid: "2", title: "小说B 第一章" },
    { tid: "3", title: "完全不相关" },
  ]
  const result = filterCandidates(current, candidates)
  expect(result.map((r) => r.tid)).toContain("1")
  expect(result.map((r) => r.tid)).toContain("2")
  expect(result.map((r) => r.tid)).not.toContain("3")
  expect(result.find((r) => r.tid === "1")?.checked).toBe(true)
})
