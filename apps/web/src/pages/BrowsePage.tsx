import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, ErrorBox, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
import { api, bookPath, browsePath, parsePage, parseQuery, readPath } from "@/lib/routes"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

interface BrowseResponse {
  links: ChapterLink[]
  nextPage: number | null
}

function BrowseContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const site = useSite()
  const type = searchParams.get("type")
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (type) params.set("type", type)
    if (q) params.set("q", q)
    return params.toString()
  }, [type, q])

  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const { isExpanded, toggle } = useExpandedBooks("browse")
  const grouped = useMemo(() => {
    if (site !== "1") {
      return links.map((item) => ({ type: "single" as const, item }))
    }
    return groupBooks(links, (l) => l.title)
  }, [links, site])

  const loadPage = useCallback(
    async (p: number) => {
      if (!queryString) return
      const seq = ++seqRef.current
      setLinks([])
      setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.browse}?${queryString}&site=${site}&page=${p}`
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
    [queryString, site]
  )

  useEffect(() => {
    if (!queryString) {
      setLinks([])
      setNextPage(null)
      setError("")
      setLoading(false)
      return
    }
    loadPage(pageParam)
  }, [queryString, pageParam, loadPage])

  function goToPage(p: number) {
    navigate(browsePath({ type, q, page: p, site }))
  }

  return (
    <PageShell>
      <PageHeader
        title={queryString ? type || q || "分类" : "分类"}
        description={
          queryString
            ? !loading && links.length > 0
              ? `第 ${pageParam} 页 · ${links.length} 条`
              : `第 ${pageParam} 页`
            : "请从分类目录选择"
        }
      />

      {!queryString && <ErrorBox message="缺少分类参数，请从分类目录选择" />}

      {queryString && (
        <AsyncBody
          loading={loading}
          error={error}
          empty={links.length === 0}
          onRetry={() => loadPage(pageParam)}
          emptyText="暂无内容"
        >
          <PostList>
            {grouped.map((g) =>
              g.type === "single" ? (
                <ListPostCard
                  key={g.item.tid}
                  href={
                    site === "2"
                      ? bookPath(g.item.tid, { site })
                      : readPath(g.item.tid, site)
                  }
                  rawTitle={g.item.title}
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
              ),
            )}
          </PostList>
          <Pager
            page={pageParam}
            hasNext={nextPage !== null}
            onPrev={() => goToPage(pageParam - 1)}
            onNext={() => nextPage !== null && goToPage(nextPage)}
            disabled={loading}
          />
        </AsyncBody>
      )}
    </PageShell>
  )
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <Spinner />
        </PageShell>
      }
    >
      <BrowseContent />
    </Suspense>
  )
}
