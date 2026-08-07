import { describe, expect, test } from "bun:test"
import { groupBooks } from "@/lib/book-groups"
import {
  groupKeyFromTitle,
  groupSearchTitle,
  pickGroupMeta,
} from "@/lib/groups"

describe("groupKeyFromTitle", () => {
  test("与折叠分组同源：书名号/方括号/裸书名同 key", () => {
    expect(groupKeyFromTitle("【马屌少年】（1）作者：小明")).toBe(
      groupKeyFromTitle("《马屌少年》（2）")
    )
    expect(groupKeyFromTitle("马屌少年")).toBe("马屌少年")
  })

  test("章节标记剥离后并入同 key", () => {
    expect(groupKeyFromTitle("马屌少年（1）作者：小明")).toBe(
      groupKeyFromTitle("马屌少年（完）")
    )
  })

  test("与 groupBooks 对同一 raw 列表产出的 key 一致", () => {
    const raws = [
      "【马屌少年】（1）作者：小明",
      "马屌少年（2）",
      "《为妻子种下一片森林》（13）",
    ]
    const grouped = groupBooks(
      raws.map((t, i) => ({ title: t, tid: String(i) })),
      (l) => l.title,
      (l) => l.tid
    )
    for (const g of grouped) {
      if (g.type === "group") {
        expect(groupKeyFromTitle(g.items[0]!.title)).toBe(g.key)
      }
    }
  })
})

describe("groupSearchTitle", () => {
  test("剥离尾随章节标记", () => {
    expect(groupSearchTitle("马屌少年（2）作者：小明")).toBe("马屌少年")
    expect(groupSearchTitle("【马屌少年】（完）")).toBe("马屌少年")
  })
})

describe("pickGroupMeta", () => {
  test("取首个非空作者/题材", () => {
    const meta = pickGroupMeta([
      { title: "A（1）" },
      { title: "A（2）作者：小明" },
      { title: "A（3）『都市』" },
    ])
    expect(meta).toEqual({ author: "小明", genre: "都市" })
  })
})
