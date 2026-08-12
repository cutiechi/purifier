import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { ArticleView, RelatedLinks } from "@/components/article-view"
import { CharacterMarkPopover } from "@/components/character-mark-popover"
import { CharacterPanel } from "@/components/character-panel"
import { CharacterSelectionToolbar } from "@/components/character-selection-toolbar"
import { ItemActions, useItemState } from "@/components/item-actions"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { useReadingSettings } from "@/components/reading-settings"
import {
  useCharacters,
  useCharacterHighlightEnabled,
} from "@/hooks/use-characters"
import { useReadingProgress } from "@/hooks/use-reading-progress"
import { useReadingSession } from "@/hooks/use-reading-session"
import { useSite } from "@/hooks/use-site"
import { type PostMetaFields } from "@/components/post-meta"
import { ReplyList, type ReplyNode } from "@/components/reply-list"
import { api } from "@/lib/routes"

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
  const site = useSite()
  const { settings } = useReadingSettings()
  const { state, reload } = useItemState("post", tid)
  const {
    characters,
    error: charactersError,
    reload: reloadCharacters,
    add,
    remove,
  } = useCharacters("post", tid)
  const { enabled, setEnabled } = useCharacterHighlightEnabled()
  const [markPopup, setMarkPopup] = useState<{
    name: string
    rect: DOMRect
  } | null>(null)
  const [mutationError, setMutationError] = useState("")
  // PUT/DELETE 失败时展示错误；成功后清除（add 成功才更新名单，remove 失败已回滚）
  const handleAdd = async (name: string) => {
    try {
      await add(name)
      setMutationError("")
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "标记失败")
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
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<ContentData | null>(null)
  const [loadedTid, setLoadedTid] = useState("")
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState("")
  const { progress } = useReadingProgress("post", tid, {
    ready: loadedTid === tid, // 当前 tid 内容已挂载（按 id 区分，避免串用上一篇）
    stateReady: state !== null && state.id === tid, // 当前文章的 state GET 已完成
    restore: state?.id === tid ? state.read_progress : undefined,
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

  return (
    <PageShell showBack maxWidth={settings.maxWidth}>
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
              characters={characters}
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
                      characters={characters}
                      enabled={enabled}
                      setEnabled={setEnabled}
                      onRemove={(n) => void handleRemove(n)}
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
          </>
        )}
      </AsyncBody>
      <CharacterSelectionToolbar
        characters={characters}
        onAdd={(n) => void handleAdd(n)}
        onRemove={(n) => void handleRemove(n)}
      />
      {markPopup && (
        <CharacterMarkPopover
          name={markPopup.name}
          rect={markPopup.rect}
          colorIndex={
            characters.find((c) => c.name === markPopup.name)?.colorIndex
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
