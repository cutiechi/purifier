import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/routes"

/** API /api/me/bookmarks 列表项形状（store mapBookmark 的 JSON） */
export interface Bookmark {
  id: number
  site: string
  kind: "post" | "book"
  itemId: string
  title: string
  chapter: number | null
  quote: string
  note: string
  scrollProgress: number
  createdAt: number
}

/** fetch 失败响应 → 带 HTTP status 的 Error，调用方（页面）可按 status 分流（如 409） */
function httpError(message: string, status: number): Error {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

/**
 * 当前篇/当前章书签：GET 列表 + 增/改备注/删。
 * enabled=false 不请求（书库目录页 / 内容未挂载）；chapter 仅在 xbookcn 章传入，
 * cool18 整本与论坛帖不传（后端存 NULL）。
 */
export function useBookmarks(opts: {
  site: string
  kind: "post" | "book"
  id: string
  chapter?: number
  enabled: boolean
}) {
  const { site, kind, id, chapter, enabled } = opts
  const [items, setItems] = useState<Bookmark[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // 防止慢的旧请求（篇/章已切换）覆盖新作用域：序号递增，过期响应直接丢弃
  const seqRef = useRef(0)
  // 换作用域（篇/章/站）先清旧列表，避免新内容下闪现旧篇书签
  const scopeRef = useRef<string | null>(null)
  const scopeKey = `${kind}:${id}:${site}:${chapter ?? ""}`

  const reload = useCallback(async () => {
    if (!enabled) return
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey
      setItems([])
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ kind, id, site })
      if (chapter !== undefined) params.set("chapter", String(chapter))
      const res = await fetch(`${api.meBookmarks}?${params.toString()}`)
      const json = await res.json()
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(json.error || "加载书签失败")
        return
      }
      setItems(json.items ?? [])
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : "加载书签失败")
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [enabled, kind, id, site, chapter])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (input: { quote: string; note: string; scrollProgress: number }) => {
      const res = await fetch(api.meBookmarks, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          id,
          quote: input.quote,
          site,
          chapter, // undefined 时 JSON 序列化省略，后端存 NULL
          note: input.note,
          scrollProgress: input.scrollProgress,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        // 409（已满）/400 等抛给页面：status 用于分流展示文案
        throw httpError(json.error || "保存书签失败", res.status)
      }
      setItems((prev) => [json.bookmark, ...prev])
    },
    [kind, id, site, chapter]
  )

  const updateNote = useCallback(async (bookmarkId: number, note: string) => {
    const res = await fetch(`${api.meBookmarks}/${bookmarkId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    })
    const json = await res.json()
    if (!res.ok) {
      throw httpError(json.error || "修改备注失败", res.status)
    }
    setItems((prev) =>
      prev.map((b) => (b.id === bookmarkId ? { ...b, note } : b))
    )
  }, [])

  const remove = useCallback(async (bookmarkId: number) => {
    const res = await fetch(`${api.meBookmarks}/${bookmarkId}`, {
      method: "DELETE",
    })
    const json = await res.json()
    if (!res.ok) {
      throw httpError(json.error || "删除书签失败", res.status)
    }
    setItems((prev) => prev.filter((b) => b.id !== bookmarkId))
  }, [])

  return { items, loading, error, reload, add, updateNote, remove }
}
