import { useLocation, useNavigate } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import { DEFAULT_SITE, SITES, type SiteId } from "@/lib/routes"

const PERSONAL = new Set(["/history", "/favorites", "/tags"])

export function SiteSwitcher() {
  const site = useSite()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const switchTo = (next: SiteId) => {
    if (next === site) return
    if (PERSONAL.has(pathname)) {
      // 个人区：原地刷新（保留 path 与查询串，仅改 ?site=）
      const params = new URLSearchParams(search)
      if (next !== DEFAULT_SITE) params.set("site", next)
      else params.delete("site")
      navigate({ pathname, search: params.toString() })
    } else {
      // 内容页：回首页（路径语义不同）
      const params = new URLSearchParams()
      if (next !== DEFAULT_SITE) params.set("site", next)
      navigate({ pathname: "/", search: params.toString() })
    }
  }
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5">
      {(Object.keys(SITES) as SiteId[]).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => switchTo(id)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            site === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground"
          }`}
        >
          {SITES[id].label}
        </button>
      ))}
    </div>
  )
}
