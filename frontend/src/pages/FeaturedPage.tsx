import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { SiteTabs } from "@/components/site-tabs"
import { GroupedPostList } from "@/components/grouped-post-list"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, forumRoutes, libraryRoutes, readPath } from "@/lib/routes"
import type { ChapterLink } from "@/lib/types"

export default function FeaturedPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useDiscoverTabs(pathname)
  const { items, loading, error, reload } = useAsyncList(
    api.featured,
    (json) => (json.links as ChapterLink[]) ?? []
  )

  // 原始 items 下标查找（用于 single 项的 index 兜底，避免 grouped 下标跳变）
  const indexOfItem = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it, i) => m.set(it.tid, i + 1))
    return m
  }, [items])

  return (
    <PageShell>
      <PageHeader
        title="精华"
        description={
          items.length
            ? pageCountLabel(items.length, "篇", "精华热贴")
            : "在线榜单与栏目"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": forumRoutes.featured,
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
        emptyText="暂无精华"
      >
        <GroupedPostList
          items={items}
          site="1"
          storageKey="featured"
          renderSingle={(item) => (
            <SimilarPostCard
              key={item.tid}
              href={readPath(item.tid)}
              rawTitle={item.title}
              tid={item.tid}
              site="1"
              index={item.index || indexOfItem.get(item.tid) || 1}
              showGenre
            />
          )}
          renderChild={(link) => (
            <ListPostCard
              key={link.tid}
              href={readPath(link.tid)}
              rawTitle={link.title}
              index={link.index}
              showGenre
            />
          )}
        />
      </AsyncBody>
    </PageShell>
  )
}
