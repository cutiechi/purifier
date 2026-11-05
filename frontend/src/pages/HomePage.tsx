import { useCallback, useEffect, useRef, useState } from "react"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { GroupedPostList } from "@/components/grouped-post-list"
import { Button } from "@/components/ui/button"
import { SiteTabs } from "@/components/site-tabs"
import { useSite } from "@/hooks/use-site"
import { api, forumRoutes, libraryRoutes } from "@/lib/routes"
import type { ChapterLink } from "@/lib/types"

interface HomeResponse {
  links: ChapterLink[]
  nextMtid: string | null
}

interface StreamState {
  links: ChapterLink[]
  nextMtid: string | null
}

const EMPTY_STREAM: StreamState = { links: [], nextMtid: null }

/** 边界解析：网络 JSON → StreamState；错误体取 error 字段 */
function parseHomeResponse(res: Response): Promise<StreamState> {
  return res.json().then((json: unknown) => {
    if (!res.ok) {
      const msg =
        typeof json === "object" &&
        json !== null &&
        "error" in json &&
        typeof (json as Record<string, unknown>).error === "string"
          ? ((json as Record<string, unknown>).error as string)
          : "请求失败"
      throw new Error(msg)
    }
    const data = json as HomeResponse
    return {
      links: Array.isArray(data.links) ? data.links : [],
      nextMtid: typeof data.nextMtid === "string" ? data.nextMtid : null,
    }
  })
}

/** 论坛首页：更新流 + 系列折叠，无限滚动 */
export default function HomePage() {
  const site = useSite()
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchError, setFetchError] = useState("")
  const [loadMoreError, setLoadMoreError] = useState("")

  const hasMore = stream.nextMtid !== null
  const loadingMoreRef = useRef(false)
  const seqRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const fetchFirstPage = useCallback(async () => {
    const seq = ++seqRef.current // 使在途 loadMore 响应失效
    setInitialLoading(true)
    setLoadMoreError("")
    setFetchError("")
    setStream(EMPTY_STREAM)
    try {
      // promise 直接交给 await：fetch 自身 reject（DNS/断网/连接被拒）
      // 会跳过下面的 setInitialLoading(false)，页面永久停在 Spinner；
      // 这里用 try/finally 保证复位。
      setStream(await parseHomeResponse(await fetch(`${api.posts}?site=1`)))
    } catch (e) {
      if (seq === seqRef.current) {
        setFetchError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setInitialLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || stream.nextMtid === null) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError("")
    const seq = seqRef.current
    try {
      const next = await parseHomeResponse(
        await fetch(`${api.posts}?mtid=${stream.nextMtid}&site=1`)
      )
      if (seq !== seqRef.current) return
      setStream((prev) => {
        const seen = new Set(prev.links.map((l) => l.tid))
        return {
          links: [
            ...prev.links,
            ...next.links.filter((l) => !seen.has(l.tid)),
          ],
          nextMtid: next.nextMtid,
        }
      })
    } catch (e) {
      if (seq === seqRef.current) {
        setLoadMoreError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [stream.nextMtid])

  useEffect(() => {
    fetchFirstPage()
  }, [fetchFirstPage])

  useEffect(() => {
    if (initialLoading || loadMoreError || !hasMore) return
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
  }, [loadMore, initialLoading, loadMoreError, hasMore, stream.links.length])

  const total = stream.links.length
  const noMore = !initialLoading && !hasMore && total > 0

  return (
    <PageShell>
      <PageHeader
        title="首页"
        description={
          !initialLoading && total > 0 ? `已载入 ${total} 条 · 论坛更新` : "最新更新 · 论坛"
        }
        action={
          <SiteTabs
            site={site}
            targets={{ "1": forumRoutes.home, "2": libraryRoutes.home }}
          />
        }
      />

      <AsyncBody
        loading={initialLoading}
        error={fetchError}
        empty={total === 0}
        onRetry={fetchFirstPage}
        emptyText="暂无内容"
      >
        <GroupedPostList items={stream.links} site="1" storageKey="home" />

        {!loadMoreError && hasMore && (
          <div ref={sentinelRef} aria-hidden className="h-4" />
        )}

        {loadingMore && <Spinner className="py-8" />}

        {loadMoreError && (
          <div className="py-6 text-center">
            <p className="mb-3 text-sm text-destructive">{loadMoreError}</p>
            <Button
              variant="outline"
              onClick={() => {
                setLoadMoreError("")
                loadMore()
              }}
            >
              加载更多 · 重试
            </Button>
          </div>
        )}

        {noMore && (
          <div className="flex flex-col items-center py-10">
            <p className="text-center text-sm text-muted-foreground">
              已经到底了
            </p>
            <button
              type="button"
              className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => {
                document.getElementById("main")?.focus()
                window.scrollTo({ top: 0, behavior: "smooth" })
              }}
            >
              回到顶部
            </button>
          </div>
        )}
      </AsyncBody>
    </PageShell>
  )
}
