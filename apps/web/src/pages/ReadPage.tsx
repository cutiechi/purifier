import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ArticleView, RelatedLinks } from "@/components/article-view"
import { ItemActions } from "@/components/item-actions"
import { PageShell, AsyncBody } from "@/components/page-shell"
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
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<ContentData | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState("")

  const fetchContent = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (!tid) return
      const refresh = opts?.refresh
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.posts}?tid=${encodeURIComponent(tid)}${refresh ? "&refresh=1" : ""}`
        )
        const json = await res.json()
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        setContent(json)
        setRefreshNotice(json.stale ? "刷新失败，当前展示的是缓存内容" : "")
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (refresh) setRefreshing(false)
        else setLoading(false)
      }
    },
    [tid]
  )

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  return (
    <PageShell showBack>
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
              actions={
                <ItemActions
                  kind="post"
                  id={tid}
                  onRefresh={() => void fetchContent({ refresh: true })}
                  refreshing={refreshing}
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
    </PageShell>
  )
}
