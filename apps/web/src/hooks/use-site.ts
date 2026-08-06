import { useSearchParams } from "react-router-dom"
import { DEFAULT_SITE, type SiteId } from "@/lib/routes"

export function useSite(): SiteId {
  const [params] = useSearchParams()
  const s = params.get("site") ?? DEFAULT_SITE
  return s === "2" ? "2" : "1" // 只认 1/2，其余归 1
}
