import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, EmptyState } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { PostList } from "@/components/post-card"
import { ListPostCard, GenrePill } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { SimilarPostCard } from "@/components/similar-post-card"
import { SiteTabs } from "@/components/site-tabs"
import { SearchForm, ListMeta, useScrollTop } from "@/components/form-controls"
import { groupBooks, type GroupedItem } from "@/lib/book-groups"
import { formatListPagination } from "@/lib/list-meta"
import { useSite } from "@/hooks/use-site"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { api, bookPath, forumRoutes, libraryRoutes, parsePage, parseQuery, readPath, searchPath } from "@/lib/routes"
import type { ChapterLink } from "@/lib/types"
import { compareTid } from "@/lib/groups"

interface BrowseResponse {
  links: ChapterLink[] | null
  nextPage: number | null
  category?: string
  error?: string
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : "未知错误"
}

/** 单源搜索：论坛 /cool-18/search，书库 /xbook-cn/search（源由路径前缀表达） */
export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const site = useSite()
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)
  const isLibrary = site === "2"

  const [input, setInput] = useState(q)
  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const { isExpanded, toggle } = useExpandedBooks("search")
  const grouped = useMemo(
    () => groupBooks(links, (l) => l.title, (l) => l.tid),
    [links]
  )

  useEffect(() => {
    setInput(q)
  }, [q])

  useScrollTop([q, pageParam])

  const loadPage = useCallback(
    async (keyword: string, p: number) => {
      const seq = ++seqRef.current
      setLinks([])
      setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.browse}?q=${encodeURIComponent(keyword)}&site=${site}&page=${p}`
        )
        const json = (await res.json()) as BrowseResponse
        if (seq !== seqRef.current) return
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        const hits = json.links ?? []
        // 章节顺序：按 tid 升序（与折叠组内成员排序一致）
        setLinks([...hits].sort((a, b) => compareTid(a.tid, b.tid)))
        setNextPage(json.nextPage)
      } catch (e) {
        if (seq === seqRef.current) setError(msgOf(e))
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    },
    [site]
  )

  useEffect(() => {
    if (!q) {
      setLinks([])
      setNextPage(null)
      setError("")
      setLoading(false)
      return
    }
    loadPage(q, pageParam)
  }, [q, pageParam, loadPage])

  function goTo(keyword: string, p: number) {
    navigate(searchPath({ q: keyword, page: p, site }))
  }

  function renderGrouped(g: GroupedItem<ChapterLink>) {
    if (g.type === "single") {
      const item = g.item
      return isLibrary ? (
        <ListPostCard
          key={item.tid}
          href={bookPath(item.tid)}
          rawTitle={item.title}
          showGenre
        />
      ) : (
        <SimilarPostCard
          key={item.tid}
          href={readPath(item.tid)}
          rawTitle={item.title}
          tid={item.tid}
          site="1"
          showGenre
        />
      )
    }
    return (
      <CollapsibleBookGroup
        key={`group:${g.key}`}
        title={g.title}
        summary={g.author ?? undefined}
        count={g.items.length}
        bookKey={g.key}
        isExpanded={isExpanded(g.key)}
        onToggle={() => toggle(g.key)}
        trailing={
          g.genre ? (
            <span className="flex shrink-0 items-center gap-2">
              <GenrePill genre={g.genre} />
            </span>
          ) : undefined
        }
        similar={
          !isLibrary
            ? {
                title: g.title,
                groupKey: g.key,
                seedItems: g.items.map((l) => ({
                  tid: l.tid,
                  title: l.title,
                })),
              }
            : undefined
        }
      >
        {g.items.map((link) => (
          <ListPostCard
            key={link.tid}
            href={isLibrary ? bookPath(link.tid) : readPath(link.tid)}
            rawTitle={link.title}
            showGenre
          />
        ))}
      </CollapsibleBookGroup>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="搜索"
        description={
          q && !loading && links.length > 0
            ? `「${q}」· 第 ${pageParam} 页 · ${links.length} 条`
            : isLibrary
              ? "搜索书库书籍"
              : "搜索论坛帖子"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": `${forumRoutes.search}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
              "2": `${libraryRoutes.search}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
            }}
          />
        }
      />

      <SearchForm
        value={input}
        onChange={setInput}
        placeholder={isLibrary ? "输入书名关键词" : "输入关键词"}
        maxLength={40}
        showIcon
        buttonLabel="搜索"
        className="mb-6 sm:mb-8"
        onSubmit={(next) => {
          if (!next) return
          goTo(next, 1)
        }}
      />

      {!q && !loading ? (
        <EmptyState>输入关键词开始搜索</EmptyState>
      ) : (
        <AsyncBody
          loading={loading}
          error={error}
          empty={!!q && links.length === 0}
          onRetry={() => q && loadPage(q, pageParam)}
          emptyText={q ? `没有找到「${q}」相关内容` : "输入关键词开始搜索"}
        >
          <ListMeta>
            {formatListPagination({
              page: pageParam,
              pageCount: links.length,
              pageSize: Math.max(links.length, 1),
              hasNext: nextPage !== null,
            })}
          </ListMeta>
          <PostList>{grouped.map((g) => renderGrouped(g))}</PostList>
          <Pager
            page={pageParam}
            hasNext={nextPage !== null}
            onPrev={() => goTo(q, pageParam - 1)}
            onNext={() => nextPage !== null && goTo(q, nextPage)}
            disabled={loading}
          />
        </AsyncBody>
      )}
    </PageShell>
  )
}
