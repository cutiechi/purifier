"use client"

import { use, useCallback, useEffect, useState } from "react"
import {
  ArticleView,
  RelatedLinks,
} from "@/components/article-view"
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

export default function ReadPage({
  params,
}: {
  params: Promise<{ tid: string }>
}) {
  const { tid } = use(params)
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<ContentData | null>(null)
  const [error, setError] = useState("")

  const fetchContent = useCallback(async () => {
    if (!tid) return
    setLoading(true)
    setError("")
    setContent(null)
    try {
      const res = await fetch(`${api.posts}?tid=${encodeURIComponent(tid)}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setContent(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [tid])

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
          <ArticleView
            title={content.title}
            meta={content.meta ?? {}}
            contentHtml={content.content}
            sourceUrl={content.url}
            currentTid={tid}
            footer={
              <>
                <RelatedLinks links={content.links ?? []} />
                <ReplyList replies={content.replies ?? []} />
              </>
            }
          />
        )}
      </AsyncBody>
    </PageShell>
  )
}
