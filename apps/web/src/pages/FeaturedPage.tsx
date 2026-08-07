import { useMemo } from "react"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { ListPostCard, pageCountLabel } from "@/components/list-post-card"
import { AsyncBody } from "@/components/ui-state"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
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
          {grouped.map((g) =>
            g.type === "single" ? (
              <ListPostCard
                key={g.item.tid}
                href={readPath(g.item.tid)}
                rawTitle={g.item.title}
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
