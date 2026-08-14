import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { PageSiteTabs } from "@/components/page-site-tabs"
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
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
import { groupBooks } from "@/lib/book-groups"
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
  siteUrl,
  type SiteId,
} from "@/lib/routes"

interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
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

export default function ArchivePage() {
  const site = useSite()
  const [searchParams, setSearchParams] = useSearchParams()
  const isBooks = site === "2"
  const defaultSort: SortKey = isBooks ? "archived_at" : "tid"
  const sort = parseSort(searchParams.get("sort"), site)
  const sortOptions = useMemo(() => {
    if (!isBooks) return SORT_OPTIONS
    return SORT_OPTIONS.filter((o) => o.value !== "tid").map((o) =>
      o.value === "archived_at"
        ? { ...o, title: "最新收录在前（第 1 页先入库）" }
        : o
    )
  }, [isBooks])
  const sectionTabs = useAllTabs(routes.archive)
  const q = parseQuery(searchParams)
  const page = parsePage(searchParams)

  const [items, setItems] = useState<ArchivePost[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [total, setTotal] = useState(0)
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
      const params = new URLSearchParams()
      params.set("sort", sort)
      params.set("page", String(page))
      // 评审问题 2：不带 site 会拉到默认站（1）的数据
      params.set("site", site)
      if (q) params.set("q", q)
      // 评审问题 4：书库 archived_at 默认 desc（最旧在前），要最新收录在前必须显式 asc
      if (isBooks && sort === "archived_at") params.set("order", "asc")
      const res = await fetch(`${api.meArchive}?${params.toString()}`)
      const json = (await res.json()) as {
        items: ArchivePost[]
        nextPage?: number
        total?: number
        error?: string
      }
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setItems(json.items ?? [])
      setNextPage(json.nextPage)
      setTotal(typeof json.total === "number" ? json.total : 0)
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [sort, page, q, site, isBooks])

  useEffect(() => {
    void reload()
  }, [reload])

  useScrollTop([page, sort, q])

  function update(next: { q?: string; sort?: SortKey; page?: number }) {
    const params = new URLSearchParams(searchParams)
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (next.sort !== undefined) {
      if (next.sort === defaultSort) params.delete("sort")
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
  const grouped = useMemo(() => {
    if (isBooks) return null
    return groupBooks(
      items,
      (it) => it.title,
      (it) => it.tid
    )
  }, [items, isBooks])

  function itemHref(it: ArchivePost): string {
    return it.site === "2"
      ? bookPath(it.tid, { site: it.site })
      : readPath(it.tid, it.site)
  }

  return (
    <PageShell maxWidth="xwide">
      <PageHeader
        title="目录"
        description={
          isBooks ? "本地全站书库目录（由任务同步）" : "本地全站主帖目录（由任务同步）"
        }
        action={
          <Link
            to={siteUrl(routes.jobs, site)}
            className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            更新目录
          </Link>
        }
      />
      <PageSiteTabs sites={["1", "2"]} />
      <SectionTabs items={sectionTabs} />

      <SearchForm
        value={draftQ}
        onChange={setDraftQ}
        placeholder="搜索标题…"
        onSubmit={(next) => update({ q: next, page: 1 })}
      />

      <FilterTabs
        options={sortOptions}
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
            hasNext: nextPage !== undefined,
          })}
        </ListMeta>
      )}

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={
          <>
            {q ? (
              "没有匹配的归档"
            ) : (
              <>
                还没有归档，去
                <Link
                  to={siteUrl(routes.jobs, site)}
                  className="text-foreground underline underline-offset-2"
                >
                  任务
                </Link>
                {isBooks ? "开始一次全站书库归档" : "开始一次全站主帖归档"}
              </>
            )}
          </>
        }
      >
        <PostList>
          {grouped
            ? grouped.map((g) =>
                g.type === "single" ? (
                  <ListPostCard
                    key={`${g.item.site}:${g.item.tid}`}
                    href={itemHref(g.item)}
                    rawTitle={g.item.title}
                    trailing={
                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                        #{g.item.tid}
                      </span>
                    }
                  />
                ) : (
                  <CollapsibleBookGroup
                    key={`group:${g.key}`}
                    title={g.title}
                    summary={
                      [g.author, g.genre].filter(Boolean).join(" · ") || undefined
                    }
                    count={g.items.length}
                    bookKey={g.key}
                    isExpanded={isExpanded(g.key)}
                    onToggle={() => toggle(g.key)}
                    trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
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
              )
            : items.map((it) => (
                <ListPostCard
                  key={`${it.site}:${it.tid}`}
                  href={itemHref(it)}
                  rawTitle={it.title}
                />
              ))}
        </PostList>
        <Pager
          page={page}
          hasNext={nextPage !== undefined}
          total={total}
          totalPages={calcTotalPages(total, ARCHIVE_PAGE_SIZE)}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => nextPage !== undefined && update({ page: nextPage })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
