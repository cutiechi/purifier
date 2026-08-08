import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useLocation } from "react-router-dom"
import { ChevronDown, Star, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { FilterTabs, ListMeta } from "@/components/form-controls"
import { IconBookOpen } from "@/components/icons"
import { GenrePill } from "@/components/list-post-card"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { SectionTabs } from "@/components/section-tabs"
import { PostList } from "@/components/post-card"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { SimilarTrigger } from "@/components/similar-trigger"
import { AsyncBody } from "@/components/ui-state"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
import { useMeTabs } from "@/lib/hub-tabs"
import { compareTid, type Group } from "@/lib/groups"
import { api, readPath, routes } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

type FilterKey = "all" | "fav"
type SortKey = "updated" | "chapters" | "title"

const FILTER_OPTS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "fav", label: "已收藏" },
]

const SORT_OPTS: { value: SortKey; label: string; title: string }[] = [
  { value: "updated", label: "最近更新", title: "按更新时间" },
  { value: "chapters", label: "章节数", title: "章节多的在前" },
  { value: "title", label: "标题", title: "按书名" },
]

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
  const [localError, setLocalError] = useState("")

  const members = useMemo(
    () => [...group.items].sort((a, b) => compareTid(a.tid, b.tid)),
    [group.items]
  )

  async function toggleFavorite() {
    setBusy(true)
    setLocalError("")
    try {
      const res = await fetch(`${api.meGroups}/${group.id}/favorite`, {
        method: group.favorited ? "DELETE" : "PUT",
      })
      if (res.ok) onChanged()
      else setLocalError("收藏操作失败")
    } catch {
      setLocalError("网络错误，请重试")
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(tid: string, label: string) {
    if (busy) return
    const ok = await confirm({
      title: "从分组移除？",
      description: `将「${label}」移出本组（不删除帖子）。`,
      confirmLabel: "移除",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setLocalError("")
    try {
      const res = await fetch(`${api.meGroups}/${group.id}/items`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ tid }] }),
      })
      if (res.ok) onChanged()
      else setLocalError("移除失败")
    } catch {
      setLocalError("网络错误，请重试")
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
    setLocalError("")
    try {
      const res = await fetch(`${api.meGroups}/${group.id}`, {
        method: "DELETE",
      })
      if (res.ok) onChanged()
      else setLocalError("删除失败")
    } catch {
      setLocalError("网络错误，请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 shadow-sm transition-all duration-200",
        isExpanded
          ? "border-border shadow-md"
          : "border-border/80 hover:border-border"
      )}
    >
      <div className="flex items-start gap-1.5 px-3 py-3 sm:items-center sm:gap-2 sm:px-4 sm:py-3.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left sm:gap-3.5"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground sm:h-9 sm:w-9 sm:rounded-lg">
            <IconBookOpen size={16} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {group.title}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {group.author ? (
                <span className="truncate">
                  {group.genre && group.author.includes(group.genre)
                    ? group.author
                        .replace(group.genre, "")
                        .replace(/\s*[·•|]\s*$/, "")
                        .replace(/^\s*[·•|]\s*/, "")
                        .trim() || group.author
                    : group.author}
                </span>
              ) : (
                <span className="tabular-nums">共 {group.items.length} 章</span>
              )}
              {group.genre ? <GenrePill genre={group.genre} /> : null}
            </span>
          </span>
          <span className="hidden shrink-0 rounded-lg bg-muted/70 px-2 py-1 text-xs font-medium text-muted-foreground tabular-nums sm:inline">
            {group.items.length} 章
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
            "flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50 sm:size-10",
            group.favorited
              ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          <Star
            size={16}
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
          className="min-h-11 px-2.5 sm:min-h-0"
        />
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3 py-3 sm:px-4">
          {localError && (
            <p className="mb-1 text-xs text-destructive">{localError}</p>
          )}
          {members.map((m, idx) => {
            const parsed = parseListTitle(m.title)
            const chapterLabel =
              parsed.chapters ||
              (members.length > 1 ? `第 ${idx + 1} 章` : null)
            const sub = formatTitleMeta(
              parsed.chapters
                ? { ...parsed, chapters: null, genre: null }
                : { ...parsed, genre: null }
            )
            const main =
              chapterLabel && parsed.title
                ? chapterLabel
                : parsed.title || m.title
            return (
              <div key={m.tid} className="flex items-center gap-2">
                <Link
                  to={readPath(m.tid)}
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2 transition-colors hover:bg-accent/60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/80 text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                      {main}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {[sub, `#${m.tid}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    void removeMember(m.tid, chapterLabel || parsed.title || m.title)
                  }
                  disabled={busy}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  移除
                </button>
              </div>
            )
          })}

          {showSimilar && (
            <div className="mt-1">
              <SimilarSearchPanel
                title={group.title}
                groupKey={group.key}
                seedItems={group.items}
                onChanged={onChanged}
              />
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {group.items.length} 个成员
              {group.favorited ? " · 已收藏" : ""}
            </span>
            <button
              type="button"
              onClick={() => void deleteGroup()}
              disabled={busy}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 size={13} />
              删除分组
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function GroupPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")
  const [sort, setSort] = useState<SortKey>("updated")
  const { isExpanded, toggle } = useExpandedBooks("groups")

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
    if (site === "1") void reload()
  }, [reload, site])

  const favCount = useMemo(
    () => groups.filter((g) => g.favorited).length,
    [groups]
  )
  const chapterTotal = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = groups
    if (filter === "fav") list = list.filter((g) => g.favorited)
    if (needle) {
      list = list.filter((g) => {
        const hay = [g.title, g.author, g.genre, ...g.items.map((i) => i.title)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return hay.includes(needle)
      })
    }
    const sorted = [...list]
    if (sort === "chapters") {
      sorted.sort(
        (a, b) =>
          b.items.length - a.items.length ||
          b.updated_at - a.updated_at
      )
    } else if (sort === "title") {
      sorted.sort((a, b) =>
        a.title.localeCompare(b.title, "zh-CN", { sensitivity: "base" })
      )
    } else {
      // updated：收藏优先，再按更新时间
      sorted.sort((a, b) => {
        if (a.favorited !== b.favorited) return a.favorited ? -1 : 1
        return b.updated_at - a.updated_at
      })
    }
    return sorted
  }, [groups, q, filter, sort])

  if (site !== "1") {
    return <Navigate to={`${routes.history}?site=${site}`} replace />
  }

  return (
    <PageShell>
      <PageHeader
        title="我的"
        description={
          !loading && groups.length > 0
            ? `分组 · 共 ${groups.length} 组 · ${chapterTotal} 章${
                favCount ? ` · ${favCount} 已收藏` : ""
              }`
            : "分组 · 同书多章合集"
        }
        action={
          <Link
            to={routes.jobs}
            className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            自动分组
          </Link>
        }
      />
      <PageSiteTabs sites={["1"]} />
      <SectionTabs items={sectionTabs} />

      {!loading && groups.length > 0 && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="筛选标题、作者、成员…"
            className="mb-3 h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
          />
          <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <FilterTabs
              options={FILTER_OPTS}
              value={filter}
              onChange={setFilter}
              className="mb-0"
            />
            <FilterTabs
              options={SORT_OPTS}
              value={sort}
              onChange={setSort}
              variant="primary"
              className="mb-0"
            />
          </div>
        </>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ListMeta>
          {q.trim() || filter === "fav"
            ? `显示 ${filtered.length} / ${groups.length} 组`
            : `共 ${groups.length} 组 · ${chapterTotal} 章`}
        </ListMeta>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={filtered.length === 0}
        onRetry={() => void reload()}
        emptyText={
          q.trim() || filter === "fav" ? (
            "没有匹配的分组"
          ) : (
            <span className="flex flex-col items-center gap-3">
              <span>还没有分组</span>
              <span className="max-w-xs text-xs leading-relaxed">
                可在列表点「搜索相似」创建，或用任务页从归档批量生成
              </span>
              <span className="flex flex-wrap justify-center gap-2">
                <Link
                  to={routes.jobs}
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  去任务 · 自动分组
                </Link>
                <Link
                  to={routes.archive}
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  查看归档
                </Link>
              </span>
            </span>
          )
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
