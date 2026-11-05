import { useLocation } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { SiteTabs } from "@/components/site-tabs"
import { PicksSections, type PickSection } from "@/components/picks-sections"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { useSite } from "@/hooks/use-site"
import { useDiscoverTabs } from "@/lib/hub-tabs"
import { api, forumRoutes, libraryRoutes } from "@/lib/routes"

export default function PicksPage() {
  const site = useSite()
  const { pathname } = useLocation()
  const sectionTabs = useDiscoverTabs(pathname)
  const {
    items: sections,
    loading,
    error,
    reload,
  } = useAsyncList(
    api.picks,
    (json) =>
      ((json.sections as PickSection[]) ?? []).filter((s) => s.links?.length)
  )

  const total = sections.reduce((n, s) => n + s.links.length, 0)

  return (
    <PageShell>
      <PageHeader
        title="扫文"
        description={
          sections.length
            ? `扫文 · 共 ${total} 条 · ${sections.length} 组`
            : "在线榜单与栏目"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": forumRoutes.picks,
              "2": libraryRoutes.trending,
            }}
          />
        }
      />
      <SectionTabs items={sectionTabs} />

      <AsyncBody
        loading={loading}
        error={error}
        empty={sections.length === 0}
        onRetry={reload}
        emptyText="暂无推荐"
      >
        <PicksSections sections={sections} />
      </AsyncBody>
    </PageShell>
  )
}
