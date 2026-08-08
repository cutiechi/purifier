import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import {
  FilterTabs,
  ListMeta,
  SearchForm,
  useScrollTop,
} from "@/components/form-controls"
import { GenrePill } from "@/components/list-post-card"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { SimilarMeItemCard } from "@/components/similar-me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { SectionTabs } from "@/components/section-tabs"
import { PostList } from "@/components/post-card"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { groupMeListItems } from "@/lib/book-groups"
import { useMeTabs } from "@/lib/hub-tabs"
import { useLocation } from "react-router-dom"
import {
  formatListPagination,
  ME_PAGE_SIZE,
  totalPages as calcTotalPages,
} from "@/lib/list-meta"
import { parsePage, parseQuery } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"

export type MeListPick = (json: Record<string, unknown>) => {
  items: MeListItem[]
  nextPage?: number
  total?: number
}

export function MeListPage({
  title,
  description,
  buildUrl,
  pick,
  renderTrailing,
  toolbar,
  emptyText,
  bookGroupScope,
}: {
  title: string
  description?: string
  /** (q, kind, page) → 完整请求 URL */
  buildUrl: (q: string, kind: string, page: number) => string
  pick: MeListPick
  renderTrailing?: (item: MeListItem, reload: () => void) => ReactNode
  /** 列表上方可选操作区（历史清空等） */
  toolbar?: (ctx: {
    items: MeListItem[]
    reload: () => void
    loading: boolean
  }) => ReactNode
  emptyText?: string
  /** 传入则启用同书折叠分组（值为 scope，如 'history'/'favorites'/'me-items'） */
  bookGroupScope?: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)

  const url = useMemo(() => buildUrl(q, kind, page), [buildUrl, q, kind, page])
  const pickRef = useRef(pick)
  pickRef.current = pick

  const [items, setItems] = useState<MeListItem[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const res = await fetch(url)
      const json = (await res.json()) as Record<string, unknown>
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(String(json.error || "请求失败"))
        return
      }
      const data = pickRef.current(json)
      setItems(data.items)
      setNextPage(data.nextPage)
      setTotal(typeof data.total === "number" ? data.total : 0)
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void reload()
  }, [reload])

  useScrollTop([page, kind, q])

  const { isExpanded, toggle } = useExpandedBooks(bookGroupScope ?? "__noop__")
  const grouped = useMemo(() => {
    if (!bookGroupScope) return null
    return groupMeListItems(items)
  }, [items, bookGroupScope])

  function update(next: { q?: string; kind?: string; page?: number }) {
    const params = new URLSearchParams(searchParams)
    const changeQ = next.q !== undefined
    const changeKind = next.kind !== undefined
    if (changeQ) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (changeKind) {
      if (next.kind) params.set("kind", next.kind)
      else params.delete("kind")
    }
    if (next.page !== undefined && next.page > 1) {
      params.set("page", String(next.page))
    } else if (changeQ || changeKind || next.page === 1) {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  const KIND_TABS = [
    { value: "", label: "全部" },
    { value: "post", label: "贴子" },
    { value: "book", label: "书库" },
  ] as const

  return (
    <PageShell>
      <PageHeader
        title="我的"
        description={description ?? title}
      />
      <PageSiteTabs />
      <SectionTabs items={sectionTabs} />

      <SearchForm
        key={q}
        defaultValue={q}
        placeholder="搜索标题或标签…"
        onSubmit={(next) => update({ q: next, page: 1 })}
      />

      <FilterTabs
        options={KIND_TABS.map((t) => ({
          value: t.value as string,
          label: t.label,
        }))}
        value={kind}
        onChange={(v) => update({ kind: v, page: 1 })}
      />

      {toolbar?.({ items, reload, loading })}

      {!loading && !error && items.length > 0 && (
        <ListMeta>
          {formatListPagination({
            page,
            pageCount: items.length,
            pageSize: ME_PAGE_SIZE,
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
          emptyText ??
          (q || kind ? "没有匹配的内容" : "暂无内容")
        }
      >
        <PostList>
          {(
            grouped ?? items.map((item) => ({ type: "single" as const, item }))
          ).map((g) =>
            g.type === "single" ? (
              <SimilarMeItemCard
                key={`${g.item.kind}:${g.item.id}`}
                item={g.item}
                trailing={renderTrailing?.(g.item, reload)}
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((it) => ({
                    tid: it.id,
                    title: it.title,
                  })),
                }}
              >
                {g.items.map((item) => {
                  const parsed = parseListTitle(item.title)
                  // 组内主标题已用章节号，副标题不再重复（从作者开始）；保留
                  // 进度后缀（避免信息丢失）。时间/访问次数由组级上下文决定。
                  const sub = formatTitleMeta(
                    parsed.chapters ? { ...parsed, chapters: null } : parsed
                  )
                  const subWithProgress =
                    (sub ? `${sub}` : "") +
                    (typeof item.read_progress === "number" &&
                    item.read_progress > 0
                      ? `${sub ? " · " : ""}已读 ${Math.round(item.read_progress * 100)}%`
                      : "")
                  return (
                    <MeItemCard
                      key={`${item.kind}:${item.id}`}
                      item={item}
                      trailing={renderTrailing?.(item, reload)}
                      titleOverride={parsed.chapters || undefined}
                      subtitleOverride={subWithProgress || undefined}
                    />
                  )
                })}
              </CollapsibleBookGroup>
            )
          )}
        </PostList>
        <Pager
          page={page}
          hasNext={nextPage !== undefined}
          total={total}
          totalPages={calcTotalPages(total, ME_PAGE_SIZE)}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => nextPage !== undefined && update({ page: nextPage })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
