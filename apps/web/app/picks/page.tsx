"use client"

import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import {
  PicksSections,
  type PickSection,
} from "@/components/picks-sections"
import { AsyncBody } from "@/components/ui-state"
import { useAsyncList } from "@/hooks/use-async-list"
import { api } from "@/lib/routes"

export default function PicksPage() {
  const { items: sections, loading, error, reload } = useAsyncList(
    api.picks,
    (json) =>
      ((json.sections as PickSection[]) ?? []).filter((s) => s.links?.length)
  )

  const total = sections.reduce((n, s) => n + s.links.length, 0)

  return (
    <PageShell>
      <PageHeader
        title="扫文推荐"
        description={
          sections.length
            ? `共 ${total} 条 · ${sections.length} 组`
            : "首页精选合集与书库入口"
        }
      />

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
