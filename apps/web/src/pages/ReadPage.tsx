import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArticleView, RelatedLinks } from "@/components/article-view"
import { BookmarkList } from "@/components/bookmark-list"
import { ChapterNavBar } from "@/components/chapter-nav-bar"
import { CharacterMarkPopover } from "@/components/character-mark-popover"
import { CharacterPanel } from "@/components/character-panel"
import { ReadingSelectionToolbar } from "@/components/reading-selection-toolbar"
import { ItemActions, useItemState } from "@/components/item-actions"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { useReadingSettings } from "@/components/reading-settings"
import {
  useCharacters,
  useCharacterHighlightEnabled,
} from "@/hooks/use-characters"
import { useBookmarks, type Bookmark } from "@/hooks/use-bookmarks"
import { useReadingProgress } from "@/hooks/use-reading-progress"
import { useReadingSession } from "@/hooks/use-reading-session"
import { useSite } from "@/hooks/use-site"
import { type PostMetaFields } from "@/components/post-meta"
import { ReplyList, type ReplyNode } from "@/components/reply-list"
import { scrollToProgress, scrollToQuote } from "@/lib/bookmark-locate"
import {
  extractBodyChapterLinks,
  extractChapterNeighbors,
} from "@/lib/chapter-nav"
import { api, readPath } from "@/lib/routes"

interface ContentData {
  title: string
  content: string
  links: { tid: string; title: string; index: number }[]
  meta: PostMetaFields
  replies: ReplyNode[]
  url: string
}

export default function ReadPage() {
  const { tid = "" } = useParams<{ tid: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const site = useSite()
  const { settings } = useReadingSettings()
  const { state, reload } = useItemState("post", tid)
  const {
    clusters,
    marks,
    error: charactersError,
    loading: charactersLoading,
    reload: reloadCharacters,
    add,
    remove,
    merge,
    split,
    recolor,
  } = useCharacters("post", tid)
  const { enabled, setEnabled } = useCharacterHighlightEnabled()
  const [markPopup, setMarkPopup] = useState<{
    name: string
    rect: DOMRect
  } | null>(null)
  const [mutationError, setMutationError] = useState("")
  // PUT/DELETE 失败时展示错误；成功后清除（add 成功才更新名单，remove 失败已回滚）。
  // 跨组同名 PUT 409 → 引导去面板合并。
  const handleAdd = async (name: string, clusterId?: number) => {
    try {
      await add(name, clusterId)
      setMutationError("")
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      setMutationError(
        status === 409
          ? "该称呼已属于其他人，请到面板合并"
          : e instanceof Error
            ? e.message
            : "标记失败"
      )
    }
  }
  const handleRemove = async (name: string) => {
    try {
      await remove(name)
      setMutationError("")
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "删除失败")
    }
  }
  // 浮条保存书签：409（该篇/章已满）等错误写入 mutationError 展示
  const handleBookmark = async (quote: string, note: string) => {
    const p = document.documentElement.scrollHeight - window.innerHeight
    const scrollProgress = p <= 0 ? 0 : window.scrollY / p
    try {
      await addBookmark({ quote, note, scrollProgress })
      setMutationError("")
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      setMutationError(
        status === 409
          ? "该书签已满（50），请先删除旧的"
          : e instanceof Error
            ? e.message
            : "保存书签失败"
      )
    }
  }
  const handleJumpBookmark = (item: Bookmark) => {
    // 跳到 ?bm=<id>：复用定位 effect（同篇导航不重新抓内容）
    navigate(readPath(tid, site, String(item.id)))
  }
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<ContentData | null>(null)
  const [loadedTid, setLoadedTid] = useState("")
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState("")
  const [staleId, setStaleId] = useState<number | undefined>(undefined)
  const {
    items: bookmarks,
    loading: bookmarksLoading,
    error: bookmarksError,
    add: addBookmark,
    updateNote: updateBookmarkNote,
    remove: removeBookmark,
  } = useBookmarks({
    site,
    kind: "post",
    id: tid,
    enabled: loadedTid === tid, // 内容已挂载才请求（换帖期间不发）
  })
  const bmParam = searchParams.get("bm")
  const target = bmParam
    ? bookmarks.find((b) => String(b.id) === bmParam)
    : undefined
  // 有 bm 时等书签就绪再决策恢复/定位；无效 bm（找不到）不 skip restore
  const bookmarksReady = !bmParam || !bookmarksLoading
  const skipRestore = Boolean(bmParam && target)
  const { progress, syncFromViewport } = useReadingProgress("post", tid, {
    // 当前 tid 内容已挂载（按 id 区分，避免串用上一篇）；有 bm 时还须书签就绪
    ready: loadedTid === tid && (!bmParam || !bookmarksLoading),
    stateReady: state !== null && state.id === tid, // 当前文章的 state GET 已完成
    restore: skipRestore
      ? null
      : state?.id === tid
        ? state.read_progress
        : undefined,
  })
  useReadingSession({
    site,
    kind: "post",
    id: tid,
    title: content?.title ?? "",
    enabled: loadedTid === tid,
  })

  // 抓取序号：换帖时递增，过期响应（成功/错误）一律丢弃，
  // 避免 /read/A → /read/B 快速切换时旧帖覆盖新帖、loadedTid 挂错文章
  const seqRef = useRef(0)

  const fetchContent = useCallback(
    async (opts?: { refresh?: boolean; signal?: AbortSignal }) => {
      if (!tid) return
      const seq = ++seqRef.current
      const refresh = opts?.refresh
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.posts}?tid=${encodeURIComponent(tid)}${refresh ? "&refresh=1" : ""}`,
          { signal: opts?.signal }
        )
        const json = await res.json()
        if (seq !== seqRef.current) return
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        setContent(json)
        setLoadedTid(tid)
        setRefreshNotice(json.stale ? "刷新失败，当前展示的是缓存内容" : "")
      } catch (e) {
        if (seq !== seqRef.current) return
        // 组件卸载触发的取消不算错误
        if (e instanceof Error && e.name === "AbortError") return
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (seq === seqRef.current) {
          if (refresh) setRefreshing(false)
          else setLoading(false)
        }
      }
    },
    [tid]
  )

  useEffect(() => {
    // 卸载/换帖时取消飞行中请求（seq 守卫防错序，取消省带宽）
    const controller = new AbortController()
    fetchContent({ signal: controller.signal })
    return () => controller.abort()
  }, [fetchContent])

  // 定位 effect（独立于进度 hook）：内容与书签都就绪且有有效 target 时决策一次
  // （ref 按 bm+id+site 防重滚；换 bm/换帖重新决策）。双 rAF 等字体与布局稳定后再滚。
  const locateKey = bmParam ? `${bmParam}:${site}:${tid}` : null
  const locatedRef = useRef<string | null>(null)
  const syncRef = useRef(syncFromViewport)
  syncRef.current = syncFromViewport
  useEffect(() => {
    if (!locateKey || loadedTid !== tid || !bookmarksReady || !target) return
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (locatedRef.current === locateKey) return // 本次 bm 已定位过
        locatedRef.current = locateKey
        setStaleId(undefined) // 换 bm 新决策：清掉上一条 stale 标记（列表增删重跑 effect 不清）
        const root = document.querySelector(".reading-body")
        const hit = root instanceof Element && scrollToQuote(root, target.quote)
        if (!hit) {
          scrollToProgress(target.scrollProgress)
          setStaleId(target.id)
        }
        // scrollIntoView 后布局可能尚未稳定；再等一帧采样进度条，避免先显示旧 scrollY
        requestAnimationFrame(() => syncRef.current())
      })
    )
    return () => cancelAnimationFrame(raf2)
  }, [locateKey, loadedTid, tid, bookmarksReady, target])

  const neighbors = useMemo(() => {
    if (!content) return { prev: undefined, next: undefined }
    return extractChapterNeighbors(
      content.links ?? [],
      extractBodyChapterLinks(content.content)
    )
  }, [content])

  const showChapterNav = Boolean(neighbors.prev || neighbors.next)

  return (
    <PageShell showBack maxWidth={settings.maxWidth}>
      <div
        className={
          showChapterNav
            ? "pb-[calc(3rem+env(safe-area-inset-bottom,0px))]"
            : undefined
        }
      >
        <AsyncBody
          loading={loading}
          error={error}
          empty={!content}
          onRetry={fetchContent}
          emptyText="内容不存在"
        >
          {content && (
            <>
              {refreshNotice && (
                <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                  {refreshNotice}
                </div>
              )}
              <ArticleView
                title={content.title}
                meta={content.meta ?? {}}
                contentHtml={content.content}
                sourceUrl={content.url}
                currentTid={tid}
                progress={progress}
                progressBottomOffset={showChapterNav ? 48 : 0}
                characters={marks}
                highlightEnabled={enabled}
                onCharacterClick={(name, rect) => setMarkPopup({ name, rect })}
                actions={
                  <ItemActions
                    kind="post"
                    id={tid}
                    state={state}
                    reload={reload}
                    onRefresh={() => void fetchContent({ refresh: true })}
                    refreshing={refreshing}
                    characterSlot={
                      <CharacterPanel
                        clusters={clusters}
                        enabled={enabled}
                        setEnabled={setEnabled}
                        onRemove={(n) => void handleRemove(n)}
                        onSplit={(clusterId, n) => {
                          void split(clusterId, n)
                            .then(() => setMutationError(""))
                            .catch((e) =>
                              setMutationError(
                                e instanceof Error ? e.message : "拆分失败"
                              )
                            )
                        }}
                        onMerge={(clusterIds, hue) => {
                          void merge(clusterIds, hue)
                            .then(() => setMutationError(""))
                            .catch((e) =>
                              setMutationError(
                                e instanceof Error ? e.message : "合并失败"
                              )
                            )
                        }}
                        onRecolor={(clusterId, hue) => {
                          void recolor(clusterId, hue)
                            .then(() => setMutationError(""))
                            .catch((e) =>
                              setMutationError(
                                e instanceof Error ? e.message : "改色失败"
                              )
                            )
                        }}
                        error={charactersError}
                        mutationError={mutationError}
                        onRetry={() => {
                          setMutationError("")
                          void reloadCharacters()
                        }}
                      />
                    }
                  />
                }
                footer={
                  <>
                    <RelatedLinks links={content.links ?? []} />
                    <ReplyList replies={content.replies ?? []} />
                  </>
                }
              />
              {bookmarksError && (
                <p className="mt-3 text-xs text-destructive">
                  {bookmarksError}
                </p>
              )}
              <BookmarkList
                items={bookmarks}
                staleId={staleId}
                onJump={handleJumpBookmark}
                onUpdateNote={updateBookmarkNote}
                onRemove={removeBookmark}
              />
            </>
          )}
        </AsyncBody>
      </div>
      <ChapterNavBar prev={neighbors.prev} next={neighbors.next} site={site} />
      <ReadingSelectionToolbar
        clusters={clusters}
        onAdd={(n, cid) => void handleAdd(n, cid)}
        onRemove={(n) => void handleRemove(n)}
        onBookmark={(quote, note) => void handleBookmark(quote, note)}
      />
      {markPopup && (
        <CharacterMarkPopover
          name={markPopup.name}
          rect={markPopup.rect}
          hue={clusters.find((c) => c.names.includes(markPopup.name))?.hue}
          clusterNames={
            clusters.find((c) => c.names.includes(markPopup.name))?.names
          }
          onRemove={() => {
            void handleRemove(markPopup.name)
            setMarkPopup(null)
          }}
          onClose={() => setMarkPopup(null)}
        />
      )}
    </PageShell>
  )
}
