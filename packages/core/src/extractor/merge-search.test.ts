import { describe, expect, test } from "bun:test"
import { mergeSearchPages, searchSortKey, SITE_KIND } from "./merge-search"
import type { CategoryPage } from "./types"

function page(
  site: "1" | "2",
  titles: Array<[title: string, tid: string]>,
  nextPage: number | null
): { site: "1" | "2"; page: CategoryPage } {
  return {
    site,
    page: {
      category: "q",
      links: titles.map(([title, tid]) => ({ index: 0, title, tid })),
      nextPage,
    },
  }
}

describe("searchSortKey", () => {
  test("剥外层装饰与作者后缀", () => {
    expect(
      searchSortKey("【马屌少年】（2）作者：小明『都市』")
    ).toBe("马屌少年")
  })

  test("剥尾随章节标记（完）", () => {
    expect(
      searchSortKey("马屌少年（完）作者：小明")
    ).toBe("马屌少年")
  })

  test(
    "正文数字保留（第2部 < 第10部，Collator numeric 序）",
    () => {
      const a = searchSortKey("凡人修仙传第2部")
      const b = searchSortKey("凡人修仙传第10部")
      // key 是归一化字符串，numeric 序是 Collator 的职责，
      // 不能对 key 用 `<`
      expect(
        new Intl.Collator("zh", { numeric: true }).compare(a, b)
      ).toBeLessThan(0)
    }
  )
})

describe("mergeSearchPages", () => {
  test("两站合并 + 标题排序 + 平局 site1 在前", () => {
    const r = mergeSearchPages([
      page("1", [["【乙】", "1"]], 2),
      page("2", [["甲", "a"], ["乙", "b"]], 2),
    ])
    // link.title 保持上游原始标题（设计：展示/排序前才
    // parse）；排序键使「【乙】」「乙」同键平局
    expect(r.items.map((i) => i.link.title)).toEqual([
      "甲",
      "【乙】",
      "乙",
    ])
    // 同排序键稳定序：site1 先于 site2
    expect(r.items[1]!.site).toBe("1")
    expect(r.items[2]!.site).toBe("2")
    expect(r.nextPage).toBe(2)
  })

  test("nextPage 取 OR：一站耗尽另一站还有 → 仍前进", () => {
    const r = mergeSearchPages([
      page("1", [["A", "1"]], null),
      page("2", [["B", "2"]], 2),
    ])
    expect(r.nextPage).toBe(2)
  })

  test("跨站同 tid 两条都保留，site 字段区分", () => {
    const r = mergeSearchPages([
      page("1", [["凡人", "12345"]], null),
      page("2", [["凡人", "12345"]], null),
    ])
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => `${i.site}:${i.link.tid}`)).toEqual([
      "1:12345",
      "2:12345",
    ])
  })

  test("单站失败 → errors 透传，另一站结果保留", () => {
    const r = mergeSearchPages([
      page("1", [["A", "1"]], null),
      { site: "2", page: null, error: "upstream error: 502" },
    ])
    expect(r.items).toHaveLength(1)
    expect(r.errors).toEqual({ "2": "upstream error: 502" })
  })

  test("两站全挂 → items 空、errors 两键", () => {
    const r = mergeSearchPages([
      { site: "1", page: null, error: "boom" },
      { site: "2", page: null, error: "bam" },
    ])
    expect(r.items).toEqual([])
    expect(r.errors).toEqual({ "1": "boom", "2": "bam" })
  })

  test("SITE_KIND 映射", () => {
    expect(SITE_KIND).toEqual({ "1": "post", "2": "book" })
  })
})
