import { describe, expect, test } from "bun:test"
import { Cool18Extractor } from "./extractor"
import { ExtractorError } from "./types"

const ex = new Cool18Extractor()

describe("parseReplies", () => {
  test("builds reply tree by uptid", () => {
    const raw = JSON.stringify([
      { tid: "1", uptid: "0", username: "作者" },
      { tid: "2", uptid: "1", username: "甲" },
      { tid: "3", uptid: "1", username: "乙" },
      { tid: "4", uptid: "2", username: "丙" },
    ])
    const tree = ex.parseReplies(raw, "1")
    // 楼主帖（uptid "0"）不构成回复节点；根为 uptid === tid 的顶层回复
    expect(tree).toHaveLength(2)
    expect(tree.map((n) => n.tid)).toEqual(["2", "3"])
    expect(tree[0]?.children.map((c) => c.tid)).toEqual(["4"])
  })

  test("empty array → []", () => {
    expect(ex.parseReplies("[]", "1")).toEqual([])
  })

  test("non-array json → []", () => {
    expect(ex.parseReplies('{"a":1}', "1")).toEqual([])
  })

  test("invalid json throws 502 ExtractorError", () => {
    expect(() => ex.parseReplies("not json", "1")).toThrow(ExtractorError)
  })

  test("strips html from username/subject and fills defaults", () => {
    const tree = ex.parseReplies(
      JSON.stringify([
        {
          tid: "2",
          uptid: "1",
          username: "<b>甲</b>",
          subject: "支持<br>楼主",
        },
      ]),
      "1"
    )
    expect(tree[0]?.username).toBe("甲")
    expect(tree[0]?.subject).toBe("支持楼主")
    expect(tree[0]?.rootid).toBe("1")
    expect(tree[0]?.size).toBe(0)
  })
})
