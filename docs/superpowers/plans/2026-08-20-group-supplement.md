# 阅读页分组补全与操作面板尺寸调整 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阅读 `/read/:tid` 页面增加主动触发的「补充分组」功能，从跟帖中检测相关帖子并追加到现有分组；同时将阅读操作面板从 `w-72` 加宽到 `w-80 sm:w-96`。

**Architecture:** 后端扩展 `getState` 返回分组信息、扩展 `ReplyItem` 保留跟帖站内链接、新增 `GET /api/me/groups/:id`；前端新建相似度检测模块和补充分组面板组件，在 `ReadPage` 集成触发入口。按「后端类型/存储 → 后端 API → 前端检测逻辑 → 前端组件 → 集成验证」的顺序推进。

**Tech Stack:** Bun, TypeScript, SQLite (bun:sqlite), Cheerio, React 19, Tailwind CSS 4, React Router 7

## Global Constraints

- TypeScript `strict`；`noEmit` 类型检查在各自包内运行
- 代码风格：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`
- 前端页面导入使用 `@/` 别名；跨包导入使用 `@workspace/...`
- 前端样式使用 Tailwind CSS 4 工具类，图标优先使用 lucide-react
- 上游解析统一走 `packages/core` 的 `Extractor` 接口
- 改动后用 `bun run test`、`bun run typecheck` 和 `bun run build` 验证

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/storage/types.ts` | Modify | `ItemState` 增加 `groupId?`/`groupTitle?` |
| `packages/core/src/storage/store.ts` | Modify | `getState` 追加分组 JOIN 查询 |
| `packages/core/src/storage/store.test.ts` | Modify | 测试 `getState` 分组信息返回 |
| `packages/core/src/extractor/types.ts` | Modify | `ReplyItem` 增加 `links?` |
| `packages/core/src/extractor/extractor.ts` | Modify | `parseReplies` 提取跟帖 subject 中的站内链接 |
| `packages/core/src/extractor/extractor.test.ts` | Modify | 跟帖含链接/不含链接的 fixtures 与断言 |
| `apps/api/src/index.ts` | Modify | 新增 `GET /api/me/groups/:id` 路由；`handleMeState` 透传新增字段 |
| `apps/web/src/components/item-actions.tsx` | Modify | `ItemState` 扩展；Popover 宽度 `w-72` → `w-80 sm:w-96`；条件渲染「补充分组」按钮 |
| `apps/web/src/lib/group-supplement.ts` | Create | 候选 tid 提取、标题归一化、相似度计算、阈值筛选 |
| `apps/web/src/lib/group-supplement.test.ts` | Create | 相似度算法与候选提取的单元测试 |
| `apps/web/src/components/group-supplement-panel.tsx` | Create | 检测流程、候选列表面板、确认追加逻辑 |
| `apps/web/src/pages/ReadPage.tsx` | Modify | 传入 `groupId`/`groupTitle`/`replies`/`title`/`tid` 给面板组件 |

---

### Task 1: 扩展存储层类型与 `getState`

**Files:**
- Modify: `packages/core/src/storage/types.ts:28-42`
- Modify: `packages/core/src/storage/store.ts:233-274`
- Test: `packages/core/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `group_items` 表 (`tid` → `group_id`) 与 `groups` 表 (`id`, `title`)
- Produces: `ItemState` 新增可选字段 `groupId?: number`, `groupTitle?: string`；`getState` 返回体同步扩展

- [ ] **Step 1: 修改 `ItemState` 定义**

在 `packages/core/src/storage/types.ts` 的 `ItemState` 接口末尾增加：

```typescript
export interface ItemState {
  // ... existing fields ...
  lastChapter: number | null
  /** 该帖子所属分组（仅 post 可能有） */
  groupId?: number
  groupTitle?: string
}
```

- [ ] **Step 2: 修改 `getState` 查询与返回**

在 `packages/core/src/storage/store.ts` 的 `getState` 方法中，在 `tagRows` 查询之后、`return` 之前插入分组查询：

```typescript
    const groupRow = this.db
      .query(
        `SELECT g.id, g.title
         FROM groups g
         JOIN group_items gi ON gi.group_id = g.id
         WHERE gi.tid = ?1
         LIMIT 1`
      )
      .get(id) as { id: number; title: string } | null
```

并在 `return` 对象中追加：

```typescript
    return {
      // ... existing fields ...
      lastChapter: row.last_chapter,
      groupId: groupRow?.id,
      groupTitle: groupRow?.title,
    }
```

- [ ] **Step 3: 写测试**

在 `packages/core/src/storage/store.test.ts` 中新增测试：

```typescript
test("getState returns group info when post is in a group", () => {
  const store = createStore()
  store.recordVisit("1", "post", "111", "Title A", "url")
  store.upsertGroup({
    key: "group-a",
    title: "Group A",
    items: [{ tid: "111", title: "Title A" }],
  })
  const state = store.getState("1", "post", "111")
  expect(state?.groupId).toBeGreaterThan(0)
  expect(state?.groupTitle).toBe("Group A")
})

test("getState omits group fields when post is not in a group", () => {
  const store = createStore()
  store.recordVisit("1", "post", "222", "Title B", "url")
  const state = store.getState("1", "post", "222")
  expect(state?.groupId).toBeUndefined()
  expect(state?.groupTitle).toBeUndefined()
})
```

- [ ] **Step 4: 运行测试**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun test packages/core/src/storage/store.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/store.ts packages/core/src/storage/store.test.ts
git commit --no-gpg-sign -m "feat(storage): include groupId/groupTitle in getState"
```

---

### Task 2: 扩展 `ReplyItem` 并从跟帖中提取站内链接

**Files:**
- Modify: `packages/core/src/extractor/types.ts:30-40`
- Modify: `packages/core/src/extractor/extractor.ts:652-685`
- Test: `packages/core/src/extractor/extractor.test.ts`

**Interfaces:**
- Consumes: 原始跟帖 JSON 中的 `subject`（可能含 HTML `<a>`）
- Produces: `ReplyItem.links?: { tid: string; title: string }[]`

- [ ] **Step 1: 扩展 `ReplyItem` 类型**

在 `packages/core/src/extractor/types.ts`：

```typescript
export interface ReplyItem {
  tid: string
  uptid: string
  rootid: string
  uid: string
  username: string
  subject: string
  dateline: string
  size: number
  /** 从原始 subject HTML 中提取的站内 /read/:tid 链接 */
  links?: { tid: string; title: string }[]
}
```

- [ ] **Step 2: 在 `parseReplies` 中提取链接**

在 `packages/core/src/extractor/extractor.ts` 的 `parseReplies` 方法中，修改循环体：

```typescript
    for (const r0 of data) {
      if (!r0 || typeof r0 !== "object") continue
      const r = r0 as Record<string, unknown>
      const replyTid = String(r.tid ?? "")
      if (!replyTid) continue

      const subjectHtml = String(r.subject ?? "")
      const links = this.extractReplyLinks(subjectHtml)

      items.push({
        tid: replyTid,
        uptid: String(r.uptid ?? tid),
        rootid: String(r.rootid ?? tid),
        uid: String(r.uid ?? ""),
        username: this.stripHtml(String(r.username ?? "")),
        subject: this.stripHtml(subjectHtml),
        dateline: String(r.dateline ?? ""),
        size: parseInt(String(r.size ?? "0"), 10) || 0,
        links: links.length > 0 ? links : undefined,
      })
    }
```

并在 `Cool18Extractor` 类中新增私有方法：

```typescript
  private extractReplyLinks(html: string): { tid: string; title: string }[] {
    const $ = cheerio.load(`<div>${html}</div>`)
    const out: { tid: string; title: string }[] = []
    $("a").each((_i, el) => {
      const href = $(el).attr("href") ?? ""
      const match = href.match(/[?&]tid=(\d+)/)
      if (match) {
        const tid = match[1]!
        const title = $(el).text().trim()
        if (tid && title) out.push({ tid, title })
      }
    })
    return out
  }
```

- [ ] **Step 3: 写测试**

在 `packages/core/src/extractor/extractor.test.ts` 中新增：

```typescript
test("parseReplies extracts links from subject html", () => {
  const extractor = new Cool18Extractor()
  const raw = JSON.stringify([
    {
      tid: "100",
      subject: 'Next: <a href="index.php?app=forum&act=threadview&tid=200">Title 200</a>',
      dateline: "2024-01-01",
      size: 100,
    },
    {
      tid: "101",
      subject: "Plain text without links",
      dateline: "2024-01-01",
      size: 50,
    },
  ])
  const nodes = extractor.parseReplies(raw, "1")
  expect(nodes[0]?.links).toEqual([{ tid: "200", title: "Title 200" }])
  expect(nodes[1]?.links).toBeUndefined()
})
```

- [ ] **Step 4: 运行测试**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun test packages/core/src/extractor/extractor.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/extractor/types.ts packages/core/src/extractor/extractor.ts packages/core/src/extractor/extractor.test.ts
git commit --no-gpg-sign -m "feat(extractor): extract inline links from reply subjects"
```

---

### Task 3: 新增 `GET /api/me/groups/:id`

**Files:**
- Modify: `apps/api/src/index.ts:1687-1715`
- Modify: `apps/api/src/index.ts`（新增 `handleGroupGet` 函数）

**Interfaces:**
- Consumes: `store.getGroup(id)`（已存在）
- Produces: `GET /api/me/groups/:id` → `{ group: Group }` 或 404

- [ ] **Step 1: 新增 handler 函数**

在 `apps/api/src/index.ts` 中，找到 `handleGroupDelete` 附近，新增：

```typescript
function handleGroupGet(id: number): Response {
  const group = store.getGroup(id)
  if (!group) {
    return jsonError("group not found", 404)
  }
  return jsonOk({ group }, NO_STORE_HEADERS)
}
```

- [ ] **Step 2: 修改路由分支**

将现有的 `groupsSub` 路由分支中 `sub === undefined` 的部分从：

```typescript
      if (sub === undefined) {
        if (req.method !== "DELETE") {
          throw new ExtractorError("method not allowed", 405)
        }
        return handleGroupDelete(id)
      }
```

改为：

```typescript
      if (sub === undefined) {
        if (req.method === "GET") return handleGroupGet(id)
        if (req.method === "DELETE") return handleGroupDelete(id)
        throw new ExtractorError("method not allowed", 405)
      }
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run typecheck
```

Expected: PASS

- [ ] **Step 4: 手动验证**

启动 dev server：`bun run dev:api`，然后 curl：

```bash
curl "http://localhost:3001/api/me/groups/1" -H "Cookie: session=..."
```

Expected: 返回 `{ group: { id, key, title, ..., items: [...] } }` 或 404

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/index.ts
git commit --no-gpg-sign -m "feat(api): add GET /api/me/groups/:id endpoint"
```

---

### Task 4: 前端相似度检测模块

**Files:**
- Create: `apps/web/src/lib/group-supplement.ts`
- Create: `apps/web/src/lib/group-supplement.test.ts`

**Interfaces:**
- Consumes: `ReplyNode[]`（来自 `content.replies`），当前帖子标题 `string`
- Produces: `CandidateItem[]` = `{ tid: string; title: string; score: number; checked: boolean }[]`

- [ ] **Step 1: 创建检测模块**

创建 `apps/web/src/lib/group-supplement.ts`：

```typescript
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

export function extractCandidateTids(replies: ReplyNode[]): string[] {
  const set = new Set<string>()
  function walk(nodes: ReplyNode[]) {
    for (const node of nodes) {
      if (node.links) {
        for (const link of node.links) {
          if (link.tid) set.add(link.tid)
        }
      }
      const subject = node.subject
      let m: RegExpExecArray | null
      TID_RE.lastIndex = 0
      while ((m = TID_RE.exec(subject)) !== null) {
        set.add(m[1]!)
      }
      NUMERIC_TID_RE.lastIndex = 0
      while ((m = NUMERIC_TID_RE.exec(subject)) !== null) {
        set.add(m[0]!)
      }
      walk(node.children)
    }
  }
  walk(replies)
  return Array.from(set)
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
```

- [ ] **Step 2: 创建测试**

创建 `apps/web/src/lib/group-supplement.test.ts`：

```typescript
import { expect, test } from "bun:test"
import {
  extractCandidateTids,
  computeSimilarity,
  filterCandidates,
} from "./group-supplement"
import type { ReplyNode } from "@/components/reply-list"

function makeReply(overrides: Partial<ReplyNode> = {}): ReplyNode {
  return {
    tid: "1",
    uptid: "1",
    rootid: "1",
    uid: "1",
    username: "u",
    subject: "",
    dateline: "2024-01-01",
    size: 0,
    children: [],
    ...overrides,
  }
}

test("extractCandidateTids from links and subject text", () => {
  const replies: ReplyNode[] = [
    makeReply({
      subject: "Next chapter",
      links: [{ tid: "200", title: "Title 200" }],
    }),
    makeReply({
      subject: "See also tid=300 and 400",
    }),
  ]
  const tids = extractCandidateTids(replies)
  expect(tids.sort()).toEqual(["200", "300", "400"])
})

test("computeSimilarity for chapter pairs", () => {
  const s1 = computeSimilarity("小说A 第一章", "小说A 第二章")
  expect(s1).toBeGreaterThan(0.5)

  const s2 = computeSimilarity("完全不同的标题", "另一个世界")
  expect(s2).toBeLessThan(0.3)

  const s3 = computeSimilarity("小说A 第一章", "小说A 第一章")
  expect(s3).toBe(1)
})

test("filterCandidates thresholds", () => {
  const current = "小说A 第一章"
  const candidates = [
    { tid: "1", title: "小说A 第二章" },
    { tid: "2", title: "小说B 第一章" },
    { tid: "3", title: "完全不相关" },
  ]
  const result = filterCandidates(current, candidates)
  expect(result.map((r) => r.tid)).toContain("1")
  expect(result.map((r) => r.tid)).toContain("2")
  expect(result.map((r) => r.tid)).not.toContain("3")
  expect(result.find((r) => r.tid === "1")?.checked).toBe(true)
})
```

- [ ] **Step 3: 运行测试**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun test apps/web/src/lib/group-supplement.test.ts
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/group-supplement.ts apps/web/src/lib/group-supplement.test.ts
git commit --no-gpg-sign -m "feat(web): add group supplement similarity detection module"
```

---

### Task 5: 操作面板尺寸调整与 `ItemState` 扩展

**Files:**
- Modify: `apps/web/src/components/item-actions.tsx:12-25`
- Modify: `apps/web/src/components/item-actions.tsx:158`

**Interfaces:**
- Consumes: 后端 `/api/me/state` 返回的 `groupId?`/`groupTitle?`
- Produces: 前端 `ItemState` 含相同可选字段；Popover 宽度更大

- [ ] **Step 1: 扩展前端 `ItemState`**

在 `apps/web/src/components/item-actions.tsx`：

```typescript
export interface ItemState {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
  read_progress: number | null
  site: string
  lastChapter: number | null
  groupId?: number
  groupTitle?: string
}
```

- [ ] **Step 2: 加宽 Popover**

将 `apps/web/src/components/item-actions.tsx` 中的：

```typescript
      <div className="flex w-72 flex-col gap-1">
```

改为：

```typescript
      <div className="flex w-80 flex-col gap-1 sm:w-96">
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run typecheck
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/item-actions.tsx
git commit --no-gpg-sign -m "feat(ui): widen reading action popover and extend ItemState with group fields"
```

---

### Task 6: 新建 `GroupSupplementPanel` 组件

**Files:**
- Create: `apps/web/src/components/group-supplement-panel.tsx`

**Interfaces:**
- Consumes: `groupId`, `groupTitle`, `replies`, `currentTid`, `currentTitle`, `site`
- Produces: 检测状态、候选列表、确认追加事件

- [ ] **Step 1: 创建组件**

创建 `apps/web/src/components/group-supplement-panel.tsx`：

```typescript
import { useCallback, useMemo, useState } from "react"
import type { ReplyNode } from "@/components/reply-list"
import {
  extractCandidateTids,
  filterCandidates,
  type CandidateItem,
} from "@/lib/group-supplement"
import { api } from "@/lib/routes"
import { useSite } from "@/hooks/use-site"
import { cn } from "@workspace/ui/lib/utils"
import { Loader2 } from "lucide-react"

interface Props {
  groupId: number
  groupTitle: string
  replies: ReplyNode[]
  currentTid: string
  currentTitle: string
  onSuccess?: () => void
}

export function GroupSupplementPanel({
  groupId,
  groupTitle,
  replies,
  currentTid,
  currentTitle,
  onSuccess,
}: Props) {
  const site = useSite()
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "submitting">("idle")
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [error, setError] = useState("")
  const [submitError, setSubmitError] = useState("")

  const detect = useCallback(async () => {
    setPhase("loading")
    setError("")
    setSubmitError("")

    const tids = extractCandidateTids(replies).filter(
      (tid) => tid !== currentTid
    )

    if (tids.length === 0) {
      setCandidates([])
      setPhase("ready")
      return
    }

    const titleMap = new Map<string, string>()
    await Promise.all(
      tids.map(async (tid) => {
        try {
          const res = await fetch(`${api.posts}?tid=${encodeURIComponent(tid)}&site=${site}`)
          if (res.ok) {
            const json = (await res.json()) as { title: string }
            titleMap.set(tid, json.title)
          }
        } catch {
          // ignore individual failures
        }
      })
    )

    const raw = Array.from(titleMap.entries()).map(([tid, title]) => ({
      tid,
      title,
    }))

    const filtered = filterCandidates(currentTitle, raw)
    setCandidates(filtered)
    setPhase("ready")
  }, [replies, currentTid, currentTitle, site])

  const toggle = (tid: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.tid === tid ? { ...c, checked: !c.checked } : c))
    )
  }

  const submit = useCallback(async () => {
    setSubmitError("")
    const selected = candidates.filter((c) => c.checked)
    if (selected.length === 0) return

    setPhase("submitting")
    try {
      const groupRes = await fetch(`${api.meGroups}/${groupId}`)
      if (!groupRes.ok) {
        setSubmitError("获取分组信息失败")
        setPhase("ready")
        return
      }
      const groupJson = (await groupRes.json()) as {
        group: {
          key: string
          title: string
          author: string | null
          genre: string | null
          items: { tid: string; title: string }[]
        }
      }
      const group = groupJson.group

      const existingTids = new Set(group.items.map((i) => i.tid))
      const newItems = selected.filter((s) => !existingTids.has(s.tid))

      if (newItems.length === 0) {
        setSubmitError("所选帖子已在分组中")
        setPhase("ready")
        return
      }

      const upsertRes = await fetch(api.meGroups, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: group.key,
          title: group.title,
          author: group.author,
          genre: group.genre,
          items: [
            ...group.items,
            ...newItems.map((n) => ({ tid: n.tid, title: n.title })),
          ],
        }),
      })

      if (!upsertRes.ok) {
        const err = (await upsertRes.json()) as { error?: string }
        if (upsertRes.status === 409) {
          setSubmitError(`部分帖子已属于其他分组：${err.error ?? ""}`)
        } else {
          setSubmitError(err.error ?? "加入失败")
        }
        setPhase("ready")
        return
      }

      onSuccess?.()
      setPhase("idle")
      setCandidates([])
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "请求失败")
      setPhase("ready")
    }
  }, [candidates, groupId, onSuccess])

  if (phase === "idle") {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => void detect()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          补充分组
        </button>
      </div>
    )
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在分析跟帖…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">
        补充分组 — 《{groupTitle}》
      </div>
      {candidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">未检测到相关帖子</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground/70">
            从跟帖中检测到以下可能相关的帖子：
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {candidates.map((c) => (
              <label
                key={c.tid}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={c.checked}
                  onChange={() => toggle(c.tid)}
                  className="size-4 rounded border-border"
                />
                <span className="flex-1 truncate">《{c.title}》</span>
                <span className="text-xs text-muted-foreground">
                  tid={c.tid}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(c.score * 100)}%
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={phase === "submitting"}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {phase === "submitting" ? "加入中…" : "确认加入"}
            </button>
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/group-supplement-panel.tsx
git commit --no-gpg-sign -m "feat(ui): add GroupSupplementPanel component"
```

---

### Task 7: 在 `ItemActions` 与 `ReadPage` 中集成

**Files:**
- Modify: `apps/web/src/components/item-actions.tsx`
- Modify: `apps/web/src/pages/ReadPage.tsx`

**Interfaces:**
- Consumes: `GroupSupplementPanel`, `state.groupId`, `state.groupTitle`
- Produces: Popover 内条件渲染的「补充分组」触发区域

- [ ] **Step 1: 在 `ItemActions` 中引入面板**

在 `apps/web/src/components/item-actions.tsx` 顶部导入：

```typescript
import { GroupSupplementPanel } from "./group-supplement-panel"
```

修改 `ItemActions` 的 props，新增可选参数：

```typescript
export function ItemActions({
  kind,
  id,
  state,
  reload,
  onRefresh,
  refreshing,
  characterSlot,
  replies,
  currentTitle,
}: {
  kind: "post" | "book"
  id: string
  state: ItemState | null
  reload: () => Promise<void>
  onRefresh: () => void
  refreshing: boolean
  characterSlot?: ReactNode
  /** 以下两个仅在 kind=post 时由 ReadPage 传入，用于补充分组 */
  replies?: ReplyNode[]
  currentTitle?: string
}) {
```

注意需要导入 `ReplyNode`：

```typescript
import type { ReplyNode } from "@/components/reply-list"
```

在 Popover 的 `div` 内容中，「刷新」按钮之后、「标签」区域之前插入：

```typescript
      {/* 补充分组（仅 post 且已有分组时显示） */}
      {kind === "post" && state?.groupId != null && replies != null && (
        <GroupSupplementPanel
          groupId={state.groupId}
          groupTitle={state.groupTitle ?? ""}
          replies={replies}
          currentTid={id}
          currentTitle={currentTitle ?? ""}
          onSuccess={() => void reload()}
        />
      )}
```

- [ ] **Step 2: 在 `ReadPage` 中传参**

在 `apps/web/src/pages/ReadPage.tsx` 的 `ItemActions` 调用处，新增两个 prop：

```typescript
                  <ItemActions
                    kind="post"
                    id={tid}
                    state={state}
                    reload={reload}
                    onRefresh={() => void fetchContent({ refresh: true })}
                    refreshing={refreshing}
                    replies={content.replies}
                    currentTitle={content.title}
                    characterSlot={...}
                  />
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run typecheck
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/item-actions.tsx apps/web/src/pages/ReadPage.tsx
git commit --no-gpg-sign -m "feat(ui): integrate GroupSupplementPanel into ReadPage"
```

---

### Task 8: 全量验证与收尾

- [ ] **Step 1: 运行全仓类型检查**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run typecheck
```

Expected: PASS（所有包无类型错误）

- [ ] **Step 2: 运行全仓测试**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run test
```

Expected: PASS（包括 storage、extractor、web 各层测试）

- [ ] **Step 3: 构建验证**

```bash
cd /Users/cutiechi/projects/personal/purifier && bun run build
```

Expected: PASS（web 构建成功，无 rollup/vite 错误）

- [ ] **Step 4: 手动验证清单**

启动 dev：`bun run dev`

1. 打开一个**无分组**的帖子 `/read/:tid` → 确认 `ItemActions` Popover 中**没有**「补充分组」
2. 打开一个**已有分组**的帖子 → Popover 中**有**「补充分组」按钮 → 点击 → 若跟帖无相关链接 → 显示「未检测到相关帖子」
3. 打开一个已有分组的帖子，且跟帖中包含 `tid=xxx` 链接或标题相似的内容 → 检测后列出候选 → 勾选 → 确认加入 → 成功提示
4. 确认操作面板宽度在桌面端（>=640px）为 384px、移动端为 320px，内部按钮不溢出

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit --no-gpg-sign -m "feat: group supplement from replies + wider action panel"
```

---

## Self-Review

### Spec coverage check

| Spec 章节 | 对应任务 |
|-----------|----------|
| 3.1 扩展 `/api/me/state` | Task 1 |
| 3.2 扩展 `ReplyItem` / `parseReplies` 提取链接 | Task 2 |
| 3.3 新增 `GET /api/me/groups/:id` | Task 3 |
| 4 相似度检测算法 | Task 4 |
| 5.1 操作面板尺寸调整 | Task 5 |
| 5.2 补充分组按钮 / 5.3 候选列表面板 / 5.4 追加确认 | Task 6 |
| 5.5 分组 key 获取（通过 `GET /api/me/groups/:id`） | Task 3 + Task 6 |
| 6 错误处理与边界 | 覆盖在每个任务的代码与测试中 |

**Gap:** 无遗漏。

### Placeholder scan

- 无 "TBD"、"TODO"、"implement later"
- 无 "Add appropriate error handling" 等模糊描述
- 每处代码修改都给出了完整代码块
- 每个测试都给出了完整断言

### Type consistency check

- `ItemState.groupId?` / `groupTitle?`：前后端定义一致（Task 1 修改 `storage/types.ts`，Task 5 修改前端 `item-actions.tsx`）
- `ReplyItem.links?`：Task 2 修改类型，Task 6 组件中通过 `node.links` 消费，一致
- `CandidateItem`：Task 4 定义 `{ tid, title, score, checked }`，Task 6 组件中消费一致
- `GET /api/me/groups/:id` 返回 `{ group }`：Task 3 定义，Task 6 中 `groupRes.json()` 类型断言一致

**Fix applied:** 无发现不一致。
