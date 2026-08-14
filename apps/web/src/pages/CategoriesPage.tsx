import { CategoryGrid, type CategoryItem } from "@/components/category-grid"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { api, DEFAULT_SITE, SITES, type SiteId } from "@/lib/routes"

function normalize(raw: CategoryItem): CategoryItem {
  if (raw.kind) return raw
  try {
    const u = new URL(raw.url, "http://local")
    if (u.searchParams.get("type")) return { ...raw, kind: "type" }
    if (u.searchParams.get("q")) return { ...raw, kind: "column" }
  } catch {
    /* ignore */
  }
  return { ...raw, kind: "other" }
}

const pickLinks = (json: Record<string, unknown>): CategoryItem[] =>
  ((json.links as CategoryItem[]) ?? []).map(normalize)

type AsyncCategoryState = {
  items: CategoryItem[]
  loading: boolean
  error: string
  reload: () => void
}

/** 两站分类区块：站点小标题 + 异步三态 + 网格 */
function CategorySection({
  siteId,
  items,
  loading,
  error,
  reload,
}: AsyncCategoryState & { siteId: SiteId }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">
        {SITES[siteId].label}
      </h2>
      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无分类"
      >
        <CategoryGrid items={items} />
      </AsyncBody>
    </section>
  )
}

/** 页头描述：只统计成功加载（非 loading、非 error）的站，
 *  保证文案与页面可见内容一致；题材口径含书库「有声」（kind==="type"）。 */
function describeHeader(...sites: AsyncCategoryState[]): string {
  if (sites.some((s) => s.loading)) return "书屋栏目与题材"
  const loaded = sites.filter((s) => !s.error)
  if (loaded.length === 0) return "书屋栏目与题材"
  const items = loaded.flatMap((s) => s.items)
  const typeCount = items.filter((i) => i.kind === "type").length
  if (typeCount > 0) return `共 ${typeCount} 个题材`
  if (items.length > 0) return `共 ${items.length} 个入口`
  return "书屋栏目与题材"
}

export default function CategoriesPage() {
  const forum = useAsyncList(
    `${api.categories}?site=${DEFAULT_SITE}`,
    pickLinks
  )
  const library = useAsyncList(`${api.categories}?site=2`, pickLinks)

  return (
    <PageShell>
      <PageHeader title="分类" description={describeHeader(forum, library)} />
      <div className="flex flex-col gap-8">
        <CategorySection siteId={DEFAULT_SITE} {...forum} />
        <CategorySection siteId="2" {...library} />
      </div>
    </PageShell>
  )
}
