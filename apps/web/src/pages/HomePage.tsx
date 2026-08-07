import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { useSite } from "@/hooks/use-site"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { api, bookPath, readPath } from "@/lib/routes"
import { groupBooks } from "@/lib/book-groups"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

interface HomeResponse {
  links: ChapterLink[]
  nextMtid: string | null
}

export default function HomePage() {
  const site = useSite()
  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextMtid, setNextMtid] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [loadMoreError, setLoadMoreError] = useState("")

  const { isExpanded, toggle } = useExpandedBooks("home")
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

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const nextMtidRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const seqRef = useRef(0)

  useEffect(() => {
    nextMtidRef.current = nextMtid
    hasMoreRef.current = nextMtid !== null
  }, [nextMtid])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError("")

    const seq = seqRef.current
    try {
      const mtid = nextMtidRef.current
      const res = await fetch(`${api.posts}?mtid=${mtid ?? "0"}&site=${site}`)
      const json = (await res.json()) as HomeResponse
      // 换站/重拉（fetchFirstPage）会递增 seq；过期响应直接丢弃，避免混入旧站数据
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setLoadMoreError((json as { error?: string }).error || "请求失败")
        return
      }
      setLinks((prev) => {
        const seen = new Set(prev.map((l) => l.tid))
        return [...prev, ...json.links.filter((l) => !seen.has(l.tid))]
      })
      setNextMtid(json.nextMtid)
    } catch (e) {
      if (seq === seqRef.current) {
        setLoadMoreError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [site])

  const fetchFirstPage = useCallback(async () => {
    seqRef.current++ // 使在途 loadMore 响应失效（含换站场景）
    setInitialLoading(true)
    setError("")
    setLoadMoreError("")
    setLinks([])
    setNextMtid(null)
    try {
      const res = await fetch(`${api.posts}?site=${site}`)
      const json = (await res.json()) as HomeResponse
      if (!res.ok) {
        setError((json as { error?: string }).error || "请求失败")
        return
      }
      setLinks(json.links)
      setNextMtid(json.nextMtid)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setInitialLoading(false)
    }
  }, [site])

  useEffect(() => {
    fetchFirstPage()
  }, [fetchFirstPage])

  useEffect(() => {
    if (initialLoading || loadMoreError) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: "1200px 0px 0px 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore, initialLoading, loadMoreError, links.length])

  const noMore =
    !initialLoading && !error && nextMtid === null && links.length > 0

  return (
    <PageShell>
      <PageHeader
        title="时间线"
        description={
          !initialLoading && links.length > 0
            ? `已载入 ${links.length} 条 · 最新主帖`
            : "最新主帖更新"
        }
      />

      <AsyncBody
        loading={initialLoading}
        error={error}
        empty={links.length === 0}
        onRetry={fetchFirstPage}
        emptyText="暂无内容"
      >
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
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((l) => ({
                    tid: l.tid,
                    title: l.title,
                  })),
                }}
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

        {!loadMoreError && nextMtid !== null && (
          <div ref={sentinelRef} aria-hidden className="h-4" />
        )}

        {loadingMore && <Spinner className="py-8" />}

        {loadMoreError && (
          <div className="py-6 text-center">
            <p className="mb-3 text-sm text-destructive">{loadMoreError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadMoreError("")
                loadMore()
              }}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              加载更多 · 重试
            </button>
          </div>
        )}

        {noMore && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            已经到底了
          </p>
        )}
      </AsyncBody>
    </PageShell>
  )
}
