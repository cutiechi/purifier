import { describe, expect, test } from "bun:test"
import {
  findQuoteIndex,
  normalizeBookmarkNote,
  normalizeBookmarkQuote,
} from "./bookmarks"

describe("normalizeBookmarkQuote", () => {
  test("trims, collapses whitespace including newlines", () => {
    expect(normalizeBookmarkQuote("  甲\n乙\t丙  ")).toBe("甲 乙 丙")
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

describe("findQuoteIndex", () => {
  test("first occurrence", () => {
    expect(findQuoteIndex("aaa bbb aaa", "aaa")).toBe(0)
  })
  test("miss is -1", () => {
    expect(findQuoteIndex("hello", "zzz")).toBe(-1)
  })
})
