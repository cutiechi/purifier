import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Link,
  Navigate,
  useLocation,
  useSearchParams,
} from "react-router-dom"
import { ChevronDown, Star, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import {
  FilterTabs,
  ListMeta,
  SearchForm,
  useScrollTop,
} from "@/components/form-controls"
import { IconBookOpen } from "@/components/icons"
import { GenrePill } from "@/components/list-post-card"
import { PageHeader } from "@/components/page-header"
import { PageShell, Pager } from "@/components/page-shell"
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
import {
  formatListPagination,
  ME_PAGE_SIZE,
  totalPages as calcTotalPages,
} from "@/lib/list-meta"
import { api, parsePage, parseQuery, readPath, routes } from "@/lib/routes"
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

  const parsed = parseListTitle(group.title)
  const meta = formatTitleMeta(
    parsed.chapters ? { ...parsed, chapters: null } : parsed
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-sm">
      <div className="flex items-stretch gap-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3.5 text-left transition-colors hover:bg-accent/40 sm:px-4"
        >
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <IconBookOpen size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
                {group.title}
              </span>
              {group.favorited && (
                <Star
                  size={13}
                  className="shrink-0 fill-amber-400 text-amber-500"
                  aria-label="已收藏"
                />
              )}
              {group.genre && <GenrePill genre={group.genre} />}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{group.items.length} 章</span>
              {group.author && <span>· {group.author}</span>}
              {meta && <span className="opacity-80">· {meta}</span>}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={cn(
              "mt-2 shrink-0 text-muted-foreground transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        </button>
      </div>

      {localError && (
        <p className="border-t border-border/60 px-3.5 py-2 text-xs text-destructive sm:px-4">
          {localError}
        </p>
      )}

      {isExpanded && (
        <div className="border-t border-border/60 px-3.5 py-3 sm:px-4">
          <ul className="mb-3 space-y-1">
            {members.map((m) => {
              const mp = parseListTitle(m.title)
              const sub = formatTitleMeta(
                mp.chapters ? { ...mp, chapters: null } : mp
              )
              return (
                <li
                  key={m.tid}
                  className="flex items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-1.5"
                >
                  <Link
                    to={readPath(m.tid)}
                    className="min-w-0 flex-1 transition-colors hover:text-foreground"
                  >
                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                      {mp.chapters || m.title}
                    </span>
                    {sub && (
                      <span className="text-xs text-muted-foreground">
                        {sub}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void removeMember(m.tid, mp.chapters || m.title)
                    }
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    移除
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleFavorite()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Star
                size={13}
                className={cn(
                  group.favorited && "fill-amber-400 text-amber-500"
                )}
              />
              {group.favorited ? "取消收藏" : "收藏分组"}
            </button>
            <SimilarTrigger
              open={showSimilar}
              onToggle={() => setShowSimilar((v) => !v)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteGroup()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 size={13} />
              删除分组
            </button>
          </div>
          {showSimilar && (
            <div className="mt-3">
              <SimilarSearchPanel
                title={group.title}
                groupKey={group.key}
                seedItems={group.items}
                onChanged={onChanged}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function groupsListUrl(opts: {
  q: string
  filter: FilterKey
  sort: SortKey
  page: number
}): string {
  const params = new URLSearchParams()
  params.set("page", String(opts.page))
  params.set("limit", String(ME_PAGE_SIZE))
  if (opts.q) params.set("q", opts.q)
  if (opts.filter === "fav") params.set("favorited", "1")
  if (opts.sort !== "updated") params.set("sort", opts.sort)
  return `${api.meGroups}?${params.toString()}`
}

export default function GroupPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  const [searchParams, setSearchParams] = useSearchParams()
  const q = parseQuery(searchParams)
  const filter: FilterKey =
    searchParams.get("filter") === "fav" ? "fav" : "all"
  const sortRaw = searchParams.get("sort")
  const sort: SortKey =
    sortRaw === "title" || sortRaw === "chapters" ? sortRaw : "updated"
  const page = parsePage(searchParams)

  const [groups, setGroups] = useState<Group[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>()
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draftQ, setDraftQ] = useState(q)
  const seqRef = useRef(0)
  const { isExpanded, toggle } = useExpandedBooks("groups")

  useEffect(() => {
    setDraftQ(q)
  }, [q])

  const listUrl = useMemo(
    () => groupsListUrl({ q, filter, sort, page }),
    [q, filter, sort, page]
  )

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      const seq = ++seqRef.current
      if (!opts?.silent) setLoading(true)
      setError("")
      try {
        const res = await fetch(listUrl)
        const json = (await res.json()) as {
          items?: Group[]
          nextPage?: number
          total?: number
          error?: string
        }
        if (seq !== seqRef.current) return
        if (!res.ok) {
          setError(String(json.error || "请求失败"))
          return
        }
        setGroups(json.items ?? [])
        setNextPage(json.nextPage)
        setTotal(typeof json.total === "number" ? json.total : 0)
      } catch (e) {
        if (seq === seqRef.current) {
          setError(e instanceof Error ? e.message : "未知错误")
        }
      } finally {
        if (seq === seqRef.current && !opts?.silent) setLoading(false)
      }
    },
    [listUrl]
  )

  useEffect(() => {
    if (site === "1") void reload()
  }, [reload, site])

  function update(next: {
    q?: string
    filter?: FilterKey
    sort?: SortKey
    page?: number
  }) {
    const params = new URLSearchParams(searchParams)
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (next.filter !== undefined) {
      if (next.filter === "fav") params.set("filter", "fav")
      else params.delete("filter")
    }
    if (next.sort !== undefined) {
      if (next.sort === "updated") params.delete("sort")
      else params.set("sort", next.sort)
    }
    const resetPage =
      next.q !== undefined ||
      next.filter !== undefined ||
      next.sort !== undefined ||
      next.page === 1
    if (next.page !== undefined && next.page > 1) {
      params.set("page", String(next.page))
    } else if (resetPage || next.page === 1) {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  // 删光当前页 / 筛选后页码越界 → 回到合法最后一页
  useEffect(() => {
    if (loading || error) return
    if (total <= 0) return
    const maxPage = calcTotalPages(total, ME_PAGE_SIZE)
    if (page > maxPage) update({ page: maxPage })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only on total/page
  }, [loading, error, total, page])

  // 搜索防抖写 URL
  useEffect(() => {
    if (draftQ === q) return
    const t = setTimeout(() => update({ q: draftQ.trim(), page: 1 }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only draftQ
  }, [draftQ])

  useScrollTop([page, filter, sort, q])

  if (site !== "1") {
    return <Navigate to={`${routes.history}?site=${site}`} replace />
  }

  const pages = calcTotalPages(total, ME_PAGE_SIZE)

  return (
    <PageShell>
      <PageHeader
        title="我的"
        description={
          !loading && total > 0
            ? `分组 · 共 ${total} 组`
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

      <SearchForm
        value={draftQ}
        onChange={setDraftQ}
        placeholder="搜索标题、作者、成员…"
        onSubmit={(next) => update({ q: next, page: 1 })}
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterTabs
          options={FILTER_OPTS}
          value={filter}
          onChange={(v) => update({ filter: v as FilterKey, page: 1 })}
          className="mb-0"
        />
        <FilterTabs
          options={SORT_OPTS}
          value={sort}
          onChange={(v) => update({ sort: v as SortKey, page: 1 })}
          variant="primary"
          className="mb-0"
        />
      </div>

      {!loading && !error && total > 0 && (
        <ListMeta>
          {formatListPagination({
            page,
            pageCount: groups.length,
            pageSize: ME_PAGE_SIZE,
            total,
            hasNext: nextPage !== undefined,
          })}
        </ListMeta>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={groups.length === 0}
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
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              isExpanded={isExpanded(`group:${g.id}`)}
              onToggle={() => toggle(`group:${g.id}`)}
              onChanged={() => void reload({ silent: true })}
            />
          ))}
        </PostList>
        {(total > ME_PAGE_SIZE || nextPage !== undefined) && (
          <Pager
            page={page}
            hasNext={nextPage !== undefined}
            totalPages={pages}
            total={total}
            onPrev={() => update({ page: Math.max(1, page - 1) })}
            onNext={() => update({ page: page + 1 })}
            disabled={loading}
          />
        )}
      </AsyncBody>
    </PageShell>
  )
}
