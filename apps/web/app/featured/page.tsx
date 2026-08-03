"use client"

import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { api, readPath } from "@/lib/routes"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

export default function FeaturedPage() {
  const { items, loading, error, reload } = useAsyncList(
    api.featured,
    (json) => (json.links as ChapterLink[]) ?? []
  )

  return (
    <PageShell>
      <PageHeader
        title="精华"
        description={
          items.length
            ? pageCountLabel(items.length, "篇", "首页精华热贴")
            : "首页精华热贴"
        }
      />

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无精华"
      >
        <PostList>
          {items.map((link, i) => (
            <ListPostCard
              key={link.tid}
              href={readPath(link.tid)}
              rawTitle={link.title}
              index={link.index || i + 1}
              showGenre
            />
          ))}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
