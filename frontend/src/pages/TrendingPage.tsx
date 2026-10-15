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
import { useSite } from "@/hooks/use-site"
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

/** 人气榜：论坛 / 书库分站展示，遵循 ?site=（与其它列表页一致） */
export default function TrendingPage() {
  const site = useSite()
  const sectionTabs = useDiscoverTabs(routes.trending)
  const isLibrary = site === "2"
  const forum = useAsyncList(`${api.trending}?site=1`, pickPosts)
  const library = useAsyncList(`${api.trending}?site=2`, pickPosts)

  const items = isLibrary ? library.items : forum.items
  const loading = isLibrary ? library.loading : forum.loading
  const error = isLibrary ? library.error : forum.error
  const reload = isLibrary ? library.reload : forum.reload

  const { isExpanded, toggle } = useExpandedBooks("trending")
  const libraryGrouped = useMemo(
    () => groupBooks(items, (p) => p.title, (p) => p.tid),
    [items]
  )

  return (
    <PageShell>
      <PageHeader
        title="发现"
        description={
          items.length
            ? pageCountLabel(
                items.length,
                "帖",
                `人气 · ${isLibrary ? "书库" : "论坛"} · 按阅读排序`
              )
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
          {isLibrary
            ? libraryGrouped.map((g) =>
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
              )
            : items.map((p) => (
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
        </PostList>
      </AsyncBody>
    </PageShell>
  )
}
