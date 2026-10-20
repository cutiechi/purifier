import type { CharacterCluster, CharacterMark, CharacterScope } from "./types"

export type { CharacterCluster, CharacterMark, CharacterScope }

export function clampHue(hue: number): number {
  if (!Number.isFinite(hue)) return 85
  return ((Math.round(hue) % 360) + 360) % 360
}

export function flattenClusterMarks(
  clusters: CharacterCluster[]
): CharacterMark[] {
  return clusters.flatMap((c) => c.names.map((name) => ({ name, hue: c.hue })))
}

export function normalizeCharacterName(raw: string): string | null {
  if (/[\n\t]/.test(raw)) return null
  const name = raw.trim()
  if (name.length < 1 || name.length > 32) return null
  return name
}

export function characterHighlight(
  html: string,
  characters: CharacterMark[]
): string {
  const names = characters
    .filter((c) => c.name.length > 0)
    .slice()
    .sort(
      (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name)
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

function highlightText(text: string, names: CharacterMark[]): string {
  const taken = new Array<boolean>(text.length).fill(false)
  type Hit = { start: number; end: number; hue: number }
  const hits: Hit[] = []

  for (const { name, hue } of names) {
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
        hits.push({ start: i, end, hue: clampHue(hue) })
      }
      from = i + 1
    }
  }

  hits.sort((a, b) => a.start - b.start)
  let out = ""
  let cursor = 0
  for (const h of hits) {
    out += text.slice(cursor, h.start)
    out += `<mark class="character-mark" style="--character-mark-h: ${h.hue}">`
    out += text.slice(h.start, h.end)
    out += `</mark>`
    cursor = h.end
  }
  out += text.slice(cursor)
  return out
}
