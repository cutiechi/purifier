import { useCallback, useEffect, useState } from "react"
import { IconRefreshCw, IconStar } from "@/components/icons"
import { TagChips } from "@/components/tag-chips"
import { api } from "@/lib/routes"

export interface ItemState {
  kind: "post" | "book"
  id: string
  title: string
  url: string
  first_seen_at: number
  last_visited_at: number
  visit_count: number
  favorited: boolean
  tags: string[]
}

/** 打开页面时回填 /api/me/state */
export function useItemState(kind: "post" | "book", id: string) {
  const [state, setState] = useState<ItemState | null>(null)
  const reload = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(
        `${api.meState}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      if (!res.ok) return
      const json = (await res.json()) as ItemState
      setState(json)
    } catch {
      // 状态读取失败静默，不影响正文展示
    }
  }, [kind, id])
  useEffect(() => {
    void reload()
  }, [reload])
  return { state, reload }
}

export function ItemActions({
  kind,
  id,
  onRefresh,
  refreshing,
}: {
  kind: "post" | "book"
  id: string
  onRefresh: () => void
  refreshing: boolean
}) {
  const { state, reload } = useItemState(kind, id)
  const [busy, setBusy] = useState(false)

  const toggleFavorite = async () => {
    setBusy(true)
    try {
      const method = state?.favorited ? "DELETE" : "PUT"
      const res = await fetch(
        `${api.meFavorites}?kind=${kind}&id=${encodeURIComponent(id)}`,
        { method }
      )
      if (res.ok) await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveTags = async (tags: string[]) => {
    const res = await fetch(api.meTags, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, tags }),
    })
    if (res.ok) await reload()
    return res.ok
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggleFavorite()}
        disabled={busy}
        className={[
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
          state?.favorited
            ? "bg-amber-400/15 text-amber-600 hover:bg-amber-400/25 dark:text-amber-400"
            : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground",
        ].join(" ")}
      >
        <IconStar size={13} filled={state?.favorited} />
        {state?.favorited ? "已收藏" : "收藏"}
      </button>

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-lg bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <IconRefreshCw
          size={13}
          className={refreshing ? "animate-spin" : undefined}
        />
        刷新
      </button>

      <TagEditor tags={state?.tags ?? []} onSave={saveTags} />
    </div>
  )
}

function TagEditor({
  tags,
  onSave,
}: {
  tags: string[]
  onSave: (tags: string[]) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const next = value
      .split(/[，,]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const ok = await onSave(next)
    setBusy(false)
    if (ok) {
      setValue("")
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape") setEditing(false)
          }}
          placeholder="多个标签用逗号分隔"
          className="h-8 w-52 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
        >
          取消
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TagChips tags={tags} />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        编辑标签
      </button>
    </span>
  )
}
