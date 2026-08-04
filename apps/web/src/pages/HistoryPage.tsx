import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { api, meListQuery } from "@/lib/routes"

export default function HistoryPage() {
  return (
    <MeListPage
      title="浏览历史"
      description="最近访问的贴子与书库"
      buildUrl={(q, kind, page) =>
        `${api.meHistory}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
    />
  )
}
