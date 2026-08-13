import { describe, expect, test } from "bun:test"
import {
  collapseText,
  findQuoteIndex,
  normalizeBookmarkNote,
  normalizeBookmarkQuote,
} from "./bookmarks"

describe("normalizeBookmarkQuote", () => {
  test("trims, collapses whitespace including newlines", () => {
    expect(normalizeBookmarkQuote("  甲\n乙\t丙  ")).toBe("甲 乙 丙")
  })
  test("collapses NBSP (U+00A0)", () => {
    expect(normalizeBookmarkQuote("甲\u00a0乙")).toBe("甲 乙")
  })
  test("empty after normalize is null", () => {
    expect(normalizeBookmarkQuote("  \n\t  ")).toBeNull()
    expect(normalizeBookmarkQuote("")).toBeNull()
  })
  test("truncates to 200 code points", () => {
    const q = normalizeBookmarkQuote("你".repeat(201))
    expect(q).toBe("你".repeat(200))
  })
})

describe("normalizeBookmarkNote", () => {
  test("empty stays empty", () => {
    expect(normalizeBookmarkNote("  ")).toBe("")
  })
  test("trims and truncates to 80", () => {
    expect(normalizeBookmarkNote("  hi  ")).toBe("hi")
    expect(normalizeBookmarkNote("x".repeat(81)).length).toBe(80)
  })
})

describe("collapseText", () => {
  test("first-occurrence hit maps to raw offsets", () => {
    const { text, starts, ends } = collapseText("ab  cd ab")
    expect(text).toBe("ab cd ab")
    const idx = findQuoteIndex(text, "ab")
    expect(idx).toBe(0)
    expect(starts[idx]).toBe(0)
    expect(ends[idx + 1]).toBe(2)
  })
  test("folds NBSP and multi-space runs into one space", () => {
    const { text, starts, ends } = collapseText("甲\u00a0\u00a0乙")
    expect(text).toBe("甲 乙")
    expect(starts).toEqual([0, 1, 3])
    expect(ends).toEqual([1, 3, 4])
  })
  test("folds whitespace runs spanning multiple text nodes", () => {
    // 块边界 \n 与下一文本节点前导空格来自不同节点，仍合并为一个空白 run
    const { text, starts, ends } = collapseText("a\n   b")
    expect(text).toBe("a b")
    expect(starts[1]).toBe(1)
    expect(ends[1]).toBe(5)
  })
  test("quote at start and end of haystack", () => {
    const { text, starts, ends } = collapseText("  甲 乙  ")
    expect(text).toBe("甲 乙")
    expect(findQuoteIndex(text, "甲")).toBe(0)
    expect(starts[0]).toBe(2)
    expect(ends[0]).toBe(3)
    expect(findQuoteIndex(text, "乙")).toBe(2)
    expect(starts[2]).toBe(4)
    expect(ends[2]).toBe(5)
  })
  test("collapse parity with normalizeBookmarkQuote", () => {
    const cases: Array<[raw: string, expected: string]> = [
      ["  甲\n乙\t丙  ", "甲 乙 丙"],
      ["甲\u00a0乙", "甲 乙"],
      ["a\u00a0\u00a0b", "a b"],
      ["x", "x"],
    ]
    for (const [raw, expected] of cases) {
      expect(normalizeBookmarkQuote(raw)).toBe(expected)
      expect(collapseText(raw).text).toBe(expected)
    }
  })
})

describe("findQuoteIndex", () => {
  test("first occurrence", () => {
    expect(findQuoteIndex("aaa bbb aaa", "aaa")).toBe(0)
  })
  test("miss is -1", () => {
    expect(findQuoteIndex("hello", "zzz")).toBe(-1)
  })
})
