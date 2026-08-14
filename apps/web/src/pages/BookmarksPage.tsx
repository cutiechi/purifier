import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { useConfirm } from "@/components/confirm-dialog"
import {
  ListMeta,
  SearchForm,
  useScrollTop,
} from "@/components/form-controls"
import { type Bookmark } from "@/hooks/use-bookmarks"
import { PageHeader } from "@/components/page-header"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { SectionTabs } from "@/components/section-tabs"
import { formatDateTime } from "@/lib/format"
import { useMeTabs } from "@/lib/hub-tabs"
import {
  formatListPagination,
  ME_PAGE_SIZE,
  totalPages as calcTotalPages,
} from "@/lib/list-meta"
import {
  api,
  bookPath,
  meListQuery,
  parsePage,
  parseQuery,
  readPath,
  SITES,
} from "@/lib/routes"

/** 书签跳回原文/原章节，带 bm 定位摘录 */
function bookmarkHref(item: Bookmark): string {
  return item.kind === "post"
    ? readPath(item.itemId, item.site, String(item.id))
    : bookPath(item.itemId, {
        site: item.site,
        chapter: item.chapter != null ? String(item.chapter) : undefined,
        bm: String(item.id),
      })
}

function DeleteBookmarkButton({
  item,
  reload,
}: {
  item: Bookmark
  reload: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const ok = await confirm({
          title: "删除书签？",
          description: `移除「${item.title}」的这条摘录。`,
          confirmLabel: "删除",
          destructive: true,
        })
        if (!ok) return
        setBusy(true)
        try {
          const res = await fetch(`${api.meBookmarks}/${item.id}`, {
            method: "DELETE",
          })
          if (res.ok) reload()
        } finally {
          setBusy(false)
        }
      }}
      className="min-h-9 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:min-h-0"
    >
      删除
    </button>
  )
}

function BookmarkCard({
  item,
  reload,
}: {
  item: Bookmark
  reload: () => void
}) {
  return (
    <div className="group flex flex-col rounded-2xl border border-border/80 bg-card/80 px-3.5 py-3.5 shadow-sm transition-all duration-200 hover:border-border sm:px-4 sm:py-4">
      <div className="flex items-start gap-2 sm:gap-3">
        <Link
          to={bookmarkHref(item)}
          className="flex min-w-0 flex-1 flex-col gap-2"
        >
          <p className="line-clamp-3 border-l-2 border-sky-500/40 pl-3 text-sm leading-relaxed text-foreground">
            {item.quote}
          </p>
          <span className="text-xs text-muted-foreground">
            {[
              item.note,
              item.title,
              SITES[item.site]?.label ?? item.site,
              item.chapter != null ? `第 ${item.chapter} 章` : null,
              formatDateTime(item.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
        <div className="flex shrink-0 items-center self-center">
          <DeleteBookmarkButton item={item} reload={reload} />
        </div>
      </div>
    </div>
  )
}

export default function BookmarksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)

  const url = useMemo(() => {
    const qs = meListQuery({ q, kind, page })
    return `${api.meBookmarks}${qs ? `?${qs}` : ""}`
  }, [q, kind, page])

  const [items, setItems] = useState<Bookmark[]>([])
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
      const json = (await res.json()) as {
        items?: Bookmark[]
        nextPage?: number
        total?: number
        error?: string
      }
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(String(json.error || "请求失败"))
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
  }, [url])

  useEffect(() => {
    void reload()
  }, [reload])

  // 删光本页或筛选后页码越界 → 回退到最后一页
  useEffect(() => {
    if (loading || error) return
    if (total <= 0) return
    const maxPage = calcTotalPages(total, ME_PAGE_SIZE)
    if (page > maxPage) {
      const params = new URLSearchParams(searchParams)
      if (maxPage > 1) params.set("page", String(maxPage))
      else params.delete("page")
      setSearchParams(params, { replace: true })
    }
  }, [loading, error, total, page, searchParams, setSearchParams])

  useScrollTop([page, kind, q])

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

  return (
    <PageShell>
      <PageHeader title="书签" description="正文里钉下的摘录" />
      <SectionTabs items={sectionTabs} />

      <SearchForm
        key={q}
        defaultValue={q}
        placeholder="搜索摘录、备注或标题…"
        onSubmit={(next) => update({ q: next, page: 1 })}
      />

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
          q || kind
            ? "没有匹配的书签"
            : "还没有书签，阅读时选中正文即可添加"
        }
      >
        <PostList>
          {items.map((item) => (
            <BookmarkCard key={item.id} item={item} reload={reload} />
          ))}
        </PostList>
        <Pager
          page={page}
          hasNext={nextPage !== undefined}
          total={total}
          totalPages={calcTotalPages(total, ME_PAGE_SIZE)}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => nextPage !== undefined && update({ page: nextPage })}
          onPage={(n) => update({ page: n })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
