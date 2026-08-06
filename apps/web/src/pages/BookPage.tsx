import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ArticleView } from "@/components/article-view"
import { ItemActions, useItemState } from "@/components/item-actions"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { useReadingSettings } from "@/components/reading-settings"
import { useReadingProgress } from "@/hooks/use-reading-progress"
import { api } from "@/lib/routes"

interface BookData {
  title: string
  content: string
  meta: { author: string | null }
  url: string
}

export default function BookPage() {
  const { cid = "" } = useParams<{ cid: string }>()
  const { settings } = useReadingSettings()
  const { state, reload } = useItemState("book", cid)
  const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<BookData | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState("")
  useReadingProgress("book", cid, {
    ready: !!book, // 内容已挂载
    stateReady: state !== null, // state GET 已完成（区分 null-progress 与 未加载）
    restore: state?.read_progress,
  })

  const fetchBook = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (!cid) return
      const refresh = opts?.refresh
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.books}?cid=${encodeURIComponent(cid)}${refresh ? "&refresh=1" : ""}`
        )
        const json = await res.json()
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        setBook(json)
        setRefreshNotice(json.stale ? "刷新失败，当前展示的是缓存内容" : "")
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (refresh) setRefreshing(false)
        else setLoading(false)
      }
    },
    [cid]
  )

  useEffect(() => {
    fetchBook()
  }, [fetchBook])

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
            <ArticleView
              title={book.title}
              meta={{ author: book.meta?.author }}
              contentHtml={book.content}
              sourceUrl={book.url}
              actions={
                <ItemActions
                  kind="book"
                  id={cid}
                  state={state}
                  reload={reload}
                  onRefresh={() => void fetchBook({ refresh: true })}
                  refreshing={refreshing}
                />
              }
            />
          </>
        )}
      </AsyncBody>
    </PageShell>
  )
}
