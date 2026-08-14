import { useMemo } from "react"
import { Navigate } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { SectionTabs } from "@/components/section-tabs"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useSite } from "@/hooks/use-site"
import { formatCount } from "@/lib/format"
import { groupBooks } from "@/lib/book-groups"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, readPath, routes } from "@/lib/routes"

interface CommentRankPost {
  rank: number
  title: string
  tid: string
  comments: number
}

export default function CommentsPage() {
  const site = useSite()
  const sectionTabs = useDiscoverTabs(routes.comments)
  const { items, loading, error, reload } = useAsyncList(
    api.comments,
    (json) => (json.posts as CommentRankPost[]) ?? []
  )

  const { isExpanded, toggle } = useExpandedBooks("comments")
  const grouped = useMemo(() => {
    if (site !== "1") {
      return items.map((item) => ({ type: "single" as const, item }))
    }
    return groupBooks(
      items,
      (p) => p.title,
      (p) => p.tid
    )
  }, [items, site])

  if (site !== "1") {
    return <Navigate to={`${routes.trending}?site=${site}`} replace />
  }

  return (
    <PageShell>
      <PageHeader
        title="发现"
        description={
          items.length
            ? pageCountLabel(items.length, "帖", "评论榜")
            : "在线榜单与栏目"
        }
      />
      <PageSiteTabs sites={["1"]} hideWhenSingle />
      <SectionTabs items={sectionTabs} />

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
              <SimilarPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
                tid={g.item.tid}
                site="1"
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
                similar={{
                  title: g.title,
                  groupKey: g.key,
                  seedItems: g.items.map((l) => ({
                    tid: l.tid,
                    title: l.title,
                  })),
                }}
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
