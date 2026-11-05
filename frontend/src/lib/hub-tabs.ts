import { useMemo } from "react"
import { useSite } from "@/hooks/use-site"
import {
  ALL_TABS,
  DISCOVER_TABS,
  ME_TABS,
  routes,
  type SiteTabTargets,
} from "@/lib/routes"
import type { SectionTab } from "@/components/section-tabs"

/** 把「各源落地路径」标签组转成当前源的 SectionTabs；当前源没有的栏目不显示 */
function toSectionTabs(
  activePath: string,
  tabs: { label: string; paths: SiteTabTargets }[],
  site: string
): SectionTab[] {
  return tabs.flatMap((t) => {
    const to = t.paths[site]
    return to ? [{ to, label: t.label, active: activePath === to }] : []
  })
}

export function useDiscoverTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(
    () => toSectionTabs(activePath, DISCOVER_TABS, site),
    [site, activePath]
  )
}

export function useMeTabs(activePath: string): SectionTab[] {
  return useMemo(
    () =>
      ME_TABS.map((t) => ({
        to: t.path,
        label: t.label,
        active:
          activePath === t.path ||
          (t.path === routes.tags && activePath.startsWith(routes.tags)),
      })),
    [activePath]
  )
}

/** 目录（归档/分组）：分组仅论坛有，书库站只显示「目录」 */
export function useAllTabs(activePath: string): SectionTab[] {
  const site = useSite()
  return useMemo(
    () => toSectionTabs(activePath, ALL_TABS, site),
    [site, activePath]
  )
}
