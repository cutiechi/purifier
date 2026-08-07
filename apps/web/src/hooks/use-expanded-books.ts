import { useCallback, useEffect, useState } from "react"

const PREFIX = "purifier:expanded-books:"

function storageKey(scope: string): string {
  return `${PREFIX}${scope}`
}

function readExpanded(scope: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? new Set(arr.filter((x) => typeof x === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

function writeExpanded(scope: string, set: Set<string>) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify([...set]))
  } catch {
    // 隐私模式/配额：静默，内存态仍可切换
  }
}

export function useExpandedBooks(scope: string): {
  isExpanded: (bookKey: string) => boolean
  toggle: (bookKey: string) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // 首屏渲染前 localStorage 未读 → 默认全折叠；mount 后 hydrate
  useEffect(() => {
    setExpanded(readExpanded(scope))
  }, [scope])

  const isExpanded = useCallback(
    (bookKey: string) => expanded.has(bookKey),
    [expanded]
  )

  const toggle = useCallback(
    (bookKey: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(bookKey)) next.delete(bookKey)
        else next.add(bookKey)
        writeExpanded(scope, next)
        return next
      })
    },
    [scope]
  )

  return { isExpanded, toggle }
}
