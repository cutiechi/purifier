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
  // 惰性初始化直接读 localStorage，避免首屏 hydration 闪折叠
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    readExpanded(scope)
  )

  // scope 变化（如路由切换）时重新读取
  useEffect(() => {
    setExpanded(readExpanded(scope))
  }, [scope])

  const isExpanded = useCallback(
    (bookKey: string) => expanded.has(bookKey),
    [expanded]
  )

  const toggle = useCallback(
    (bookKey: string) => {
      // 在闭包内基于当前 expanded 计算 next，避免在 updater 里写
      // localStorage（StrictMode 会双调用 updater，副作用放里面不安全）
      const next = new Set(expanded)
      if (next.has(bookKey)) next.delete(bookKey)
      else next.add(bookKey)
      setExpanded(next)
      writeExpanded(scope, next)
    },
    [expanded, scope]
  )

  return { isExpanded, toggle }
}
