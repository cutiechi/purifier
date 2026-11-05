import { useLocation } from "react-router-dom"
import { type ReactNode } from "react"
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
import { api, bookPath, forumRoutes, libraryRoutes, readPath } from "@/lib/routes"

interface TrendingPost {
  rank: number
  title: string
  tid: string
  reads: number
}

const pickPosts = (json: Record<string, unknown>): TrendingPost[] =>
  (json.posts as TrendingPost[]) ?? []

/** 人气榜：论坛 / 书库分源展示（源由路径前缀表达） */
export default function TrendingPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useDiscoverTabs(pathname)
  const isLibrary = site === "2"
  // 只拉当前源：另一源的榜单请求永远用不到
  const current = useAsyncList(
    `${api.trending}?site=${isLibrary ? "2" : "1"}`,
    pickPosts
  )
  const { items, loading, error, reload } = current

  // 论坛侧按 rank 每 20 条一桶，桶头粘顶（同 key 桶头由 GroupedPostList 去重）
  function forumBucketHeader(p: TrendingPost): ReactNode {
    if (items.length <= 20 || p.rank == null) return null
    const bucket = Math.floor((p.rank - 1) / 20)
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
        title="人气"
        description={
          items.length
            ? pageCountLabel(
                items.length,
                "帖",
                `人气 · ${isLibrary ? "书库" : "论坛"} · 按阅读排序`
              )
            : "在线榜单与栏目"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": forumRoutes.trending,
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
          site={site}
          storageKey="trending"
          group={isLibrary}
          renderBucketHeader={isLibrary ? undefined : forumBucketHeader}
          renderSingle={(p) =>
            isLibrary ? (
              <SimilarPostCard
                key={`b:${p.tid}`}
                href={bookPath(p.tid)}
                rawTitle={p.title}
                tid={p.tid}
                site="2"
                rank={p.rank}
                statValue={formatCount(p.reads)}
                statUnit="读"
                showGenre
              />
            ) : (
              <SimilarPostCard
                key={`f:${p.tid}`}
                href={readPath(p.tid)}
                rawTitle={p.title}
                tid={p.tid}
                site="1"
                rank={p.rank}
                statValue={formatCount(p.reads)}
                statUnit="读"
                showGenre
              />
            )
          }
          renderChild={(post) => (
            <ListPostCard
              key={post.tid}
              href={bookPath(post.tid)}
              rawTitle={post.title}
              rank={post.rank}
              statValue={formatCount(post.reads)}
              statUnit="读"
              showGenre
            />
          )}
        />
      </AsyncBody>
    </PageShell>
  )
}
