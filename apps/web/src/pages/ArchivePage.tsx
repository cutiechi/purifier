import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type ReactNode } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { SectionTabs } from "@/components/section-tabs"
import {
  FilterTabs,
  ListMeta,
  SearchForm,
  useScrollTop,
} from "@/components/form-controls"
import { GenrePill, ListPostCard } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { PostList } from "@/components/post-card"
import { SourceBadge } from "@/components/source-badge"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { groupBooks, type GroupedItem } from "@/lib/book-groups"
import { useAllTabs } from "@/lib/hub-tabs"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import {
  ARCHIVE_PAGE_SIZE,
  formatListPagination,
  totalPages as calcTotalPages,
} from "@/lib/list-meta"
import {
  api,
  bookPath,
  parsePage,
  parseQuery,
  readPath,
  routes,
  type SiteId,
} from "@/lib/routes"

interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
}

interface ArchivePageData {
  items: ArchivePost[]
  nextPage?: number
  total: number
}

type SortKey = "title" | "tid" | "archived_at"

const SORT_OPTIONS: { value: SortKey; label: string; title: string }[] = [
  { value: "tid", label: "按 tid", title: "帖子编号新→旧" },
  { value: "title", label: "按标题", title: "标题字母序" },
  { value: "archived_at", label: "按归档时间", title: "最近入库/更新" },
]

function parseSort(raw: string | null, site: SiteId): SortKey {
  if (raw === "title" || raw === "archived_at") return raw
  // 书库 tid 是 base64 cid（CAST(tid AS INTEGER) 恒 0），按 tid 排序无意义
  return site === "2" ? "archived_at" : "tid"
}

function buildParams(
  sort: SortKey,
  site: SiteId,
  page: number,
  q: string
): string {
  const params = new URLSearchParams()
  params.set("sort", sort)
  params.set("page", String(page))
  params.set("site", site)
  if (q) params.set("q", q)
  // 书库 archived_at 默认 desc（最旧在前），要最新收录在前必须显式 asc
  if (site === "2" && sort === "archived_at") params.set("order", "asc")
  return params.toString()
}

const EMPTY: ArchivePageData = { items: [], total: 0 }

/** 目录：论坛 + 书库归档同页合并（带来源徽标），不再用站点 Tab 切换 */
export default function ArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSort = searchParams.get("sort")
  // UI 高亮用论坛侧排序键（书库侧 tid 自动回落 archived_at）
  const sort = parseSort(rawSort, "1")
  const sectionTabs = useAllTabs(routes.archive)
  const q = parseQuery(searchParams)
  const page = parsePage(searchParams)

  const [forum, setForum] = useState<ArchivePageData>(EMPTY)
  const [library, setLibrary] = useState<ArchivePageData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draftQ, setDraftQ] = useState(q)
  const seqRef = useRef(0)

  // URL q 变化时同步输入框（浏览器前进/后退）
  useEffect(() => {
    setDraftQ(q)
  }, [q])

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const [forumRes, libraryRes] = await Promise.all([
        fetch(`${api.meArchive}?${buildParams(parseSort(rawSort, "1"), "1", page, q)}`),
        fetch(`${api.meArchive}?${buildParams(parseSort(rawSort, "2"), "2", page, q)}`),
      ])
      const parse = async (
        res: Response,
        fallback: ArchivePageData
      ): Promise<ArchivePageData> => {
        const json = (await res.json()) as {
          items?: ArchivePost[]
          nextPage?: number
          total?: number
          error?: string
        }
        if (!res.ok) throw new Error(json.error || "请求失败")
        return {
          items: json.items ?? [],
          nextPage: json.nextPage,
          total: typeof json.total === "number" ? json.total : 0,
        }
      }
      const [f, l] = await Promise.all([
        parse(forumRes, EMPTY),
        parse(libraryRes, EMPTY),
      ])
      if (seq !== seqRef.current) return
      setForum(f)
      setLibrary(l)
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [rawSort, page, q])

  useEffect(() => {
    void reload()
  }, [reload])

  useScrollTop([page, sort, q])

  const total = forum.total + library.total
  const items = useMemo(
    () => [...forum.items, ...library.items],
    [forum.items, library.items]
  )
  const hasNext = forum.nextPage !== undefined || library.nextPage !== undefined
  const maxPages = Math.max(
    calcTotalPages(forum.total, ARCHIVE_PAGE_SIZE),
    calcTotalPages(library.total, ARCHIVE_PAGE_SIZE)
  )

  // 页码越界 → 回退到最后一页（两站页数取大者）
  useEffect(() => {
    if (loading || error) return
    if (maxPages <= 0) return
    if (page > maxPages) update({ page: maxPages })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp only on totals/page
  }, [loading, error, page, maxPages])

  function update(next: { q?: string; sort?: SortKey; page?: number }) {
    const params = new URLSearchParams(searchParams)
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (next.sort !== undefined) {
      if (next.sort === "tid") params.delete("sort")
      else params.set("sort", next.sort)
    }
    const pageChanged = next.page !== undefined
    const resetPage =
      next.q !== undefined || next.sort !== undefined || next.page === 1
    if (pageChanged && next.page! > 1) {
      params.set("page", String(next.page))
    } else if (resetPage || (pageChanged && next.page === 1)) {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  // 搜索防抖写 URL
  useEffect(() => {
    if (draftQ === q) return
    const t = setTimeout(() => update({ q: draftQ.trim(), page: 1 }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only draftQ
  }, [draftQ])

  const { isExpanded, toggle } = useExpandedBooks("archive")
  const forumGrouped = useMemo(
    () =>
      groupBooks(
        forum.items,
        (it) => it.title,
        (it) => it.tid
      ),
    [forum.items]
  )
  const libraryGrouped = useMemo(
    () =>
      groupBooks(
        library.items,
        (it) => it.title,
        (it) => it.tid
      ),
    [library.items]
  )

  function itemHref(it: ArchivePost): string {
    return it.site === "2"
      ? bookPath(it.tid, { site: it.site })
      : readPath(it.tid, it.site)
  }

  function renderGrouped(g: GroupedItem<ArchivePost>, badge: ReactNode) {
    if (g.type === "single") {
      const item = g.item
      return (
        <ListPostCard
          key={`${item.site}:${item.tid}`}
          href={itemHref(item)}
          rawTitle={item.title}
          trailing={
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground/70 tabular-nums">
                #{item.tid}
              </span>
              {badge}
            </span>
          }
        />
      )
    }
    return (
      <CollapsibleBookGroup
        key={`group:${g.key}`}
        title={g.title}
        summary={[g.author, g.genre].filter(Boolean).join(" · ") || undefined}
        count={g.items.length}
        bookKey={g.key}
        isExpanded={isExpanded(g.key)}
        onToggle={() => toggle(g.key)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            {g.genre ? <GenrePill genre={g.genre} /> : null}
            {badge}
          </span>
        }
      >
        {g.items.map((it) => {
          const parsed = parseListTitle(it.title)
          const sub = formatTitleMeta(
            parsed.chapters ? { ...parsed, chapters: null } : parsed
          )
          return (
            <Link
              key={`${it.site}:${it.tid}`}
              to={itemHref(it)}
              className="flex min-h-11 items-center gap-2 border-t border-border/50 px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/40 sm:px-4"
            >
              <span className="min-w-0 flex-1 line-clamp-2 font-medium text-foreground">
                {parsed.chapters || parsed.title}
              </span>
              {sub && (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {sub}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
                #{it.tid}
              </span>
            </Link>
          )
        })}
      </CollapsibleBookGroup>
    )
  }

  return (
    <PageShell maxWidth="xwide">
      <PageHeader
        title="目录"
        description="本地全站归档 · 论坛与书库（由任务同步）"
        action={
          <Link
            to={routes.jobs}
            className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            更新目录
          </Link>
        }
      />
      <SectionTabs items={sectionTabs} />
      <SearchForm
        value={draftQ}
        onChange={setDraftQ}
        placeholder="搜索标题…"
        onSubmit={(next) => update({ q: next, page: 1 })}
      />

      <FilterTabs
        options={SORT_OPTIONS}
        value={sort}
        onChange={(v) => update({ sort: v, page: 1 })}
        variant="primary"
      />

      {!loading && !error && items.length > 0 && (
        <ListMeta>
          {formatListPagination({
            page,
            pageCount: items.length,
            pageSize: ARCHIVE_PAGE_SIZE,
            total,
            hasNext,
          })}
        </ListMeta>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={
          q ? (
            "没有匹配的归档"
          ) : (
            <>
              还没有归档，去
              <Link
                to={routes.jobs}
                className="text-foreground underline underline-offset-2"
              >
                任务
              </Link>
              开始一次全站归档
            </>
          )
        }
      >
        <PostList>
          {forumGrouped.map((g) =>
            renderGrouped(g, <SourceBadge site="1" />)
          )}
          {libraryGrouped.map((g) =>
            renderGrouped(g, <SourceBadge site="2" />)
          )}
        </PostList>
        <Pager
          page={page}
          hasNext={hasNext}
          total={total}
          totalPages={maxPages}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => hasNext && update({ page: page + 1 })}
          onPage={(n) => update({ page: n })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
