import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import {
  ALL_TABS,
  DEFAULT_SITE,
  DISCOVER_TABS,
  ME_TABS,
  type SiteId,
} from "@/lib/routes"
import type { SectionTab } from "@/components/section-tabs"

function withSite(href: string, site: SiteId): string {
  if (site === DEFAULT_SITE) return href
  const p = new URLSearchParams()
  p.set("site", site)
  return `${href}?${p.toString()}`
}

export function useDiscoverTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(() => {
    return DISCOVER_TABS.filter((t) =>
      (t.sites as readonly SiteId[]).includes(site)
    ).map((t) => ({
      to: withSite(t.href, site),
      label: t.label,
      active: activePath === t.href,
    }))
  }, [site, activePath])
}

export function useMeTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(() => {
    return ME_TABS.filter((t) =>
      (t.sites as readonly SiteId[]).includes(site)
    ).map((t) => ({
      to: withSite(t.href, site),
      label: t.label,
      active:
        activePath === t.href ||
        (t.href === "/tags" && activePath.startsWith("/tags")),
    }))
  }, [site, activePath])
}

/** 目录（归档/分组），固定论坛站 */
export function useAllTabs(activePath: string): SectionTab[] {
  return useMemo(
    () =>
      ALL_TABS.map((t) => ({
        to: t.href,
        label: t.label,
        active: activePath === t.href,
      })),
    [activePath]
  )
}

/** 发现默认落地：论坛→精华，书库→人气 */
export function discoverDefaultPath(site: SiteId): string {
  return site === "2" ? "/trending" : "/featured"
}

export function meDefaultPath(site: SiteId): string {
  void site
  return "/history"
}

export function usePreservedSearch(): string {
  const { search } = useLocation()
  return search
}
