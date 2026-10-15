import type { ReplyNode } from "@/components/reply-list"

export interface CandidateItem {
  tid: string
  title: string
  score: number
  checked: boolean
}

const TID_RE = /tid=(\d+)/g
const NUMERIC_TID_RE = /\b\d{6,}\b/g
const DECORATIONS_RE = /[【】〖〗《》]/g
const CHAPTER_SUFFIX_RE = /[第\s]*[\d一二三四五六七八九十百千]+[章回节篇集卷]/g
const CONTINUATION_KEYWORDS = /续|下|next|后续|下章|下一章|下回|第二章|第三章/

export interface CandidateSource {
  tid: string
  /** 跟帖中关联的标题（link.title 或 subject），API 失败时 fallback 用 */
  sourceTitle: string
}

export function extractCandidates(replies: ReplyNode[]): CandidateSource[] {
  const map = new Map<string, string>()
  function walk(nodes: ReplyNode[]) {
    for (const node of nodes) {
      const subject = node.subject
      // 跟帖本身也可能是一个相关帖子
      if (node.tid && !map.has(node.tid)) {
        map.set(node.tid, subject)
      }
      // 优先取 link 里的标题，否则 fallback 到 subject
      const fallbackTitle = subject
      if (node.links) {
        for (const link of node.links) {
          if (link.tid) {
            const existing = map.get(link.tid)
            if (!existing || existing === link.tid) {
              map.set(link.tid, link.title || fallbackTitle)
            }
          }
        }
      }
      let m: RegExpExecArray | null
      TID_RE.lastIndex = 0
      while ((m = TID_RE.exec(subject)) !== null) {
        const tid = m[1]!
        if (!map.has(tid)) map.set(tid, fallbackTitle)
      }
      NUMERIC_TID_RE.lastIndex = 0
      while ((m = NUMERIC_TID_RE.exec(subject)) !== null) {
        const tid = m[0]!
        if (!map.has(tid)) map.set(tid, fallbackTitle)
      }
      walk(node.children)
    }
  }
  walk(replies)
  return Array.from(map.entries()).map(([tid, sourceTitle]) => ({
    tid,
    sourceTitle,
  }))
}

function normalizeTitle(title: string): string {
  return title
    .replace(DECORATIONS_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function longestCommonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      )
    }
  }
  return dp[m]![n]!
}

export function computeSimilarity(current: string, candidate: string): number {
  const a = normalizeTitle(current)
  const b = normalizeTitle(candidate)
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const aCore = a.replace(CHAPTER_SUFFIX_RE, "").trim()
  const bCore = b.replace(CHAPTER_SUFFIX_RE, "").trim()

  const prefixLen = longestCommonPrefix(aCore, bCore)
  const prefixScore = prefixLen / Math.min(aCore.length, bCore.length)

  const dist = levenshtein(aCore, bCore)
  const maxLen = Math.max(aCore.length, bCore.length)
  const editScore = maxLen === 0 ? 1 : 1 - dist / maxLen

  const hasContinuation = CONTINUATION_KEYWORDS.test(b)
  const prefixMatch = prefixLen >= 6
  const keywordScore = hasContinuation && prefixMatch ? 0.75 : 0

  return Math.max(prefixScore, editScore, keywordScore)
}

export function filterCandidates(
  currentTitle: string,
  candidates: { tid: string; title: string }[]
): CandidateItem[] {
  const scored = candidates.map((c) => ({
    tid: c.tid,
    title: c.title,
    score: computeSimilarity(currentTitle, c.title),
  }))

  return scored
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .map((c) => ({
      tid: c.tid,
      title: c.title,
      score: c.score,
      checked: c.score >= 0.5,
    }))
}
