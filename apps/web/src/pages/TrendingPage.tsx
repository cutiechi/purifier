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
import { api, bookPath, readPath } from "@/lib/routes"

interface TrendingPost {
  rank: number
  title: string
  tid: string
  reads: number
}

export default function TrendingPage() {
  const site = useSite()
  const { items, loading, error, reload } = useAsyncList(
    `${api.trending}?site=${site}`,
    (json) => (json.posts as TrendingPost[]) ?? []
  )

  const { isExpanded, toggle } = useExpandedBooks("trending")
  const grouped = useMemo(() => {
    if (site !== "1") {
      return items.map((item) => ({ type: "single" as const, item }))
    }
    return groupBooks(items, (p) => p.title)
  }, [items, site])

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
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={
                  site === "2"
                    ? bookPath(g.item.tid, { site })
                    : readPath(g.item.tid, site)
                }
                rawTitle={g.item.title}
                rank={g.item.rank}
                statValue={formatCount(g.item.reads)}
                statUnit="读"
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
                    href={
                      site === "2"
                        ? bookPath(post.tid, { site })
                        : readPath(post.tid, site)
                    }
                    rawTitle={post.title}
                    rank={post.rank}
                    statValue={formatCount(post.reads)}
                    statUnit="读"
                    showGenre
                  />
                ))}
              </CollapsibleBookGroup>
            ),
          )}
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
