"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export async function fetchJsonList<T>(
  url: string,
  pick: (json: Record<string, unknown>) => T[]
): Promise<T[]> {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || "请求失败")
  }
  return pick(json as Record<string, unknown>)
}

/**
 * 按 url 拉取列表。pick 用 ref 保存，避免闭包过期。
 * enabled=false 时不发请求（用于先重定向、再渲染的页面，避免白打一次上游）。
 */
export function useAsyncList<T>(
  url: string,
  pick: (json: Record<string, unknown>) => T[],
  opts?: { enabled?: boolean }
) {
  const enabled = opts?.enabled ?? true
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const pickRef = useRef(pick)
  pickRef.current = pick
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) {
      seqRef.current++
      setItems([])
      setError("")
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const next = await fetchJsonList(url, (json) => pickRef.current(json))
      if (seq !== seqRef.current) return
      setItems(next)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : "未知错误")
      setItems([])
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [url, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { items, loading, error, reload, setItems }
}
