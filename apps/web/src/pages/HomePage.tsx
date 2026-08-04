
import { useCallback, useEffect, useRef, useState } from "react"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { api, readPath } from "@/lib/routes"

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
  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextMtid, setNextMtid] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [loadMoreError, setLoadMoreError] = useState("")

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const nextMtidRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    nextMtidRef.current = nextMtid
    hasMoreRef.current = nextMtid !== null
  }, [nextMtid])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError("")

    try {
      const mtid = nextMtidRef.current
      const res = await fetch(`${api.posts}?mtid=${mtid ?? "0"}`)
      const json = (await res.json()) as HomeResponse
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
      setLoadMoreError(e instanceof Error ? e.message : "未知错误")
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [])

  const fetchFirstPage = useCallback(async () => {
    setInitialLoading(true)
    setError("")
    setLoadMoreError("")
    setLinks([])
    setNextMtid(null)
    try {
      const res = await fetch(api.posts)
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
  }, [])

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
          {links.map((link) => (
            <ListPostCard
              key={link.tid}
              href={readPath(link.tid)}
              rawTitle={link.title}
              showGenre
            />
          ))}
        </PostList>

        {!loadMoreError && nextMtid !== null && (
          <div ref={sentinelRef} aria-hidden className="h-4" />
        )}

        {loadingMore && <Spinner className="py-8" />}

        {loadMoreError && (
          <div className="py-6 text-center">
            <p className="text-destructive mb-3 text-sm">{loadMoreError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadMoreError("")
                loadMore()
              }}
              className="border-border bg-card text-foreground hover:bg-accent rounded-xl border px-4 py-2 text-sm font-medium"
            >
              加载更多 · 重试
            </button>
          </div>
        )}

        {noMore && (
          <p className="text-muted-foreground py-10 text-center text-sm">
            已经到底了
          </p>
        )}
      </AsyncBody>
    </PageShell>
  )
}
