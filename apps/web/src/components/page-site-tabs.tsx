import { useSite, useSetSite } from "@/hooks/use-site"
import { SITES, type SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 页内站点切换。顶栏不再放站点开关。
 * - sites 多站：显示对应 Tab
 * - 仅一站：默认仍显示一个 Tab（可 hideWhenSingle 隐藏）
 */
export function PageSiteTabs({
  sites = ["1", "2"] as SiteId[],
  hideWhenSingle = false,
  className,
}: {
  sites?: readonly SiteId[]
  hideWhenSingle?: boolean
  className?: string
}) {
  const site = useSite()
  const setSite = useSetSite()
  const list = (Object.keys(SITES) as SiteId[]).filter((id) =>
    sites.includes(id)
  )
  if (list.length === 0) return null
  if (list.length === 1 && hideWhenSingle) return null

  // 当前 site 不在本页可用列表时，点 Tab 会切过去；高亮仍跟 URL
  return (
    <div
      className={cn(
        "mb-4 flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1",
        className
      )}
      role="tablist"
      aria-label="站点"
    >
      {list.map((id) => {
        const active = site === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setSite(id)}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {SITES[id].label}
          </button>
        )
      })}
    </div>
  )
}
