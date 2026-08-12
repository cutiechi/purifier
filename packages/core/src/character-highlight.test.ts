import { describe, expect, test } from "bun:test"
import {
  COLOR_COUNT,
  characterHighlight,
  colorSlot,
  normalizeCharacterName,
} from "./character-highlight"

describe("normalizeCharacterName", () => {
  test("trims and rejects newlines/tabs/empty/overlong", () => {
    expect(normalizeCharacterName(" 甲 ")).toBe("甲")
    expect(normalizeCharacterName("甲\n乙")).toBeNull()
    expect(normalizeCharacterName("甲\t乙")).toBeNull()
    expect(normalizeCharacterName("   ")).toBeNull()
    expect(normalizeCharacterName("x".repeat(33))).toBeNull()
  })
})

describe("characterHighlight", () => {
  test("wraps longest name first", () => {
    const html = "<p>王小明和王小</p>"
    const out = characterHighlight(html, [
      { name: "王小", colorIndex: 0 },
      { name: "王小明", colorIndex: 1 },
    ])
    expect(out).toContain(
      '<mark class="character-mark character-mark--1">王小明</mark>'
    )
    expect(out).not.toMatch(/character-mark--0">王小<\/mark>明/)
  })

  test("does not break anchors", () => {
    const html = '<p>见<a href="/read/1">王芳</a>来</p>'
    const out = characterHighlight(html, [
      { name: "王芳", colorIndex: 2 },
    ])
    expect(out).toBe(
      '<p>见<a href="/read/1"><mark class="character-mark character-mark--2">王芳</mark></a>来</p>'
    )
  })

  test("name is never parsed as HTML / does not match escaped entities", () => {
    // DOMPurify 后文本是实体；选区 name 是未转义字面量 → 不匹配（期望）
    const out = characterHighlight("<p>x&lt;/mark&gt;y</p>", [
      { name: "</mark>", colorIndex: 0 },
    ])
    expect(out).toBe("<p>x&lt;/mark&gt;y</p>")

    const out2 = characterHighlight("<p>a&quot;b</p>", [
      { name: 'a"b', colorIndex: 0 },
    ])
    expect(out2).toBe("<p>a&quot;b</p>")

    const out3 = characterHighlight("<p>a&lt;b</p>", [
      { name: "a<b", colorIndex: 0 },
    ])
    expect(out3).toBe("<p>a&lt;b</p>")
    expect(out3.includes("<mark")).toBe(false)
  })

  test("safe wrap for plain CJK names", () => {
    const out = characterHighlight("<p>你好甲世界</p>", [
      { name: "甲", colorIndex: 0 },
    ])
    expect(out).toBe(
      '<p>你好<mark class="character-mark character-mark--0">甲</mark>世界</p>'
    )
  })

  test("colorSlot wraps", () => {
    expect(colorSlot(0)).toBe(0)
    expect(colorSlot(6)).toBe(0)
    expect(COLOR_COUNT).toBe(6)
  })
})
