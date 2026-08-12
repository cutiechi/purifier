export type { CharacterName, CharacterScope } from "./storage/types"

export const COLOR_COUNT = 6

export function colorSlot(colorIndex: number): number {
  // color_index 来自 COALESCE(MAX,-1)+1，恒 ≥ 0
  return colorIndex % COLOR_COUNT
}

export function normalizeCharacterName(raw: string): string | null {
  if (/[\n\t]/.test(raw)) return null
  const name = raw.trim()
  if (name.length < 1 || name.length > 32) return null
  return name
}

/**
 * 输入约定：已 DOMPurify 净化的 HTML；文本节点中无裸 `<`
 *（`<` 已是 `&lt;`），因此用 `/(<[^>]*>)/` 切标签安全。
 * 复杂度约 O(正文长度 × 人名数 × 名字长度)；当前章节量级可接受，
 * 超长卡顿可后续换 Aho-Corasick。
 * 输出仅额外插入 <mark class="character-mark character-mark--N">；
 * 不把 name 写入属性。
 */
export function characterHighlight(
  html: string,
  characters: { name: string; colorIndex: number }[]
): string {
  const names = characters
    .filter((c) => c.name.length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.name.length - a.name.length || a.name.localeCompare(b.name)
    )
  if (!names.length) return html

  const parts = html.split(/(<[^>]*>)/)
  return parts
    .map((part) => {
      if (!part || part.startsWith("<")) return part
      return highlightText(part, names)
    })
    .join("")
}

function highlightText(
  text: string,
  names: { name: string; colorIndex: number }[]
): string {
  const taken = new Array<boolean>(text.length).fill(false)
  type Hit = { start: number; end: number; slot: number }
  const hits: Hit[] = []

  for (const { name, colorIndex } of names) {
    let from = 0
    while (from <= text.length - name.length) {
      const i = text.indexOf(name, from)
      if (i < 0) break
      const end = i + name.length
      let overlap = false
      for (let j = i; j < end; j++) {
        if (taken[j]) {
          overlap = true
          break
        }
      }
      if (!overlap) {
        for (let j = i; j < end; j++) taken[j] = true
        hits.push({ start: i, end, slot: colorSlot(colorIndex) })
      }
      from = i + 1
    }
  }

  hits.sort((a, b) => a.start - b.start)
  let out = ""
  let cursor = 0
  for (const h of hits) {
    out += text.slice(cursor, h.start)
    out += `<mark class="character-mark character-mark--${h.slot}">`
    out += text.slice(h.start, h.end)
    out += `</mark>`
    cursor = h.end
  }
  out += text.slice(cursor)
  return out
}
