import { useCallback, useState } from "react"
import {
  MeListPage,
} from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { api, meListQuery } from "@/lib/routes"

function UnfavoriteButton({
  item,
  reload,
}: {
  item: MeListItem
  reload: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch(
            `${api.meFavorites}?kind=${item.kind}&id=${encodeURIComponent(item.id)}`,
            { method: "DELETE" }
          )
          if (res.ok) reload()
        } finally {
          setBusy(false)
        }
      }}
      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
    >
      取消收藏
    </button>
  )
}

export default function FavoritesPage() {
  const renderTrailing = useCallback(
    (item: MeListItem, reload: () => void) => (
      <UnfavoriteButton item={item} reload={reload} />
    ),
    []
  )
  return (
    <MeListPage
      title="收藏"
      description="收藏的贴子与书库"
      buildUrl={(q, kind, page) =>
        `${api.meFavorites}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
    />
  )
}
