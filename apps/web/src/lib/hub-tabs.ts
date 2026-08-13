import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import { useSite } from "@/hooks/use-site"
import {
  ALL_TABS,
  DISCOVER_TABS,
  ME_TABS,
  siteUrl,
  type SiteId,
} from "@/lib/routes"
import type { SectionTab } from "@/components/section-tabs"

export function useDiscoverTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(() => {
    return DISCOVER_TABS.filter((t) =>
      (t.sites as readonly SiteId[]).includes(site)
    ).map((t) => ({
      to: siteUrl(t.href, site),
      label: t.label,
      active: activePath === t.href,
    }))
  }, [site, activePath])
}

export function useMeTabs(activePath: string): SectionTab[] {
  return useMemo(() => {
    return ME_TABS.map((t) => ({
      to: t.href,
      label: t.label,
      active:
        activePath === t.href ||
        (t.href === "/tags" && activePath.startsWith("/tags")),
    }))
  }, [activePath])
}

/** 目录（归档/分组）：按站过滤；书库站无分组，只显示「目录」 */
export function useAllTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(
    () =>
      ALL_TABS.filter((t) =>
        (t.sites as readonly SiteId[]).includes(site)
      ).map((t) => ({
        // 评审问题 5：不带 site 时书库站点 Tab 会丢参数
        to: siteUrl(t.href, site),
        label: t.label,
        active: activePath === t.href,
      })),
    [site, activePath]
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
