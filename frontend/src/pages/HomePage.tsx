import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { SourceBadge } from "@/components/source-badge"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { api, bookPath, readPath } from "@/lib/routes"
import { groupBooks, type GroupedItem } from "@/lib/book-groups"
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

type StreamKey = "forum" | "library"

const SITE_OF: Record<StreamKey, string> = { forum: "1", library: "2" }

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : "未知错误"
}

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

/** 首页：论坛 + 书库更新流同页合并（带来源徽标），无限滚动两站同步推进 */
function StreamError({
  label,
  message,
  onRetry,
}: {
  label: string
  message: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm"
    >
      <span className="text-destructive">
        {label}加载失败：{message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
      >
        重试
      </button>
    </div>
  )
}

export default function HomePage() {
  const [forum, setForum] = useState<StreamState>(EMPTY_STREAM)
  const [library, setLibrary] = useState<StreamState>(EMPTY_STREAM)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // 两站错误分开保存：一站超时不应把另一站的列表一起打成错误页
  const [forumError, setForumError] = useState("")
  const [libraryError, setLibraryError] = useState("")
  const [loadMoreError, setLoadMoreError] = useState("")

  const { isExpanded, toggle } = useExpandedBooks("home")
  const forumGrouped = useMemo(
    () =>
      groupBooks(
        forum.links,
        (l) => l.title,
        (l) => l.tid
      ),
    [forum.links]
  )
  const libraryGrouped = useMemo(
    () =>
      groupBooks(
        library.links,
        (l) => l.title,
        (l) => l.tid
      ),
    [library.links]
  )

  const nextRef = useRef<{ forum: string | null; library: string | null }>({
    forum: null,
    library: null,
  })
  nextRef.current = { forum: forum.nextMtid, library: library.nextMtid }
  const hasMore = forum.nextMtid !== null || library.nextMtid !== null
  const loadingMoreRef = useRef(false)
  const seqRef = useRef(0)

  const loadStream = useCallback(async (key: StreamKey, mtid: string) => {
    const stream = await parseHomeResponse(
      await fetch(`${api.posts}?mtid=${mtid}&site=${SITE_OF[key]}`)
    )
    const setter = key === "forum" ? setForum : setLibrary
    const clearError = key === "forum" ? setForumError : setLibraryError
    clearError("")
    setter((prev) => {
      const seen = new Set(prev.links.map((l) => l.tid))
      return {
        links: [...prev.links, ...stream.links.filter((l) => !seen.has(l.tid))],
        nextMtid: stream.nextMtid,
      }
    })
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError("")

    const seq = seqRef.current
    try {
      const next = nextRef.current
      const tasks: Promise<void>[] = []
      if (next.forum !== null) tasks.push(loadStream("forum", next.forum))
      if (next.library !== null) tasks.push(loadStream("library", next.library))
      // 分站隔离：一站翻页失败不该让另一站的成功结果被丢掉，
      // 也不该把整块列表打成错误态。
      const settled = await Promise.allSettled(tasks)
      if (seq !== seqRef.current) return
      const rejected = settled.find((r) => r.status === "rejected")
      if (rejected && settled.every((r) => r.status === "rejected")) {
        throw rejected.reason
      }
    } catch (e) {
      if (seq === seqRef.current) {
        setLoadMoreError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [hasMore, loadStream])

  const fetchFirstPage = useCallback(async () => {
    const seq = ++seqRef.current // 使在途 loadMore 响应失效
    setInitialLoading(true)
    setForumError("")
    setLibraryError("")
    setLoadMoreError("")
    setForum(EMPTY_STREAM)
    setLibrary(EMPTY_STREAM)
    try {
      // promise 直接交给 allSettled：先 await 的话，fetch 自身 reject
      // （DNS/断网/连接被拒）会跳过下面的 setInitialLoading(false)，
      // 页面永久停在 Spinner。同时两站并发，不再串行。
      const [forumRes, libraryRes] = await Promise.allSettled([
        fetch(`${api.posts}?site=1`).then(parseHomeResponse),
        fetch(`${api.posts}?site=2`).then(parseHomeResponse),
      ])
      if (seq !== seqRef.current) return
      if (forumRes.status === "fulfilled") setForum(forumRes.value)
      else setForumError(msgOf(forumRes.reason))
      if (libraryRes.status === "fulfilled") setLibrary(libraryRes.value)
      else setLibraryError(msgOf(libraryRes.reason))
    } finally {
      if (seq === seqRef.current) setInitialLoading(false)
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
  }, [
    loadMore,
    initialLoading,
    loadMoreError,
    forum.links.length,
    library.links.length,
  ])

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const total = forum.links.length + library.links.length
  // 只有两站都失败才把整页打成错误；单站失败用行内提示，另一站照常展示
  const bothFailed = forumError !== "" && libraryError !== ""
  const error = bothFailed ? forumError : ""
  const noMore = !initialLoading && !error && !hasMore && total > 0

  const retryStream = useCallback(
    async (key: StreamKey) => {
      const setter = key === "forum" ? setForum : setLibrary
      const setErr = key === "forum" ? setForumError : setLibraryError
      setErr("")
      try {
        setter(await parseHomeResponse(await fetch(`${api.posts}?site=${SITE_OF[key]}`)))
      } catch (e) {
        setErr(msgOf(e))
      }
    },
    []
  )

  function renderGrouped(g: GroupedItem<ChapterLink>, site: string) {
    const isBook = site === "2"
    if (g.type === "single") {
      const item = g.item
      return (
        <SimilarPostCard
          key={`${site}:${item.tid}`}
          href={
            isBook ? bookPath(item.tid, { site }) : readPath(item.tid, site)
          }
          rawTitle={item.title}
          tid={item.tid}
          site={site}
          showGenre
          badge={<SourceBadge site={site} />}
        />
      )
    }
    return (
      <CollapsibleBookGroup
        key={`group:${site}:${g.key}`}
        title={g.title}
        summary={g.author ?? undefined}
        count={g.items.length}
        bookKey={g.key}
        isExpanded={isExpanded(g.key)}
        onToggle={() => toggle(g.key)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            {g.genre ? <GenrePill genre={g.genre} /> : null}
            <SourceBadge site={site} />
          </span>
        }
        similar={
          !isBook
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
            href={
              isBook ? bookPath(link.tid, { site }) : readPath(link.tid, site)
            }
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
        title="首页"
        description={
          !initialLoading && total > 0
            ? `已载入 ${total} 条 · 论坛与书库更新`
            : "最新更新 · 论坛与书库"
        }
      />

      <AsyncBody
        loading={initialLoading}
        error={error}
        empty={total === 0}
        onRetry={fetchFirstPage}
        emptyText="暂无内容"
      >
        {forumError && !bothFailed && (
          <StreamError
            label="论坛更新"
            message={forumError}
            onRetry={() => void retryStream("forum")}
          />
        )}
        {libraryError && !bothFailed && (
          <StreamError
            label="书库更新"
            message={libraryError}
            onRetry={() => void retryStream("library")}
          />
        )}

        <PostList>
          {forumGrouped.map((g) => renderGrouped(g, "1"))}
          {libraryGrouped.map((g) => renderGrouped(g, "2"))}
        </PostList>

        {!loadMoreError && hasMore && (
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
              className="inline-flex min-h-11 items-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
