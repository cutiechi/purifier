import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  flattenClusterMarks,
  type CharacterCluster,
  type CharacterScope,
} from "@workspace/core/character-highlight"
import { api } from "@/lib/routes"

const HIGHLIGHT_KEY = "purifier:character-highlight"

/** fetch 失败响应 → 带 HTTP status 的 Error，调用方（页面）可按 status 分流（如 409） */
function httpError(message: string, status: number): Error {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

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
  const [clusters, setClusters] = useState<CharacterCluster[]>([])
  const [scope, setScope] = useState<CharacterScope | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const marks = useMemo(() => flattenClusterMarks(clusters), [clusters])

  // 防止慢的旧请求（kind/id 已切换）覆盖新作用域：序号递增，过期响应直接丢弃
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    if (!id) return
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `${api.meCharacters}?kind=${kind}&id=${encodeURIComponent(id)}`
      )
      const json = await res.json()
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(json.error || "加载人物失败")
        return
      }
      setScope(json.scope)
      setClusters(json.clusters ?? [])
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "加载人物失败")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [kind, id])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (name: string, clusterId?: number) => {
      const body: Record<string, unknown> = { kind, id, name }
      if (clusterId !== undefined) body.clusterId = clusterId
      const res = await fetch(api.meCharacters, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw httpError(json.error || "标记失败", res.status)
      setClusters(json.clusters ?? [])
      return json as { ok: boolean; cluster: CharacterCluster; clusters: CharacterCluster[] }
    },
    [kind, id]
  )

  // 乐观删除本地集群；失败 reload 回滚（服务端权威列表，避免旧快照复活已删名字、丢弃并发新增）。
  // 最后一个称呼被删时集群被清掉，与 store pruneEmptyClusters 一致。
  const remove = useCallback(
    async (name: string) => {
      setClusters((prev) =>
        prev
          .map((c) =>
            c.names.includes(name)
              ? { ...c, names: c.names.filter((n) => n !== name) }
              : c
          )
          .filter((c) => c.names.length > 0)
      )
      const q = new URLSearchParams({ kind, id, name })
      const res = await fetch(`${api.meCharacters}?${q}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) {
        await reload()
        throw httpError(json.error || "删除失败", res.status)
      }
      return json as { ok: boolean; removed: number }
    },
    [kind, id, reload]
  )

  // 集群级 PATCH：merge / split / recolor，成功以服务端权威 clusters 整体覆盖
  const patchOp = useCallback(
    async (op: string, body: Record<string, unknown>) => {
      const res = await fetch(api.meCharacters, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, op, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw httpError(json.error || "操作失败", res.status)
      setClusters(json.clusters ?? [])
      return json as { ok: boolean; clusters: CharacterCluster[] }
    },
    [kind, id]
  )

  const merge = useCallback(
    async (clusterIds: number[], hue: number) => {
      return patchOp("merge", { clusterIds, hue })
    },
    [patchOp]
  )

  const split = useCallback(
    async (clusterId: number, name: string) => {
      return patchOp("split", { clusterId, name })
    },
    [patchOp]
  )

  const recolor = useCallback(
    async (clusterId: number, hue: number) => {
      return patchOp("recolor", { clusterId, hue })
    },
    [patchOp]
  )

  return { clusters, marks, scope, error, loading, reload, add, remove, merge, split, recolor }
}
