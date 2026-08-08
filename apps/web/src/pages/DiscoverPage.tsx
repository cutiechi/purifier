import { Navigate } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import { discoverDefaultPath } from "@/lib/hub-tabs"
import { DEFAULT_SITE } from "@/lib/routes"

/** /discover → 当前站默认栏目 */
export default function DiscoverPage() {
  const site = useSite()
  const path = discoverDefaultPath(site)
  const qs =
    site === DEFAULT_SITE ? "" : `?site=${site}`
  return <Navigate to={`${path}${qs}`} replace />
}
