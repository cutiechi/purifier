import { describe, expect, test } from "bun:test"
import { searchSortKey } from "@workspace/core"
import { groupKeyFromTitle } from "@/lib/groups"
import { mergeItemKey, toMeListItems } from "@/lib/merge-search"

describe("toMeListItems", () => {
  test("映射 kind/site/id/title", () => {
    const items = toMeListItems([
      { site: "1", kind: "post", link: { index: 1, title: "帖子", tid: "10" } },
      { site: "2", kind: "book", link: { index: 1, title: "书", tid: "20" } },
    ])
    expect(items).toEqual([
      { kind: "post", site: "1", id: "10", title: "帖子" },
      { kind: "book", site: "2", id: "20", title: "书" },
    ])
  })
})

describe("mergeItemKey", () => {
  test("跨站同 tid 不撞", () => {
    expect(mergeItemKey({ site: "1", id: "12345" })).not.toBe(
      mergeItemKey({ site: "2", id: "12345" })
    )
  })
})

describe("searchSortKey 与分组键同源", () => {
  // fixture 与 title-parse.test.ts 的原始输入一一对应
  const fixtures = [
    "〖警花少妇白艳妮〗１－５８",
    "【白雪仙尘录】０１-３４_作者_asd223152",
    "【情动】_（０１－４２完结）_作_者：梓妃渔",
    "〖朱颜血〗（全）ｂｙ恶魔岛诸位",
    "〖短篇合集〗by黑暗",
    "_【勾引】（００１－０６８完结）作_者：微微",
    "_★《大航海时代加强版》１～４部４章",
    "[贺岁]【万圣惊魂】_(完)_顽童本色[原创]",
    "【搜神记顿丘魅物】完沉木[原创]",
    "【暗黑破坏神之少年德鲁伊】1-3[小小书童_原创]",
  ]
  test("真实论坛标题上服务端排序键 === 前端分组键", () => {
    for (const t of fixtures) {
      expect(searchSortKey(t)).toBe(groupKeyFromTitle(t))
    }
  })
})
