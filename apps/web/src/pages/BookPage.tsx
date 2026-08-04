
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ArticleView } from "@/components/article-view"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { api } from "@/lib/routes"

interface BookData {
  title: string
  content: string
  meta: { author: string | null }
  url: string
}

export default function BookPage() {
  const { cid = "" } = useParams<{ cid: string }>()
  const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<BookData | null>(null)
  const [error, setError] = useState("")

  const fetchBook = useCallback(async () => {
    if (!cid) return
    setLoading(true)
    setError("")
    setBook(null)
    try {
      const res = await fetch(`${api.books}?cid=${encodeURIComponent(cid)}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setBook(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [cid])

  useEffect(() => {
    fetchBook()
  }, [fetchBook])

  return (
    <PageShell showBack>
      <AsyncBody
        loading={loading}
        error={error}
        empty={!book}
        onRetry={fetchBook}
        emptyText="内容不存在"
      >
        {book && (
          <ArticleView
            title={book.title}
            meta={{ author: book.meta?.author }}
            contentHtml={book.content}
            sourceUrl={book.url}
          />
        )}
      </AsyncBody>
    </PageShell>
  )
}
