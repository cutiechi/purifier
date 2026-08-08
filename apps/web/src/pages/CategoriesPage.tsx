import { CategoryGrid, type CategoryItem } from "@/components/category-grid"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import { api } from "@/lib/routes"

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

export default function CategoriesPage() {
  const site = useSite()
  const { items, loading, error, reload } = useAsyncList(
    `${api.categories}?site=${site}`,
    (json) => ((json.links as CategoryItem[]) ?? []).map(normalize)
  )

  const typeCount = items.filter((i) => i.kind === "type").length

  return (
    <PageShell>
      <PageHeader
        title="分类"
        description={
          items.length
            ? typeCount
              ? `共 ${typeCount} 个题材`
              : `共 ${items.length} 个入口`
            : "书屋栏目与题材"
        }
      />
      <PageSiteTabs />

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={reload}
        emptyText="暂无分类"
      >
        <CategoryGrid items={items} />
      </AsyncBody>
    </PageShell>
  )
}
