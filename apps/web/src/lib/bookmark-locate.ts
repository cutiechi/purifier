import { findQuoteIndex } from "@workspace/core/bookmarks"

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

/**
 * 把 raw 文本折叠成 normalizeBookmarkQuote 同款形态（trim + 连续空白折叠为单空格），
 * 同时记录每个折叠字符对应的 raw [start, end) UTF-16 偏移。空白 run 可跨文本节点
 * 延续（选区 toString 会在块边界插入 \n、双空格、制表符、U+00A0 等），整个 run
 * 折叠为一个空格，raw start = run 起点、raw end = run 终点。
 */
function collapseText(
  root: Element
): { text: string; starts: number[]; ends: number[] } {
  const raw = root.textContent ?? ""
  const text: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  // 空白 run 整体折叠为一个空格；其余逐码元保留（与 indexOf / quote.length 的码元语义一致）
  const re = /[\s\u00a0]+|[^\s\u00a0]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    text.push(/[\s\u00a0]/.test(m[0][0]) ? " " : m[0])
    starts.push(m.index)
    ends.push(m.index + m[0].length)
  }
  // 与 normalizeBookmarkQuote 一致：trim 首尾空白（折叠出的空格）
  while (text.length > 0 && text[0] === " ") {
    text.shift()
    starts.shift()
    ends.shift()
  }
  while (text.length > 0 && text[text.length - 1] === " ") {
    text.pop()
    starts.pop()
    ends.pop()
  }
  return { text: text.join(""), starts, ends }
}

export function scrollToQuote(root: Element, quote: string): boolean {
  const { text, starts, ends } = collapseText(root)
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
