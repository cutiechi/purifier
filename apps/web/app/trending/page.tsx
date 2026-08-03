"use client"

import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import {
  ListPostCard,
  pageCountLabel,
} from "@/components/list-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { formatCount } from "@/lib/format"
import { api, readPath } from "@/lib/routes"

interface TrendingPost {
  rank: number
  title: string
  tid: string
  reads: number
}

export default function TrendingPage() {
  const { items, loading, error, reload } = useAsyncList(
    api.trending,
    (json) => (json.posts as TrendingPost[]) ?? []
  )

  return (
    <PageShell>
      <PageHeader
        title="人气"
        description={
          items.length
            ? pageCountLabel(items.length, "帖", "按阅读排序")
            : "按阅读排序"
        }
      />

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无数据"
      >
        <PostList>
          {items.map((post) => (
            <ListPostCard
              key={post.tid}
              href={readPath(post.tid)}
              rawTitle={post.title}
              rank={post.rank}
              statValue={formatCount(post.reads)}
              statUnit="读"
              showGenre
            />
          ))}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
