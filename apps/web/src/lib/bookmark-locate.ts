import { collapseText, findQuoteIndex } from "@workspace/core/bookmarks"

function rangeFromOffset(
  root: Element,
  start: number,
  length: number
): Range | null {
  const end = start + length
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.data.length
    const next = pos + len
    if (!startNode && next > start) {
      startNode = node
      startOff = start - pos
    }
    if (!endNode && next >= end) {
      endNode = node
      endOff = end - pos
      break
    }
    pos = next
    node = walker.nextNode() as Text | null
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOff)
  range.setEnd(endNode, endOff)
  return range
}

export function scrollToQuote(root: Element, quote: string): boolean {
  const { text, starts, ends } = collapseText(root.textContent ?? "")
  const idx = findQuoteIndex(text, quote)
  if (idx < 0) return false
  // 折叠文本与 raw 逐码元对齐：起止都映射回 raw 偏移
  // （quote 无首尾空白，idx 必落在非空白字符上）
  const rawStart = starts[idx]
  const rawEnd = ends[idx + quote.length - 1]
  const range = rangeFromOffset(root, rawStart, rawEnd - rawStart)
  if (!range) return false
  const el =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  el?.scrollIntoView({ block: "center", behavior: "instant" })
  return true
}

export function scrollToProgress(progress: number): void {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return
  window.scrollTo(0, Math.round(Math.max(0, Math.min(1, progress)) * max))
}
