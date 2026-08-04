import { useCallback, useState } from "react"
import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { api, meListQuery } from "@/lib/routes"

function DeleteHistoryButton({
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
        if (!window.confirm(`从浏览历史删除「${item.title}」？`)) return
        setBusy(true)
        try {
          const res = await fetch(
            `${api.meHistory}?kind=${item.kind}&id=${encodeURIComponent(item.id)}`,
            { method: "DELETE" }
          )
          if (res.ok) reload()
        } finally {
          setBusy(false)
        }
      }}
      className="min-h-9 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:min-h-0"
    >
      删除
    </button>
  )
}

function HistoryToolbar({
  items,
  reload,
  loading,
}: {
  items: MeListItem[]
  reload: () => void
  loading: boolean
}) {
  const [busy, setBusy] = useState(false)

  const clearPage = async () => {
    if (items.length === 0) return
    if (
      !window.confirm(
        `清空本页 ${items.length} 条浏览历史？相关收藏与标签也会一并移除。`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(api.meHistory, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((it) => ({ kind: it.kind, id: it.id })),
        }),
      })
      if (res.ok) reload()
    } finally {
      setBusy(false)
    }
  }

  const clearAll = async () => {
    if (
      !window.confirm(
        "清空全部浏览历史？所有历史、收藏与标签都会被移除，且不可恢复。"
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`${api.meHistory}?all=1`, { method: "DELETE" })
      if (res.ok) reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy || loading || items.length === 0}
        onClick={() => void clearPage()}
        className="min-h-9 rounded-lg bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        清空本页
      </button>
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void clearAll()}
        className="min-h-9 rounded-lg bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        清空全部
      </button>
    </div>
  )
}

export default function HistoryPage() {
  const renderTrailing = useCallback(
    (item: MeListItem, reload: () => void) => (
      <DeleteHistoryButton item={item} reload={reload} />
    ),
    []
  )
  const toolbar = useCallback(
    (ctx: { items: MeListItem[]; reload: () => void; loading: boolean }) => (
      <HistoryToolbar {...ctx} />
    ),
    []
  )
  return (
    <MeListPage
      title="浏览历史"
      description="最近访问的贴子与书库"
      buildUrl={(q, kind, page) =>
        `${api.meHistory}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) => json as { items: MeListItem[]; nextPage?: number }}
      renderTrailing={renderTrailing}
      toolbar={toolbar}
    />
  )
}
