import { Fragment, useMemo } from "react"
import { Navigate } from "react-router-dom"
import { PageHeader, SectionLabel } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
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
  // 非论坛站会立刻重定向到人气榜，先别打这一次上游。
  const isForum = site === "1"
  const { items, loading, error, reload } = useAsyncList(
    api.comments,
    (json) => (json.posts as CommentRankPost[]) ?? [],
    { enabled: isForum }
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
        title="评论"
        description={
          items.length
            ? pageCountLabel(items.length, "帖", "评论榜")
            : "在线榜单与栏目"
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
        <PostList>
          {(() => {
            let lastBucket = -1
            return grouped.map((g) => {
              const firstRank =
                g.type === "single" ? g.item.rank : g.items[0]?.rank
              let header = null
              if (items.length > 20 && firstRank != null) {
                const bucket = Math.floor((firstRank - 1) / 20)
                if (bucket > lastBucket) {
                  lastBucket = bucket
                  const start = bucket * 20 + 1
                  header = (
                    <SectionLabel
                      key={`bucket:${start}`}
                      className="sticky top-14 z-10 -mx-3.5 bg-background/95 px-3.5 py-2 backdrop-blur sm:-mx-5 sm:px-5"
                    >
                      {`${start}–${start + 19}`}
                    </SectionLabel>
                  )
                }
              }
              const card =
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
                    trailing={
                      g.genre ? <GenrePill genre={g.genre} /> : undefined
                    }
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
              return header ? (
                <Fragment
                  key={`frag:${g.type === "single" ? g.item.tid : g.key}`}
                >
                  {header}
                  {card}
                </Fragment>
              ) : (
                card
              )
            })
          })()}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
