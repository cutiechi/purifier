import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { DEFAULT_SITE, type SiteId } from "@/lib/routes"

export function useSite(): SiteId {
  const [params] = useSearchParams()
  const s = params.get("site") ?? DEFAULT_SITE
  return s === "2" ? "2" : "1" // 只认 1/2，其余归 1
}

/** 仅改当前 URL 的 ?site=，不跳转路径（页内站点 Tab 用） */
export function useSetSite(): (next: SiteId) => void {
  const [params, setParams] = useSearchParams()
  return useCallback(
    (next: SiteId) => {
      const p = new URLSearchParams(params)
      if (next === DEFAULT_SITE) p.delete("site")
      else p.set("site", next)
      setParams(p, { replace: true })
    },
    [params, setParams]
  )
}
