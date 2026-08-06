import { useCallback, useEffect, useState } from "react"
import { Settings2, Star, Tag } from "lucide-react"
import { IconRefreshCw, IconStar } from "@/components/icons"
import { Popover } from "@/components/ui/popover"
import { ReadingSettingsPanel } from "@/components/reading-settings-panel"
import { TagChips } from "@/components/tag-chips"
import { api } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

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
  read_progress: number | null
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
  state,
  reload,
  onRefresh,
  refreshing,
}: {
  kind: "post" | "book"
  id: string
  state: ItemState | null
  reload: () => Promise<void>
  onRefresh: () => void
  refreshing: boolean
}) {
  const [busy, setBusy] = useState(false)

  const toggleFavorite = async () => {
    if (state?.favorited) {
      const title = state.title?.trim() || "该条目"
      if (!window.confirm(`取消收藏「${title}」？`)) return
      // confirm 期间不关 Popover：confirm 是系统模态，返回后浮层保持 open
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

  const favorited = state?.favorited ?? false
  const hasTags = (state?.tags?.length ?? 0) > 0

  return (
    <div className="flex justify-end">
      <Popover
      align="end"
      triggerAriaLabel="阅读操作与偏好"
      trigger={
        <span
          className={cn(
            "relative inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            favorited
              ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
              : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Settings2 className="size-4" />
          {favorited && (
            <Star
              className="absolute -right-0.5 -top-0.5 size-2.5 fill-current"
              aria-hidden
            />
          )}
          {hasTags && (
            <Tag
              className="absolute -bottom-0.5 -right-0.5 size-2.5"
              aria-hidden
            />
          )}
        </span>
      }
    >
      <div className="flex w-72 flex-col gap-1">
        {/* 收藏 */}
        <button
          type="button"
          onClick={() => void toggleFavorite()}
          disabled={busy}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50",
            favorited
              ? "text-amber-600 hover:bg-amber-400/10 dark:text-amber-400"
              : "hover:bg-accent"
          )}
        >
          <IconStar size={14} filled={favorited} />
          {favorited ? "已收藏" : "收藏"}
        </button>

        {/* 刷新 */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <IconRefreshCw
            size={14}
            className={refreshing ? "animate-spin" : undefined}
          />
          刷新
        </button>

        {/* 标签 */}
        <TagEditor
          tags={state?.tags ?? []}
          onSave={saveTags}
          onRemove={(tag) => void removeTag(tag)}
          removing={removing}
        />

        <div className="my-2 border-t border-border" />

        {/* 阅读偏好 */}
        <ReadingSettingsPanel />
      </div>
      </Popover>
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
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
              if (e.key === "Escape") {
                e.stopPropagation() // 双保险：Popover 对可编辑 target 已直接 return，此处再 stopPropagation
                cancel()
              }
            }}
            placeholder="多个标签用逗号分隔"
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-lg bg-muted/70 px-2.5 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">标签</span>
        <button
          type="button"
          onClick={open}
          className="rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          编辑
        </button>
      </div>
      {tags.length > 0 ? (
        <TagChips tags={tags} onRemove={onRemove} removing={removing} />
      ) : (
        <span className="text-xs text-muted-foreground/60">无标签</span>
      )}
    </div>
  )
}
