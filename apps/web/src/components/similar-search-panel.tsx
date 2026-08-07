import { useEffect, useRef, useState } from "react"
import { PostCard, PostList } from "@/components/post-card"
import { Spinner } from "@/components/ui-state"
import {
  compareTid,
  type Group,
  type GroupMember,
  pickGroupMeta,
} from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

interface SearchHit {
  index: number
  title: string
  tid: string
}

interface BrowseResponse {
  links: SearchHit[]
  nextPage: number | null
}

/**
 * 相似搜索结果面板：挂载即拉取并展开渲染结果。
 * 触发按钮由容器渲染（SimilarTrigger），本组件只负责结果区与「加入本组 / 批量加入」。
 */
export function SimilarSearchPanel({
  title,
  groupKey,
  seedItems,
  onChanged,
}: {
  title: string
  groupKey: string
  seedItems: GroupMember[]
  onChanged?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<SearchHit[]>([])
  const [known, setKnown] = useState<Set<string>>(
    () => new Set(seedItems.map((s) => s.tid))
  )
  const [busyTid, setBusyTid] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  // seedItems 随父级每次渲染重建，用 ref 避免进 effect 依赖造成重复拉取
  const seedRef = useRef(seedItems)
  seedRef.current = seedItems
  const allRef = useRef<HTMLInputElement>(null)

  // 任一加入动作进行中时禁用全部勾选/加入按钮，避免并发写同一分组
  const busy = busyTid !== null || batchBusy

  async function load() {
    setLoading(true)
    setError("")
    try {
      // 「已加入」以服务端为准：每次展开都拉（个人组量小，不做跨页缓存）。
      // 分组状态拉取失败时中止，避免用「仅 seed」的过期 known 渲染已加入项并重复 PUT。
      const gRes = await fetch(api.meGroups)
      const gJson = (await gRes.json()) as { groups?: Group[]; error?: string }
      if (!gRes.ok) {
        setError(gJson.error || "获取分组状态失败")
        return
      }
      const serverTids = new Set(
        (gJson.groups ?? [])
          .find((g) => g.key === groupKey)
          ?.items.map((i) => i.tid) ?? []
      )
      const res = await fetch(
        `${api.browse}?q=${encodeURIComponent(title)}&site=1`
      )
      const json = (await res.json()) as BrowseResponse
      if (!res.ok) {
        setError((json as { error?: string }).error || "请求失败")
        return
      }
      // 章节顺序：按 tid 数字升序（与折叠组内成员排序一致）
      const links = (json.links ?? []).sort((a, b) => compareTid(a.tid, b.tid))
      setResults(links)
      setKnown(new Set([...serverTids, ...seedRef.current.map((s) => s.tid)]))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, groupKey])

  async function addToGroup(hit: SearchHit) {
    setBusyTid(hit.tid)
    try {
      const meta = pickGroupMeta([
        ...seedRef.current,
        { tid: hit.tid, title: hit.title },
      ])
      // 依赖服务端 PUT 的 merge 语义（INSERT OR IGNORE 合并，非全量替换）：
      // 只带 seed + 本次点击项即可，未传的已存在 tid 不会被删。
      const res = await fetch(api.meGroups, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: groupKey,
          title,
          author: meta.author,
          genre: meta.genre,
          items: [...seedRef.current, { tid: hit.tid, title: hit.title }],
        }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        setError(json.error || "加入失败")
        return
      }
      setKnown((prev) => new Set(prev).add(hit.tid))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(hit.tid)
        return next
      })
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setBusyTid(null)
    }
  }

  async function addSelected() {
    const hits = results.filter((h) => selected.has(h.tid))
    if (hits.length === 0) return
    setBatchBusy(true)
    try {
      const items = [
        ...seedRef.current,
        ...hits.map((h) => ({ tid: h.tid, title: h.title })),
      ]
      const meta = pickGroupMeta(items)
      const res = await fetch(api.meGroups, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: groupKey,
          title,
          author: meta.author,
          genre: meta.genre,
          items,
        }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        setError(json.error || "加入失败")
        return
      }
      setKnown((prev) => {
        const next = new Set(prev)
        for (const h of hits) next.add(h.tid)
        return next
      })
      setSelected(new Set())
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setBatchBusy(false)
    }
  }

  function toggleSelect(tid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tid)) next.delete(tid)
      else next.add(tid)
      return next
    })
  }

  const selectable = results.filter((h) => !known.has(h.tid))
  const allSelected =
    selectable.length > 0 && selectable.every((h) => selected.has(h.tid))
  const someSelected = selectable.some((h) => selected.has(h.tid))

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const h of selectable) next.delete(h.tid)
      } else {
        for (const h of selectable) next.add(h.tid)
      }
      return next
    })
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
      {loading ? (
        <Spinner className="py-4" />
      ) : error ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-xs text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs text-foreground"
          >
            重试
          </button>
        </div>
      ) : results.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          没有找到「{title}」相关内容
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                ref={allRef}
                checked={allSelected}
                onChange={toggleSelectAll}
                className="size-3.5 shrink-0"
              />
              全选
            </label>
            <span className="flex-1 text-xs text-muted-foreground">
              {selected.size > 0 ? `已选 ${selected.size}` : ""}
            </span>
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={() => void addSelected()}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors disabled:opacity-50"
            >
              {batchBusy
                ? "加入中…"
                : `加入选中${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
          </div>
          <PostList className="gap-1.5">
            {results.map((hit) => {
              const parsed = parseListTitle(hit.title)
              const added = known.has(hit.tid)
              return (
                <div key={hit.tid} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(hit.tid)}
                    disabled={added || busy}
                    onChange={() => toggleSelect(hit.tid)}
                    aria-label={`选择 ${parsed.title || hit.title}`}
                    className="size-3.5 shrink-0"
                  />
                  {/* 结果行直接用 PostCard（不用 ListPostCard，避免引入 rank/index/题材胶囊副作用） */}
                  <PostCard
                    href={readPath(hit.tid)}
                    title={parsed.title || hit.title}
                    subtitle={formatTitleMeta(parsed) || undefined}
                    className="min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    disabled={added || busy}
                    onClick={() => void addToGroup(hit)}
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                      added
                        ? "bg-muted/50 text-muted-foreground"
                        : "bg-accent text-foreground hover:bg-accent/80"
                    )}
                  >
                    {added
                      ? "已加入"
                      : busyTid === hit.tid
                        ? "加入中…"
                        : "加入本组"}
                  </button>
                </div>
              )
            })}
          </PostList>
        </>
      )}
    </div>
  )
}
