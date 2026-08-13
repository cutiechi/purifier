import { useCallback, useState } from "react"
import { useConfirm } from "@/components/confirm-dialog"
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
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const ok = await confirm({
          title: "删除历史记录？",
          description: `从浏览历史删除「${item.title}」。`,
          confirmLabel: "删除",
          destructive: true,
        })
        if (!ok) return
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
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const clearPage = async () => {
    if (items.length === 0) return
    const ok = await confirm({
      title: `清空本页 ${items.length} 条？`,
      description: "相关收藏、标签与书签也会一并移除。",
      confirmLabel: "清空本页",
      destructive: true,
    })
    if (!ok) return
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
    const ok = await confirm({
      title: "清空全部浏览历史？",
      description: "所有历史、收藏与标签都会被移除，且不可恢复。",
      confirmLabel: "全部清空",
      destructive: true,
    })
    if (!ok) return
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
        className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        清空本页
      </button>
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void clearAll()}
        className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
      bookGroupScope="history"
      buildUrl={(q, kind, page) =>
        `${api.meHistory}?${meListQuery({ q, kind, page })}`
      }
      pick={(json) =>
        json as { items: MeListItem[]; nextPage?: number; total?: number }
      }
      renderTrailing={renderTrailing}
      toolbar={toolbar}
      emptyText="还没有浏览记录，打开一篇帖子或书库即可"
    />
  )
}
