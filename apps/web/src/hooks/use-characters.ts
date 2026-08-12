import { useCallback, useEffect, useState } from "react"
import type {
  CharacterName,
  CharacterScope,
} from "@workspace/core/character-highlight"
import { api } from "@/lib/routes"

const HIGHLIGHT_KEY = "purifier:character-highlight"

export function useCharacterHighlightEnabled() {
  const [enabled, setEnabled] = useState(() => {
    try {
      const v = localStorage.getItem(HIGHLIGHT_KEY)
      return v !== "0"
    } catch {
      return true
    }
  })
  const set = useCallback((next: boolean) => {
    setEnabled(next)
    try {
      localStorage.setItem(HIGHLIGHT_KEY, next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [])
  return { enabled, setEnabled: set }
}

export function useCharacters(kind: "post" | "book", id: string) {
  const [characters, setCharacters] = useState<CharacterName[]>([])
  const [scope, setScope] = useState<CharacterScope | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `${api.meCharacters}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "加载人物失败")
        return
      }
      setScope(json.scope)
      setCharacters(json.characters ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载人物失败")
    } finally {
      setLoading(false)
    }
  }, [kind, id])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (name: string) => {
      const res = await fetch(api.meCharacters, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "标记失败")
      setCharacters(json.characters ?? [])
      return json as { characters: CharacterName[] }
    },
    [kind, id]
  )

  // 与 add 一致：乐观更新本地列表，失败再 reload 回滚（避免 loading 闪烁）
  const remove = useCallback(
    async (name: string) => {
      const prev = characters
      setCharacters((c) => c.filter((x) => x.name !== name))
      const q = new URLSearchParams({ kind, id, name })
      const res = await fetch(`${api.meCharacters}?${q}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) {
        setCharacters(prev)
        throw new Error(json.error || "删除失败")
      }
      return json as { removed: number }
    },
    [kind, id, characters]
  )

  return { characters, scope, error, loading, reload, add, remove }
}
