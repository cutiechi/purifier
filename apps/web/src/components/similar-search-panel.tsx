import { useEffect, useRef, useState } from "react"
import { IconSearch } from "@/components/icons"
import { PostCard, PostList } from "@/components/post-card"
import { Spinner } from "@/components/ui-state"
import { type Group, type GroupMember, pickGroupMeta } from "@/lib/groups"
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

export function SimilarSearchPanel({
  title,
  groupKey,
  seedItems,
  onChanged,
  showTrigger = true,
}: {
  title: string
  groupKey: string
  seedItems: GroupMember[]
  onChanged?: () => void
  /** false：折叠组场景，trigger 由 CollapsibleBookGroup 渲染，面板自身展开渲染结果 */
  showTrigger?: boolean
}) {
  const [open, setOpen] = useState(!showTrigger)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<SearchHit[]>([])
  const [known, setKnown] = useState<Set<string>>(
    () => new Set(seedItems.map((s) => s.tid))
  )
  const [busyTid, setBusyTid] = useState<string | null>(null)
  // seedItems 随父级每次渲染重建，用 ref 避免进 effect 依赖造成重复拉取
  const seedRef = useRef(seedItems)
  seedRef.current = seedItems

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
      setResults(json.links ?? [])
      setKnown(new Set([...serverTids, ...seedRef.current.map((s) => s.tid)]))
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  // open 变化时拉取（showTrigger=false 时挂载即 open，重展开=重挂载=重拉，符合"以服务端为准"）
  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, groupKey])

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
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setBusyTid(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            open
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <IconSearch size={13} />
          搜索相似
        </button>
      )}
      {open && (
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
            <PostList className="gap-1.5">
              {results.map((hit) => {
                const parsed = parseListTitle(hit.title)
                const added = known.has(hit.tid)
                return (
                  <div key={hit.tid} className="flex items-center gap-2">
                    {/* 结果行直接用 PostCard（不用 ListPostCard，避免引入 rank/index/题材胶囊副作用） */}
                    <PostCard
                      href={readPath(hit.tid)}
                      title={parsed.title || hit.title}
                      subtitle={formatTitleMeta(parsed) || undefined}
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      disabled={added || busyTid !== null}
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
          )}
        </div>
      )}
    </div>
  )
}
