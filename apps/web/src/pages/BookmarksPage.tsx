import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { useMeTabs } from "@/lib/hub-tabs"
import { useLocation } from "react-router-dom"

export default function BookmarksPage() {
  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)
  return (
    <PageShell>
      <PageHeader title="书签" description="正文里钉下的摘录" />
      <SectionTabs items={sectionTabs} />
      <p className="text-sm text-muted-foreground">暂无书签</p>
    </PageShell>
  )
}
