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
 */
export function useAsyncList<T>(
  url: string,
  pick: (json: Record<string, unknown>) => T[]
) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const pickRef = useRef(pick)
  pickRef.current = pick

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const next = await fetchJsonList(url, (json) => pickRef.current(json))
      setItems(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void reload()
  }, [reload])

  return { items, loading, error, reload, setItems }
}
