import { useCallback, useState } from "react"
import type { ReplyNode } from "@/components/reply-list"
import {
  extractCandidateTids,
  filterCandidates,
  type CandidateItem,
} from "@/lib/group-supplement"
import { api } from "@/lib/routes"
import { useSite } from "@/hooks/use-site"
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
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "submitting">(
    "idle"
  )
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [submitError, setSubmitError] = useState("")

  const detect = useCallback(async () => {
    setPhase("loading")
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
          const res = await fetch(
            `${api.posts}?tid=${encodeURIComponent(tid)}&site=${site}`
          )
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
      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
    </div>
  )
}
