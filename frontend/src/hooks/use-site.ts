import { useLocation, useSearchParams } from "react-router-dom"
import type { SiteId } from "@/lib/routes"

/**
 * 站点身份由路径前缀表达：`/xbook-cn/*` → 书库，其余 → 论坛。
 * 无前缀的跨站页（我的/*）保留可选 `?site=` 过滤。
 */
export function useSite(): SiteId {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  if (pathname.startsWith("/xbook-cn")) return "2"
  const s = params.get("site")
  return s === "2" ? "2" : "1"
}
