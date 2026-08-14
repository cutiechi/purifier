import { useMemo } from "react"
import { Navigate } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { SectionTabs } from "@/components/section-tabs"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { AsyncBody } from "@/components/ui-state"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { SimilarPostCard } from "@/components/similar-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, readPath, routes, DISCOVER_TABS } from "@/lib/routes"

interface ChapterLink {
  index: number
  title: string
  tid: string
}

export default function FeaturedPage() {
  const site = useSite()
  const sectionTabs = useDiscoverTabs(routes.featured)
  const { items, loading, error, reload } = useAsyncList(
    api.featured,
    (json) => (json.links as ChapterLink[]) ?? []
  )

  const { isExpanded, toggle } = useExpandedBooks("featured")
  const grouped = useMemo(
    () =>
      groupBooks(
        items,
        (l) => l.title,
        (l) => l.tid
      ),
    [items]
  )
  // 原始 items 下标查找（用于 single 项的 index 兜底，避免 grouped 下标跳变）
  const indexOfItem = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it, i) => m.set(it.tid, i + 1))
    return m
  }, [items])

  if (site !== "1") {
    return <Navigate to={`${routes.trending}?site=${site}`} replace />
  }

  return (
    <PageShell>
      <PageHeader
        title="发现"
        description={
          items.length
            ? pageCountLabel(items.length, "篇", "精华热贴")
            : "在线榜单与栏目"
        }
      />
      <PageSiteTabs
        sites={DISCOVER_TABS.find((t) => t.href === routes.featured)!.sites}
        hideWhenSingle
      />
      <SectionTabs items={sectionTabs} />

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无精华"
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
                index={g.item.index || indexOfItem.get(g.item.tid) || 1}
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
                {g.items.map((link) => (
                  <ListPostCard
                    key={link.tid}
                    href={readPath(link.tid)}
                    rawTitle={link.title}
                    index={link.index}
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
