import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, Star, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { IconBookOpen } from "@/components/icons"
import { ListMeta } from "@/components/form-controls"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { SimilarTrigger } from "@/components/similar-trigger"
import { AsyncBody } from "@/components/ui-state"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { compareTid, type Group } from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

function GroupCard({
  group,
  isExpanded,
  onToggle,
  onChanged,
}: {
  group: Group
  isExpanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [showSimilar, setShowSimilar] = useState(false)

  async function toggleFavorite() {
    setBusy(true)
    try {
      const res = await fetch(`${api.meGroups}/${group.id}/favorite`, {
        method: group.favorited ? "DELETE" : "PUT",
      })
      if (res.ok) onChanged()
    } catch {
      // 网络失败：静默（无用户反馈面），避免未处理的 rejection
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(tid: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${api.meGroups}/${group.id}/items`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ tid }] }),
      })
      if (res.ok) onChanged()
    } catch {
      // 网络失败：静默（无用户反馈面），避免未处理的 rejection
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup() {
    const ok = await confirm({
      title: `删除分组「${group.title}」？`,
      description: "分组及其成员关系将被删除（不影响帖子本身）。",
      confirmLabel: "删除分组",
      destructive: true,
    })
    if (!ok) return
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${api.meGroups}/${group.id}`, {
        method: "DELETE",
      })
      if (res.ok) onChanged()
    } catch {
      // 网络失败：静默（无用户反馈面），避免未处理的 rejection
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 sm:px-4 sm:pt-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconBookOpen size={15} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {group.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {[group.author, group.genre].filter(Boolean).join(" · ") ||
                `共 ${group.items.length} 章`}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            共 {group.items.length} 章
          </span>
          <ChevronDown
            size={16}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => void toggleFavorite()}
          disabled={busy}
          aria-label={group.favorited ? "取消收藏分组" : "收藏分组"}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50 sm:size-9",
            group.favorited
              ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
              : "bg-muted/70 text-muted-foreground hover:bg-accent"
          )}
        >
          <Star
            size={15}
            className={group.favorited ? "fill-current" : undefined}
          />
        </button>
        <SimilarTrigger
          open={showSimilar}
          onToggle={() => {
            if (!isExpanded) {
              onToggle()
              setShowSimilar(true)
            } else {
              setShowSimilar((v) => !v)
            }
          }}
        />
      </div>
      {isExpanded && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3.5 py-3 sm:px-4">
          {/* 展示按 tid 数字升序（章节顺序），服务端存储顺序不变 */}
          {[...group.items]
            .sort((a, b) => compareTid(a.tid, b.tid))
            .map((m) => {
              const parsed = parseListTitle(m.title)
              const sub = formatTitleMeta(
                parsed.chapters ? { ...parsed, chapters: null } : parsed
              )
              return (
                <div key={m.tid} className="flex items-center gap-2">
                  <Link
                    to={readPath(m.tid)}
                    className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl bg-muted/40 px-3 py-2 transition-colors hover:bg-accent/60"
                  >
                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                      {parsed.chapters || m.title}
                    </span>
                    {sub && (
                      <span className="text-xs text-muted-foreground">
                        {sub}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void removeMember(m.tid)}
                    disabled={busy}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    移除
                  </button>
                </div>
              )
            })}
          {/* 面板在展开区内：成员 → 搜索相似 → 删除（对齐设计 §5.3） */}
          {showSimilar && (
            <SimilarSearchPanel
              title={group.title}
              groupKey={group.key}
              seedItems={group.items}
              onChanged={onChanged}
            />
          )}
          <button
            type="button"
            onClick={() => void deleteGroup()}
            disabled={busy}
            className="mt-1 inline-flex min-h-10 items-center justify-center gap-1.5 self-end rounded-xl px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 size={13} />
            删除分组
          </button>
        </div>
      )}
    </div>
  )
}

export default function GroupPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const { isExpanded, toggle } = useExpandedBooks("groups")

  // silent：增删/收藏后局部刷新，不闪整页 Spinner；onRetry 用全量 loading
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError("")
    try {
      const res = await fetch(api.meGroups)
      const json = (await res.json()) as { groups: Group[] }
      if (!res.ok) {
        setError(String((json as { error?: string }).error || "请求失败"))
        return
      }
      setGroups(json.groups ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter((g) => {
      const hay = [g.title, g.author, g.genre, ...g.items.map((i) => i.title)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [groups, q])

  return (
    <PageShell>
      <PageHeader
        title="分组"
        description={
          !loading && groups.length > 0
            ? `共 ${groups.length} 组 · 可用「搜索相似」补全书目`
            : "手动维护的收藏分组，可用「搜索相似」补全书目"
        }
      />
      {!loading && groups.length > 0 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          placeholder="筛选分组标题、作者、成员…"
          className="mb-4 h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <ListMeta>
          {q.trim()
            ? `匹配 ${filtered.length} / ${groups.length} 组`
            : `共 ${groups.length} 组`}
        </ListMeta>
      )}
      <AsyncBody
        loading={loading}
        error={error}
        empty={filtered.length === 0}
        onRetry={() => void reload()}
        emptyText={
          q.trim()
            ? "没有匹配的分组"
            : "还没有分组，去列表页点「搜索相似」创建"
        }
      >
        <PostList>
          {filtered.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              isExpanded={isExpanded(`group:${g.id}`)}
              onToggle={() => toggle(`group:${g.id}`)}
              onChanged={() => void reload({ silent: true })}
            />
          ))}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
