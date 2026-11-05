import { useState, type ChangeEvent } from "react"
import type { Bookmark } from "@/hooks/use-bookmarks"
import { Input } from "@/components/ui/input"
import { formatDateTime } from "@/lib/format"

/**
 * 篇内书签列表：摘录、备注、时间；每条点击 → onJump(item) 定位；
 * 改备注（小输入 + 保存）、删除。item.id === staleId 时标「原文可能已变」。
 * 空列表不渲染。
 */
export interface BookmarkListProps {
  items: Bookmark[]
  staleId?: number
  onJump: (item: Bookmark) => void
  onUpdateNote: (id: number, note: string) => Promise<void>
  onRemove: (id: number) => Promise<void>
}

export function BookmarkList({
  items,
  staleId,
  onJump,
  onUpdateNote,
  onRemove,
}: BookmarkListProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [listError, setListError] = useState("")

  if (items.length === 0) return null

  const startEdit = (b: Bookmark) => {
    setEditingId(b.id)
    setDraft(b.note)
    setListError("")
  }
  const saveNote = async (b: Bookmark) => {
    setBusyId(b.id)
    setListError("")
    try {
      await onUpdateNote(b.id, draft.trim())
      setEditingId(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : "保存备注失败")
    } finally {
      setBusyId(null)
    }
  }
  const removeItem = async (b: Bookmark) => {
    setBusyId(b.id)
    setListError("")
    try {
      await onRemove(b.id)
    } catch (e) {
      setListError(e instanceof Error ? e.message : "删除书签失败")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-border/80 bg-card/90 p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        书签
      </h2>
      {listError && (
        <p className="mb-2 text-xs text-destructive">{listError}</p>
      )}
      <ul className="flex flex-col gap-2.5">
        {items.map((b) => (
          <li key={b.id} className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onJump(b)}
              className="flex flex-col items-start gap-1 rounded-xl bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-accent"
            >
              <span className="line-clamp-2 text-sm leading-snug text-foreground">
                {b.quote}
              </span>
              {b.note && (
                <span className="text-xs text-muted-foreground">{b.note}</span>
              )}
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {formatDateTime(b.createdAt)}
                {b.id === staleId && (
                  <span className="text-warning">
                    原文可能已变
                  </span>
                )}
              </span>
            </button>
            <div className="flex items-center gap-3 pl-1 text-xs text-muted-foreground">
              {editingId === b.id ? (
                <>
                  <Input
                    value={draft}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setDraft(e.target.value)
                    }
                    placeholder="备注"
                    className="h-7 w-40 px-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => void saveNote(b)}
                    className="text-foreground transition-colors hover:text-info disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="transition-colors hover:text-foreground"
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(b)}
                  className="transition-colors hover:text-foreground"
                >
                  改备注
                </button>
              )}
              <button
                type="button"
                disabled={busyId === b.id}
                onClick={() => void removeItem(b)}
                className="transition-colors hover:text-destructive disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
