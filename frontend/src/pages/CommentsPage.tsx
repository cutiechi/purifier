import { type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { PageHeader, SectionLabel } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { SiteTabs } from "@/components/site-tabs"
import { GroupedPostList } from "@/components/grouped-post-list"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import { formatCount } from "@/lib/format"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, forumRoutes, libraryRoutes, readPath } from "@/lib/routes"

interface CommentRankPost {
  rank: number
  title: string
  tid: string
  comments: number
}

export default function CommentsPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useDiscoverTabs(pathname)
  const { items, loading, error, reload } = useAsyncList(
    api.comments,
    (json) => (json.posts as CommentRankPost[]) ?? []
  )

  // 评论榜按 rank 每 20 条一桶，桶头粘顶（同 key 桶头由 GroupedPostList 去重）
  function bucketHeader(first: CommentRankPost): ReactNode {
    if (items.length <= 20 || first.rank == null) return null
    const bucket = Math.floor((first.rank - 1) / 20)
    const start = bucket * 20 + 1
    return (
      <SectionLabel
        key={`bucket:${start}`}
        className="sticky top-14 z-10 -mx-3.5 bg-background/95 px-3.5 py-2 backdrop-blur sm:-mx-5 sm:px-5"
      >
        {`${start}–${start + 19}`}
      </SectionLabel>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="评论"
        description={
          items.length
            ? pageCountLabel(items.length, "帖", "评论榜")
            : "在线榜单与栏目"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": forumRoutes.comments,
              "2": libraryRoutes.trending,
            }}
          />
        }
      />
      <SectionTabs items={sectionTabs} />

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无数据"
      >
        <GroupedPostList
          items={items}
          site="1"
          storageKey="comments"
          renderBucketHeader={bucketHeader}
          renderSingle={(p) => (
            <SimilarPostCard
              key={p.tid}
              href={readPath(p.tid)}
              rawTitle={p.title}
              tid={p.tid}
              site="1"
              rank={p.rank}
              statValue={formatCount(p.comments)}
              statUnit="评"
              showGenre
            />
          )}
          renderChild={(post) => (
            <ListPostCard
              key={post.tid}
              href={readPath(post.tid)}
              rawTitle={post.title}
              rank={post.rank}
              statValue={formatCount(post.comments)}
              statUnit="评"
              showGenre
            />
          )}
        />
      </AsyncBody>
    </PageShell>
  )
}
