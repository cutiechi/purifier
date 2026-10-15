import { Navigate } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import { meDefaultPath } from "@/lib/hub-tabs"
import { DEFAULT_SITE } from "@/lib/routes"

/** /me → 历史 */
export default function MePage() {
  const site = useSite()
  const path = meDefaultPath(site)
  const qs = site === DEFAULT_SITE ? "" : `?site=${site}`
  return <Navigate to={`${path}${qs}`} replace />
}
