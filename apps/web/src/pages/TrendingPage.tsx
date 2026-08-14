import { useMemo } from "react"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { SourceBadge } from "@/components/source-badge"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { formatCount } from "@/lib/format"
import { groupBooks } from "@/lib/book-groups"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, bookPath, readPath, routes } from "@/lib/routes"

interface TrendingPost {
  rank: number
  title: string
  tid: string
  reads: number
}

const pickPosts = (json: Record<string, unknown>): TrendingPost[] =>
  (json.posts as TrendingPost[]) ?? []

/** 人气榜：论坛 + 书库同页合并（像搜索结果一样带来源徽标），不再用站点 Tab 切换 */
export default function TrendingPage() {
  const sectionTabs = useDiscoverTabs(routes.trending)
  const forum = useAsyncList(`${api.trending}?site=1`, pickPosts)
  const library = useAsyncList(`${api.trending}?site=2`, pickPosts)

  const { isExpanded, toggle } = useExpandedBooks("trending")
  const libraryGrouped = useMemo(
    () =>
      groupBooks(
        library.items,
        (p) => p.title,
        (p) => p.tid
      ),
    [library.items]
  )

  const loading = forum.loading || library.loading
  const error = forum.error || library.error
  const total = forum.items.length + library.items.length
  const empty = total === 0
  const reload = () => {
    forum.reload()
    library.reload()
  }

  return (
    <PageShell>
      <PageHeader
        title="发现"
        description={
          total
            ? pageCountLabel(total, "帖", "人气 · 论坛与书库 · 按阅读排序")
            : "在线榜单与栏目"
        }
      />
      <SectionTabs items={sectionTabs} />

      <AsyncBody
        loading={loading}
        error={error}
        empty={empty}
        onRetry={reload}
        emptyText="暂无数据"
      >
        <PostList>
          {forum.items.map((p) => (
            <SimilarPostCard
              key={`f:${p.tid}`}
              href={readPath(p.tid, "1")}
              rawTitle={p.title}
              tid={p.tid}
              site="1"
              rank={p.rank}
              statValue={formatCount(p.reads)}
              statUnit="读"
              showGenre
              badge={<SourceBadge site="1" />}
            />
          ))}
          {libraryGrouped.map((g) =>
            g.type === "single" ? (
              <SimilarPostCard
                key={`b:${g.item.tid}`}
                href={bookPath(g.item.tid, { site: "2" })}
                rawTitle={g.item.title}
                tid={g.item.tid}
                site="2"
                rank={g.item.rank}
                statValue={formatCount(g.item.reads)}
                statUnit="读"
                showGenre
                badge={<SourceBadge site="2" />}
              />
            ) : (
              <CollapsibleBookGroup
                key={`bg:${g.key}`}
                title={g.title}
                summary={g.author ?? undefined}
                count={g.items.length}
                bookKey={g.key}
                isExpanded={isExpanded(g.key)}
                onToggle={() => toggle(g.key)}
                trailing={
                  <span className="flex shrink-0 items-center gap-2">
                    {g.genre ? <GenrePill genre={g.genre} /> : null}
                    <SourceBadge site="2" />
                  </span>
                }
              >
                {g.items.map((post) => (
                  <ListPostCard
                    key={post.tid}
                    href={bookPath(post.tid, { site: "2" })}
                    rawTitle={post.title}
                    rank={post.rank}
                    statValue={formatCount(post.reads)}
                    statUnit="读"
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
