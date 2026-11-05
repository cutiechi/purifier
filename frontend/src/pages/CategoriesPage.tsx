import { CategoryGrid, type CategoryItem } from "@/components/category-grid"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SiteTabs } from "@/components/site-tabs"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import {
  api,
  DEFAULT_SITE,
  forumRoutes,
  libraryRoutes,
  type SiteId,
} from "@/lib/routes"

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

/** 单源分类区块：异步三态 + 网格（源由页内二级切换表达，不再重复小标题） */
function CategorySection({
  items,
  loading,
  error,
  reload,
}: AsyncCategoryState) {
  return (
    <section>
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

/** 页头描述：题材口径含书库「有声」（kind==="type"） */
function describeHeader(site: SiteId, state: AsyncCategoryState): string {
  if (state.loading) return site === "2" ? "书库题材" : "书屋栏目"
  if (state.error || state.items.length === 0)
    return site === "2" ? "书库题材" : "书屋栏目"
  const typeCount = state.items.filter((i) => i.kind === "type").length
  if (typeCount > 0) return `共 ${typeCount} 个题材`
  return `共 ${state.items.length} 个栏目入口`
}

/** 分类：当前源的栏目/题材入口，页内二级切换另一源 */
export default function CategoriesPage() {
  const site = useSite()
  const isLibrary = site === "2"
  // 只拉当前源：另一源的请求永远用不到
  const current = useAsyncList(
    `${api.categories}?site=${isLibrary ? "2" : DEFAULT_SITE}`,
    pickLinks
  )

  return (
    <PageShell>
      <PageHeader
        title="分类"
        description={describeHeader(site, current)}
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": forumRoutes.categories,
              "2": libraryRoutes.categories,
            }}
          />
        }
      />
      <div className="flex flex-col gap-8">
        <CategorySection {...current} />
      </div>
    </PageShell>
  )
}
