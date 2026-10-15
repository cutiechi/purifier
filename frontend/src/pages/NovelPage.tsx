import { useCallback } from "react"
import { Link } from "react-router-dom"
import { PageHeader, PageShell, SectionLabel } from "@/components/page-shell"
import { PostCard, PostList } from "@/components/post-card"
import { AsyncBody } from "@/components/ui-state"
import { SectionTabs } from "@/components/section-tabs"
import { useAsyncList } from "@/hooks/use-async-list"
import { api, bookPath, browsePath, routes } from "@/lib/routes"
import { useDiscoverTabs } from "@/lib/hub-tabs"

interface BookItem {
  index: number
  title: string
  tid: string
}

interface CategoryItem {
  label: string
  url: string
  kind: "type" | "column" | "other"
}

const pickBooks = (json: Record<string, unknown>): BookItem[] =>
  (json.links as BookItem[]) ?? []

const pickCategories = (json: Record<string, unknown>): CategoryItem[] =>
  (json.links as CategoryItem[]) ?? []

/** 书库首页：话题材入口 + 热门推荐（结构与论坛「发现/首页」一致） */
export default function NovelPage() {
  const sectionTabs = useDiscoverTabs(routes.novel)
  const books = useAsyncList(api.booksHome, pickBooks)
  const categories = useAsyncList(`${api.categories}?site=2`, pickCategories)
  const reload = useCallback(() => {
    books.reload()
    categories.reload()
  }, [books, categories])

  const error = books.error || categories.error
  const loading = books.loading || categories.loading

  return (
    <PageShell>
      <PageHeader
        title="小说书库"
        description={
          categories.items.length
            ? `共 ${categories.items.length} 个题材 · 无弹窗、无转码广告`
            : "沉浸式网文阅读，无弹窗、无转码广告"
        }
      />
      <SectionTabs items={sectionTabs} />

      <AsyncBody
        loading={loading}
        error={error}
        empty={books.items.length === 0 && categories.items.length === 0}
        onRetry={reload}
        emptyText="书库暂无推荐"
      >
        <div className="flex flex-col gap-10 pb-12">
          {categories.items.length > 0 && (
            <section>
              <SectionLabel>题材</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                {categories.items.slice(0, 12).map((c) => (
                  <Link
                    key={c.url}
                    to={c.url}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border/60 bg-card/60 px-3 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-accent"
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionLabel
              action={
                <Link
                  to={browsePath({ site: "2", type: "fantasy" })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  浏览更多 &rarr;
                </Link>
              }
            >
              热门推荐
            </SectionLabel>
            <PostList>
              {books.items.map((b) => (
                <PostCard
                  key={b.tid}
                  href={bookPath(b.tid, { site: "2" })}
                  title={b.title}
                  leading={
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                      {b.index}
                    </span>
                  }
                />
              ))}
            </PostList>
          </section>
        </div>
      </AsyncBody>
    </PageShell>
  )
}
