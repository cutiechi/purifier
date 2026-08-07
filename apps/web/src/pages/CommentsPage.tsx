import { useMemo } from "react"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
import { formatCount } from "@/lib/format"
import { groupBooks } from "@/lib/book-groups"
import { api, readPath } from "@/lib/routes"

interface CommentRankPost {
  rank: number
  title: string
  tid: string
  comments: number
}

export default function CommentsPage() {
  const site = useSite()
  const { items, loading, error, reload } = useAsyncList(
    api.comments,
    (json) => (json.posts as CommentRankPost[]) ?? []
  )

  const { isExpanded, toggle } = useExpandedBooks("comments")
  const grouped = useMemo(() => {
    if (site !== "1") {
      return items.map((item) => ({ type: "single" as const, item }))
    }
    return groupBooks(items, (p) => p.title)
  }, [items, site])

  return (
    <PageShell>
      <PageHeader
        title="评论榜"
        description={
          items.length
            ? pageCountLabel(items.length, "帖", "按评论数排序")
            : "按评论数排序"
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
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
                rank={g.item.rank}
                statValue={formatCount(g.item.comments)}
                statUnit="评"
                showGenre
              />
            ) : (
              <CollapsibleBookGroup
                key={`group:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
              >
                {g.items.map((post) => (
                  <ListPostCard
                    key={post.tid}
                    href={readPath(post.tid)}
                    rawTitle={post.title}
                    rank={post.rank}
                    statValue={formatCount(post.comments)}
                    statUnit="评"
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            )
          )}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
