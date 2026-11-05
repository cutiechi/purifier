import { Fragment, isValidElement, type ReactNode } from "react"
import { PostList } from "@/components/post-card"
import { ListPostCard, GenrePill } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { SimilarPostCard } from "@/components/similar-post-card"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { groupBooks } from "@/lib/book-groups"
import { bookPath, readPath, type SiteId } from "@/lib/routes"

interface GroupedPostListProps<T extends { tid: string; title: string }> {
  items: T[]
  site: SiteId
  /** 折叠状态命名空间（useExpandedBooks，页面级隔离） */
  storageKey: string
  /** false = 不按系列折叠，逐条平铺（榜单类） */
  group?: boolean
  showGenre?: boolean
  /** 自定义单条卡片（榜单 rank/统计、归档条目等）；缺省：论坛 SimilarPostCard / 书库 ListPostCard。须自带 key */
  renderSingle?: (item: T) => ReactNode
  /** 自定义组内子卡；缺省 ListPostCard。须自带 key */
  renderChild?: (item: T) => ReactNode
  /** rank 分桶粘头（人气/评论榜按 20 一桶），入参为该桶首条；返回元素须带稳定 key，
   *  同 key 只渲染首次出现（桶头去重由本组件按渲染纯函数处理，调用方不持有可变状态） */
  renderBucketHeader?: (firstItem: T) => ReactNode
}

/**
 * 系列折叠列表：groupBooks 分组 → 单条卡片 / CollapsibleBookGroup 两分支。
 * 论坛单条与折叠组带「搜索相似」；书库为普通条目。各榜单页通过
 * renderSingle/renderChild/renderBucketHeader 注入差异，不再各写一份分支。
 */
export function GroupedPostList<T extends { tid: string; title: string }>({
  items,
  site,
  storageKey,
  group = true,
  showGenre = true,
  renderSingle,
  renderChild,
  renderBucketHeader,
}: GroupedPostListProps<T>) {
  const { isExpanded, toggle } = useExpandedBooks(storageKey)
  const isForum = site !== "2"
  const href = (tid: string) => (site === "2" ? bookPath(tid) : readPath(tid))

  function renderCard(g: T): ReactNode {
    return renderSingle?.(g) ?? (
      isForum ? (
        <SimilarPostCard
          key={g.tid}
          href={readPath(g.tid)}
          rawTitle={g.title}
          tid={g.tid}
          site="1"
          showGenre={showGenre}
        />
      ) : (
        <ListPostCard
          key={g.tid}
          href={bookPath(g.tid)}
          rawTitle={g.title}
          showGenre={showGenre}
        />
      )
    )
  }

  function renderGrouped(g: {
    key: string
    title: string
    author: string | null
    genre: string | null
    items: T[]
  }): ReactNode {
    return (
      <CollapsibleBookGroup
        key={`group:${g.key}`}
        title={g.title}
        summary={g.author ?? undefined}
        count={g.items.length}
        bookKey={g.key}
        isExpanded={isExpanded(g.key)}
        onToggle={() => toggle(g.key)}
        trailing={
          g.genre ? (
            <span className="flex shrink-0 items-center gap-2">
              <GenrePill genre={g.genre} />
            </span>
          ) : undefined
        }
        similar={
          isForum
            ? {
                title: g.title,
                groupKey: g.key,
                seedItems: g.items.map((l) => ({
                  tid: l.tid,
                  title: l.title,
                })),
              }
            : undefined
        }
      >
        {g.items.map((it) =>
          renderChild?.(it) ?? (
            <ListPostCard
              key={it.tid}
              href={href(it.tid)}
              rawTitle={it.title}
              showGenre={showGenre}
            />
          )
        )}
      </CollapsibleBookGroup>
    )
  }

  const grouped = group
    ? groupBooks(items, (l) => l.title, (l) => l.tid)
    : items.map((item) => ({ type: "single" as const, item }))

  // 桶头去重：同 key 只渲染首次出现（Set 每渲染重建，纯函数无跨渲染状态）
  const seenHeaderKeys = new Set<string | number>()

  return (
    <PostList>
      {grouped.map((g) => {
        const first = g.type === "single" ? g.item : g.items[0]
        const rawHeader = renderBucketHeader?.(first) ?? null
        const headerKey = isValidElement(rawHeader) ? rawHeader.key : null
        const header =
          rawHeader != null &&
          (headerKey == null || !seenHeaderKeys.has(headerKey))
            ? rawHeader
            : null
        if (headerKey != null) seenHeaderKeys.add(headerKey)
        const card =
          g.type === "single" ? (
            renderCard(g.item)
          ) : (
            renderGrouped({
              key: g.key,
              title: g.title,
              author: g.author,
              genre: g.genre,
              items: g.items,
            })
          )
        return header ? (
          <Fragment key={g.type === "single" ? g.item.tid : g.key}>
            {header}
            {card}
          </Fragment>
        ) : (
          card
        )
      })}
    </PostList>
  )
}
