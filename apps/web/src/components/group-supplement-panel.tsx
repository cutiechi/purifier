import { useCallback, useState } from "react"
import type { ReplyNode } from "@/components/reply-list"
import {
  extractCandidates,
  filterCandidates,
  computeSimilarity,
  type CandidateItem,
} from "@/lib/group-supplement"
import { groupKeyFromTitle, groupSearchTitle } from "@/lib/groups"
import { api } from "@/lib/routes"
import { useSite } from "@/hooks/use-site"
import { Loader2 } from "lucide-react"

interface Props {
  groupId?: number
  groupTitle?: string
  replies: ReplyNode[]
  contentLinks?: { tid: string; title: string; index: number }[]
  currentTid: string
  currentTitle: string
  onSuccess?: () => void
}

export function GroupSupplementPanel({
  groupId,
  groupTitle,
  replies,
  contentLinks,
  currentTid,
  currentTitle,
  onSuccess,
}: Props) {
  const site = useSite()
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "submitting">(
    "idle"
  )
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [submitError, setSubmitError] = useState("")

  const detect = useCallback(async () => {
    setPhase("loading")
    setSubmitError("")

    const replySources = extractCandidates(replies).filter(
      (c) => c.tid !== currentTid
    )

    // contentLinks 已有标题，直接作为候选
    const linkCandidates =
      contentLinks
        ?.filter((l) => l.tid !== currentTid)
        .map((l) => ({ tid: l.tid, title: l.title })) ?? []

    const linkTidSet = new Set(linkCandidates.map((c) => c.tid))
    // replies 中提取的 tid 排除 contentLinks 已覆盖的
    const uniqueReplySources = replySources.filter(
      (c) => !linkTidSet.has(c.tid)
    )

    const raw: { tid: string; title: string }[] = [...linkCandidates]

    await Promise.all(
      uniqueReplySources.map(async (src) => {
        try {
          const res = await fetch(
            `${api.posts}?tid=${encodeURIComponent(src.tid)}&site=${site}`
          )
          if (res.ok) {
            const json = (await res.json()) as { title: string }
            raw.push({ tid: src.tid, title: json.title })
            return
          }
        } catch {
          // ignore individual failures
        }
        // API 失败：用 sourceTitle 兜底，若相似度够高仍保留
        const score = computeSimilarity(currentTitle, src.sourceTitle)
        if (score > 0.3) {
          raw.push({ tid: src.tid, title: src.sourceTitle })
        }
      })
    )

    const filtered = filterCandidates(currentTitle, raw)
    setCandidates(filtered)
    setPhase("ready")
  }, [replies, contentLinks, currentTid, currentTitle, site])

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
      let key: string
      let title: string
      let author: string | null = null
      let genre: string | null = null
      let baseItems: { tid: string; title: string }[]

      if (groupId != null) {
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
        key = group.key
        title = group.title
        author = group.author
        genre = group.genre
        baseItems = group.items
      } else {
        key = groupKeyFromTitle(currentTitle)
        title = groupSearchTitle(currentTitle)
        baseItems = [{ tid: currentTid, title: currentTitle }]
      }

      const existingTids = new Set(baseItems.map((i) => i.tid))
      const newItems = selected.filter((s) => !existingTids.has(s.tid))

      if (newItems.length === 0) {
        setSubmitError(groupId != null ? "所选帖子已在分组中" : "所选帖子与当前帖子重复")
        setPhase("ready")
        return
      }

      const upsertRes = await fetch(api.meGroups, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          title,
          author,
          genre,
          items: [
            ...baseItems,
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
  }, [candidates, groupId, currentTitle, currentTid, onSuccess])

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
        {groupTitle != null ? `补充分组 — 《${groupTitle}》` : "创建分组"}
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
      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
    </div>
  )
}
