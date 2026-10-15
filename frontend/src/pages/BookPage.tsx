import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArticleView } from "@/components/article-view"
import { BookmarkList } from "@/components/bookmark-list"
import { CharacterMarkPopover } from "@/components/character-mark-popover"
import { CharacterPanel } from "@/components/character-panel"
import { ReadingSelectionToolbar } from "@/components/reading-selection-toolbar"
import { ItemActions, useItemState } from "@/components/item-actions"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { PostCard, PostList } from "@/components/post-card"
import { useReadingSettings } from "@/components/reading-settings"
import { BookCover } from "@/components/book-cover"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  useCharacters,
  useCharacterHighlightEnabled,
} from "@/hooks/use-characters"
import { useBookmarks, type Bookmark } from "@/hooks/use-bookmarks"
import { useReadingProgress } from "@/hooks/use-reading-progress"
import { useReadingSession } from "@/hooks/use-reading-session"
import { useSite } from "@/hooks/use-site"
import { scrollToProgress, scrollToQuote } from "@/lib/bookmark-locate"
import { api, bookPath } from "@/lib/routes"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

interface BookData {
  title: string
  content: string
  meta: { author: string | null }
  url: string
  intro?: string
  chapters?: ChapterLink[]
  singleShot?: boolean
  related?: ChapterLink[]
  bookTitle?: string
  prevChapter?: number
  nextChapter?: number
}

export default function BookPage() {
  const { cid = "" } = useParams<{ cid: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const chapter = params.get("chapter") ?? undefined
  const site = useSite()
  const { settings } = useReadingSettings()
  const { state, reload } = useItemState("book", cid)
  const {
    clusters,
    marks,
    error: charactersError,
    reload: reloadCharacters,
    add,
    remove,
    merge,
    split,
    recolor,
  } = useCharacters("book", cid)
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
    // 跳到 ?bm=<id>：复用定位 effect（保留 site/chapter，同章导航不重新抓内容）
    navigate(
      bookPath(cid, {
        site,
        chapter: isChapterBody ? chapter : undefined,
        bm: String(item.id),
      })
    )
  }
  const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<BookData | null>(null)
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState("")
  // 抓取序号：每次发起（含换章/换站/刷新）递增；过期响应（成功或错误）一律丢弃，
  // 避免旧章响应后到覆盖新章、或 setLoadedKey 记成旧 key 导致 ready 卡死
  const seqRef = useRef(0)

  const [tocOpen, setTocOpen] = useState(false)
  const [allChapters, setAllChapters] = useState<ChapterLink[]>([])
  const [loadingAllChapters, setLoadingAllChapters] = useState(false)

  // 三个显式分支（review I3）：第一刀按 site 切，绝不只用"有无 chapter"当第一刀，
  // 否则 cool18（site=1、无 chapter）会误进目录 UI。
  const isToc = site === "2" && !chapter // xbookcn 目录页
  const isChapterBody = site === "2" && !!chapter // xbookcn 章节正文
  const isCool18Book = site === "1" // cool18 整本一页（现有 ArticleView 路径）

  // 章节阅读模式下呼出目录抽屉时，若尚无完整目录则请求一次
  useEffect(() => {
    if (tocOpen && allChapters.length === 0 && cid && isChapterBody) {
      setLoadingAllChapters(true)
      fetch(`${api.books}?cid=${encodeURIComponent(cid)}&site=${site}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.chapters) setAllChapters(d.chapters)
          setLoadingAllChapters(false)
        })
        .catch(() => setLoadingAllChapters(false))
    }
  }, [tocOpen, allChapters.length, cid, site, isChapterBody])

  // 键盘左右方向键快速翻章
  useEffect(() => {
    if (!isChapterBody) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      if (e.key === "ArrowLeft" && book?.prevChapter !== undefined) {
        navigate(bookPath(cid, { site, chapter: String(book.prevChapter) }))
      } else if (e.key === "ArrowRight" && book?.nextChapter !== undefined) {
        navigate(bookPath(cid, { site, chapter: String(book.nextChapter) }))
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isChapterBody, book?.prevChapter, book?.nextChapter, cid, site, navigate])

  // 移动端手势滑动翻章
  useEffect(() => {
    if (!isChapterBody) return
    let touchStartX = 0
    let touchStartY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].clientX
      touchStartY = e.changedTouches[0].clientY
    }
    const onTouchEnd = (e: TouchEvent) => {
      const diffX = e.changedTouches[0].clientX - touchStartX
      const diffY = e.changedTouches[0].clientY - touchStartY
      if (Math.abs(diffX) > 90 && Math.abs(diffY) < 50) {
        if (diffX < 0 && book?.nextChapter !== undefined) {
          navigate(bookPath(cid, { site, chapter: String(book.nextChapter) }))
        } else if (diffX > 0 && book?.prevChapter !== undefined) {
          navigate(bookPath(cid, { site, chapter: String(book.prevChapter) }))
        }
      }
    }
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchend", onTouchEnd)
    }
  }, [isChapterBody, book?.prevChapter, book?.nextChapter, cid, site, navigate])

  // ready 按"书+章"（loadedKey）判定：换章时 content 尚未挂载前 ready=false，
  // 避免恢复决策/进度采样串到上一章；目录页恒不跟踪进度（review I4 配套）。
  const currentKey = `${site}:${cid}:${chapter ?? ""}`
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
    kind: "book",
    id: cid,
    // chapter 仅 xbookcn 章传入；cool18 整本一页与目录页不传（后端存 NULL）
    chapter: isChapterBody ? Number(chapter) : undefined,
    enabled: (isChapterBody || isCool18Book) && loadedKey === currentKey,
  })
  const bmParam = params.get("bm")
  const target = bmParam
    ? bookmarks.find((b) => String(b.id) === bmParam)
    : undefined
  // 有 bm 时等书签就绪再决策恢复/定位；无效 bm（找不到）不 skip restore
  const bookmarksReady = !bmParam || !bookmarksLoading
  const skipRestore = Boolean(bmParam && target)
  const { progress, syncFromViewport } = useReadingProgress("book", cid, {
    ready:
      (isChapterBody || isCool18Book) &&
      loadedKey === currentKey &&
      (!bmParam || !bookmarksLoading),
    stateReady: state !== null && state.id === cid, // 当前书籍的 state GET 已完成
    restore: skipRestore
      ? null
      : state?.id === cid
        ? state.read_progress
        : undefined,
    chapter: isChapterBody ? chapter : undefined,
    restoreChapter: state?.id === cid ? state.lastChapter : null,
    site,
  })
  useReadingSession({
    site,
    kind: "book",
    id: cid,
    title: isToc ? "" : (book?.bookTitle ?? book?.title ?? ""),
    enabled: (isChapterBody || isCool18Book) && loadedKey === currentKey,
  })

  const fetchBook = useCallback(
    async (opts?: { refresh?: boolean; signal?: AbortSignal }) => {
      if (!cid) return
      const seq = ++seqRef.current
      const refresh = opts?.refresh
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.books}?cid=${encodeURIComponent(cid)}&site=${site}${chapter ? `&chapter=${chapter}` : ""}${refresh ? "&refresh=1" : ""}`,
          { signal: opts?.signal }
        )
        const json = await res.json()
        if (seq !== seqRef.current) return
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        setBook(json)
        setLoadedKey(`${site}:${cid}:${chapter ?? ""}`)
        setRefreshNotice(json.stale ? "刷新失败，当前展示的是缓存内容" : "")
      } catch (e) {
        if (seq === seqRef.current) {
          // 组件卸载触发的取消不算错误
          if (e instanceof Error && e.name === "AbortError") return
          setError(e instanceof Error ? e.message : "未知错误")
        }
      } finally {
        if (seq === seqRef.current) {
          if (refresh) setRefreshing(false)
          else setLoading(false)
        }
      }
    },
    [cid, site, chapter]
  )

  useEffect(() => {
    // 卸载/换章时取消飞行中请求（seq 守卫防错序，取消省带宽）
    const controller = new AbortController()
    fetchBook({ signal: controller.signal })
    return () => controller.abort()
  }, [fetchBook])

  // 定位 effect（独立于进度 hook）：内容与书签都就绪且有有效 target 时决策一次
  // （ref 按 bm+id+site+chapter 防重滚；换 bm/换章重新决策）。双 rAF 等字体与布局稳定后再滚。
  const locateKey = bmParam
    ? `${bmParam}:${site}:${cid}:${chapter ?? ""}`
    : null
  const locatedRef = useRef<string | null>(null)
  const syncRef = useRef(syncFromViewport)
  syncRef.current = syncFromViewport
  useEffect(() => {
    if (
      !locateKey ||
      !(isChapterBody || isCool18Book) ||
      loadedKey !== currentKey ||
      !bookmarksReady ||
      !target
    ) {
      return
    }
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
  }, [
    locateKey,
    isChapterBody,
    isCool18Book,
    loadedKey,
    currentKey,
    bookmarksReady,
    target,
  ])

  const actions = (
    <ItemActions
      kind="book"
      id={cid}
      state={state}
      reload={reload}
      onRefresh={() => void fetchBook({ refresh: true })}
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
                setMutationError(e instanceof Error ? e.message : "拆分失败")
              )
          }}
          onMerge={(clusterIds, hue) => {
            void merge(clusterIds, hue)
              .then(() => setMutationError(""))
              .catch((e) =>
                setMutationError(e instanceof Error ? e.message : "合并失败")
              )
          }}
          onRecolor={(clusterId, hue) => {
            void recolor(clusterId, hue)
              .then(() => setMutationError(""))
              .catch((e) =>
                setMutationError(e instanceof Error ? e.message : "改色失败")
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
  )

  return (
    <PageShell showBack maxWidth={settings.maxWidth}>
      <AsyncBody
        loading={loading}
        error={error}
        empty={!book}
        onRetry={fetchBook}
        emptyText="内容不存在"
      >
        {book && (
          <>
            {refreshNotice && (
              <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                {refreshNotice}
              </div>
            )}
            {isCool18Book && (
              <>
                <ArticleView
                  title={book.title}
                  meta={{ author: book.meta?.author }}
                  contentHtml={book.content}
                  sourceUrl={book.url}
                  progress={progress}
                  characters={marks}
                  highlightEnabled={enabled}
                  onCharacterClick={(name, rect) =>
                    setMarkPopup({ name, rect })
                  }
                  actions={actions}
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
            {isToc && (
              <div className="flex flex-col gap-8">
                <header className="flex flex-col sm:flex-row gap-6 items-start">
                  <div className="shrink-0 mx-auto sm:mx-0 shadow-lg rounded-xl overflow-hidden">
                    <BookCover
                      title={book.title}
                      author={book.meta?.author}
                      size="lg"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="border-primary/20 text-primary">
                        网络小说
                      </Badge>
                      {book.chapters?.length ? (
                        <Badge
                          variant="secondary"
                          className="font-normal text-muted-foreground"
                        >
                          共 {book.chapters.length} 章
                        </Badge>
                      ) : null}
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                      {book.title}
                    </h1>
                    {book.meta?.author && (
                      <p className="text-sm font-medium text-muted-foreground">
                        作者：<span className="text-foreground">{book.meta.author}</span>
                      </p>
                    )}
                    {book.intro && (
                      <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground/90 pt-1 line-clamp-4">
                        {book.intro}
                      </p>
                    )}
                    <div className="pt-2 flex items-center gap-3 flex-wrap">
                      <Link
                        to={bookPath(cid, { site, chapter: "1" })}
                        className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                      >
                        开始阅读
                      </Link>
                      {actions}
                    </div>
                  </div>
                </header>

                {(book.chapters ?? []).length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold tracking-tight text-foreground">
                        章节列表
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        共 {book.chapters?.length} 章
                      </span>
                    </div>
                    <PostList>
                      {(book.chapters ?? []).map((ch) => (
                        <PostCard
                          key={ch.index}
                          href={bookPath(cid, {
                            site,
                            chapter: String(ch.index),
                          })}
                          title={ch.title}
                          leading={
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                              {ch.index}
                            </span>
                          }
                        />
                      ))}
                    </PostList>
                  </section>
                )}
                {book.related && book.related.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      相关推荐
                    </h3>
                    <PostList>
                      {book.related.map((r) => (
                        <PostCard
                          key={r.tid}
                          href={bookPath(r.tid, { site })}
                          title={r.title}
                          leading={
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                              {r.index}
                            </span>
                          }
                        />
                      ))}
                    </PostList>
                  </section>
                )}
              </div>
            )}
            {isChapterBody && (
              <>
                <ArticleView
                  title={book.title}
                  meta={book.meta}
                  contentHtml={book.content}
                  sourceUrl={book.url}
                  progress={progress}
                  characters={marks}
                  highlightEnabled={enabled}
                  onCharacterClick={(name, rect) =>
                    setMarkPopup({ name, rect })
                  }
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTocOpen(true)}
                        className="h-8 gap-1 rounded-lg text-xs"
                      >
                        <span>📑</span> 目录
                      </Button>
                      {actions}
                    </div>
                  }
                  footer={
                    <nav className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
                      {book.prevChapter !== undefined ? (
                        <Link
                          to={bookPath(cid, {
                            site,
                            chapter: String(book.prevChapter),
                          })}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          ← 上一章
                        </Link>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setTocOpen(true)}
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        >
                          📑 目录
                        </Button>
                        <Link
                          to={bookPath(cid, { site })}
                          className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          书页
                        </Link>
                      </div>
                      {book.nextChapter !== undefined ? (
                        <Link
                          to={bookPath(cid, {
                            site,
                            chapter: String(book.nextChapter),
                          })}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          下一章 →
                        </Link>
                      ) : (
                        <span />
                      )}
                    </nav>
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
          </>
        )}
      </AsyncBody>
      <ReadingSelectionToolbar
        clusters={clusters}
        onAdd={(n, cid) => void handleAdd(n, cid)}
        onRemove={(n) => void handleRemove(n)}
        onBookmark={
          isToc ? () => {} : (quote, note) => void handleBookmark(quote, note)
        }
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

      {/* 小说章节目录抽屉 (TOC Drawer) */}
      <Sheet open={tocOpen} onOpenChange={setTocOpen}>
        <SheetContent side="right" className="w-[320px] sm:w-[420px] p-0 flex flex-col">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="text-base font-semibold truncate">
              {book?.bookTitle || book?.title || "章节目录"}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 p-3">
            {loadingAllChapters ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                正在加载目录...
              </div>
            ) : allChapters.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无目录章节
              </div>
            ) : (
              <div className="space-y-0.5">
                {allChapters.map((ch) => {
                  const isCurrent = String(ch.index) === String(chapter)
                  return (
                    <button
                      key={ch.index}
                      type="button"
                      onClick={() => {
                        setTocOpen(false)
                        navigate(bookPath(cid, { site, chapter: String(ch.index) }))
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-2.5 ${
                        isCurrent
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground/85 hover:bg-muted"
                      }`}
                    >
                      <span className="text-[11px] tabular-nums text-muted-foreground min-w-[24px]">
                        {ch.index}
                      </span>
                      <span className="truncate flex-1">{ch.title}</span>
                      {isCurrent && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-4 px-1.5 py-0 bg-primary/20 text-primary shrink-0"
                        >
                          当前
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </PageShell>
  )
}
