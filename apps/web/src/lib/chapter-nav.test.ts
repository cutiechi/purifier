import { describe, expect, test } from "bun:test"
import { extractBodyChapterLinks, extractChapterNeighbors } from "./chapter-nav"

describe("extractChapterNeighbors", () => {
  test("pre 外「下一章」走 contentLinks（extractor.test.ts 夹具同构）", () => {
    const links = [{ tid: "999", title: "下一章", index: 1 }]
    const res = extractChapterNeighbors(links, [])
    expect(res.next).toEqual({ tid: "999", title: "下一章" })
    expect(res.prev).toBeUndefined()
  })

  test("正文内「上一章」走 bodyLinks", () => {
    const body = [{ tid: "100", title: "上一章" }]
    const res = extractChapterNeighbors([], body)
    expect(res.prev).toEqual({ tid: "100", title: "上一章" })
  })

  test("同侧多候选：body 优先于 contentLinks", () => {
    const links = [{ tid: "1", title: "下一章" }]
    const body = [{ tid: "2", title: "下一章" }]
    const res = extractChapterNeighbors(links, body)
    expect(res.next).toEqual({ tid: "2", title: "下一章" })
  })

  test("目录/返回目录不命中", () => {
    const links = [
      { tid: "3", title: "目录" },
      { tid: "4", title: "返回目录" },
    ]
    expect(extractChapterNeighbors(links, [])).toEqual({})
  })

  test("两侧都无 → {}", () => {
    const links = [{ tid: "5", title: "第一章 开始" }]
    expect(extractChapterNeighbors(links, [])).toEqual({})
  })
})

describe("extractBodyChapterLinks", () => {
  test("解析清洗后 HTML 的站内链接", () => {
    const html =
      '<p>正文</p><a href="/read/100">上一章</a><a href="/read/101?bm=2">下一章</a>'
    expect(extractBodyChapterLinks(html)).toEqual([
      { tid: "100", title: "上一章" },
      { tid: "101", title: "下一章" },
    ])
  })

  test("外链与空标题忽略", () => {
    const html =
      '<a href="https://example.com/x">外链</a><a href="/read/102"></a>'
    expect(extractBodyChapterLinks(html)).toEqual([])
  })
})
