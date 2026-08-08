import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { ListMeta, SearchForm, useScrollTop } from "@/components/form-controls"
import { formatListPagination } from "@/lib/list-meta"
import { useSite } from "@/hooks/use-site"
import {
  api,
  bookPath,
  parsePage,
  parseQuery,
  readPath,
  searchPath,
} from "@/lib/routes"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

interface BrowseResponse {
  links: ChapterLink[]
  nextPage: number | null
}

function SearchContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const site = useSite()
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)

  const [input, setInput] = useState(q)
  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const { isExpanded, toggle } = useExpandedBooks("search")
  const grouped = useMemo(() => {
    if (site !== "1") {
      return links.map((item) => ({ type: "single" as const, item }))
    }
    return groupBooks(
      links,
      (l) => l.title,
      (l) => l.tid
    )
  }, [links, site])

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
          setError((json as { error?: string }).error || "请求失败")
          return
        }
        setLinks(json.links)
        setNextPage(json.nextPage)
      } catch (e) {
        if (seq === seqRef.current) {
          setError(e instanceof Error ? e.message : "未知错误")
        }
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

  return (
    <PageShell>
      <PageHeader
        title="搜索"
        description={
          q && !loading && links.length > 0
            ? `「${q}」· 第 ${pageParam} 页 · ${links.length} 条`
            : "按关键词检索帖子"
        }
      />

      <SearchForm
        value={input}
        onChange={setInput}
        placeholder="输入关键词"
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
        <AsyncBody
          loading={false}
          error=""
          empty
          emptyText="输入关键词开始搜索"
        >
          {null}
        </AsyncBody>
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
          <PostList>
            {grouped.map((g) =>
              g.type === "single" ? (
                <SimilarPostCard
                  key={g.item.tid}
                  href={
                    site === "2"
                      ? bookPath(g.item.tid, { site })
                      : readPath(g.item.tid, site)
                  }
                  rawTitle={g.item.title}
                  tid={g.item.tid}
                  site={site}
                  showGenre
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
                  similar={
                    site !== "2"
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
                      href={readPath(link.tid, site)}
                      rawTitle={link.title}
                      showGenre
                    />
                  ))}
                </CollapsibleBookGroup>
              )
            )}
          </PostList>
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

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <Spinner />
        </PageShell>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
