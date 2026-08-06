import { useCallback, useEffect, useState } from "react"
import { Settings2 } from "lucide-react"
import { IconRefreshCw, IconStar } from "@/components/icons"
import { TagChips } from "@/components/tag-chips"
import { ReadingSettingsPanel } from "@/components/reading-settings-panel"
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
  const [showSettings, setShowSettings] = useState(false)

  const toggleFavorite = async () => {
    if (state?.favorited) {
      const title = state.title?.trim() || "该条目"
      if (!window.confirm(`取消收藏「${title}」？`)) return
    }
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

  const [removing, setRemoving] = useState<string | null>(null)
  const removeTag = async (tag: string) => {
    const current = state?.tags ?? []
    setRemoving(tag)
    try {
      await saveTags(current.filter((t) => t !== tag))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggleFavorite()}
        disabled={busy}
        className={[
          "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:min-h-0",
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
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 sm:min-h-0"
      >
        <IconRefreshCw
          size={13}
          className={refreshing ? "animate-spin" : undefined}
        />
        刷新
      </button>

      <TagEditor
        tags={state?.tags ?? []}
        onSave={saveTags}
        onRemove={(tag) => void removeTag(tag)}
        removing={removing}
      />

      <button
        type="button"
        onClick={() => setShowSettings((v) => !v)}
        aria-label="阅读设置"
        className={`inline-flex size-8 items-center justify-center rounded-full border transition ${
          showSettings
            ? "border-foreground/40 bg-foreground/10"
            : "border-border hover:bg-muted"
        }`}
      >
        <Settings2 className="size-4" />
      </button>
      {showSettings && (
        <div className="w-full">
          <ReadingSettingsPanel />
        </div>
      )}
    </div>
  )
}

function formatTagsInput(tags: string[]): string {
  return tags.join(", ")
}

function TagEditor({
  tags,
  onSave,
  onRemove,
  removing,
}: {
  tags: string[]
  onSave: (tags: string[]) => Promise<boolean>
  onRemove?: (tag: string) => void
  removing?: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const open = () => {
    setValue(formatTagsInput(tags))
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setValue(formatTagsInput(tags))
  }

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
      <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape") cancel()
          }}
          placeholder="多个标签用逗号分隔"
          className="h-9 w-44 max-w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60 sm:h-8 sm:w-52"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="min-h-9 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50 sm:min-h-0"
        >
          保存
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="min-h-9 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground sm:min-h-0"
        >
          取消
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <TagChips tags={tags} onRemove={onRemove} removing={removing} />
      <button
        type="button"
        onClick={open}
        className="min-h-9 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-0"
      >
        编辑标签
      </button>
    </span>
  )
}
