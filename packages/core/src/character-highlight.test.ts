import { describe, expect, test } from "bun:test"
import {
  characterHighlight,
  normalizeCharacterName,
} from "./character-highlight"
import {
  LEGACY_SLOT_HUE,
  clampHue,
  flattenClusterMarks,
  isHue,
  pickHue,
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
      { name: "王小", hue: LEGACY_SLOT_HUE[0] ?? 0 },
      { name: "王小明", hue: LEGACY_SLOT_HUE[1] ?? 1 },
    ])
    expect(out).toContain(
      '<mark class="character-mark" style="--character-mark-h: 160">王小明</mark>'
    )
    expect(out).not.toMatch(/style="--character-mark-h: 85">王小<\/mark>明/)
  })

  test("does not break anchors", () => {
    const html = '<p>见<a href="/read/1">王芳</a>来</p>'
    const out = characterHighlight(html, [
      { name: "王芳", hue: LEGACY_SLOT_HUE[2] ?? 2 },
    ])
    expect(out).toBe(
      '<p>见<a href="/read/1"><mark class="character-mark" style="--character-mark-h: 220">王芳</mark></a>来</p>'
    )
  })

  test("name is never parsed as HTML / does not match escaped entities", () => {
    // DOMPurify 后文本是实体；选区 name 是未转义字面量 → 不匹配（期望）
    const out = characterHighlight("<p>x&lt;/mark&gt;y</p>", [
      { name: "</mark>", hue: LEGACY_SLOT_HUE[0] ?? 0 },
    ])
    expect(out).toBe("<p>x&lt;/mark&gt;y</p>")

    const out2 = characterHighlight("<p>a&quot;b</p>", [
      { name: 'a"b', hue: LEGACY_SLOT_HUE[0] ?? 0 },
    ])
    expect(out2).toBe("<p>a&quot;b</p>")

    const out3 = characterHighlight("<p>a&lt;b</p>", [
      { name: "a<b", hue: LEGACY_SLOT_HUE[0] ?? 0 },
    ])
    expect(out3).toBe("<p>a&lt;b</p>")
    expect(out3.includes("<mark")).toBe(false)
  })

  test("safe wrap for plain CJK names", () => {
    const out = characterHighlight("<p>你好甲世界</p>", [
      { name: "甲", hue: LEGACY_SLOT_HUE[0] ?? 0 },
    ])
    expect(out).toBe(
      '<p>你好<mark class="character-mark" style="--character-mark-h: 85">甲</mark>世界</p>'
    )
  })

  test("clamps hue in style attribute", () => {
    const out = characterHighlight("<p>甲</p>", [{ name: "甲", hue: 400 }])
    expect(out).toContain('style="--character-mark-h: 40"')
    expect(out).not.toMatch(/400/)
  })
})

test("pickHue empty is 85", () => {
  expect(pickHue([])).toBe(85)
})

test("pickHue maximizes min circular distance", () => {
  expect(pickHue([85])).toBe(265)
  const a = pickHue([85, 265])
  expect(a).not.toBe(85)
  expect(a).not.toBe(265)
})

test("pickHue dedupes used", () => {
  expect(pickHue([85, 85])).toBe(pickHue([85]))
})

test("isHue and clampHue", () => {
  expect(isHue(0)).toBe(true)
  expect(isHue(359)).toBe(true)
  expect(isHue(360)).toBe(false)
  expect(isHue(1.5)).toBe(false)
  expect(isHue("1")).toBe(false)
  expect(clampHue(400)).toBe(40)
  expect(clampHue(-1)).toBe(359)
})

test("flattenClusterMarks copies hue onto each name", () => {
  expect(
    flattenClusterMarks([
      { id: 1, hue: 85, names: ["林远", "少爷"] },
      { id: 2, hue: 160, names: ["乙"] },
    ])
  ).toEqual([
    { name: "林远", hue: 85 },
    { name: "少爷", hue: 85 },
    { name: "乙", hue: 160 },
  ])
})

test("LEGACY_SLOT_HUE maps v1 slots", () => {
  expect(LEGACY_SLOT_HUE).toEqual([85, 160, 220, 300, 30, 350])
})
