import { Link } from "react-router-dom"
import { useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
import {
  IconChevronLeft,
  IconClose,
  IconMenu,
  IconSearch,
} from "@/components/icons"
import { ModeToggle } from "@/components/mode-toggle"
import { readingMaxWidthClass } from "@/components/reading-settings"
import { SiteSwitcher } from "@/components/site-switcher"
import { useSite } from "@/hooks/use-site"
import { DEFAULT_SITE, NAV_ITEMS, routes, type SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

// 导航链接带上当前站点：site=1（cool18）保持原样不追加 ?site=，其余站点追加 ?site=
function navHref(href: string, site: SiteId): string {
  if (site === DEFAULT_SITE) return href
  const params = new URLSearchParams()
  params.set("site", site)
  return `${href}?${params.toString()}`
}

export function SiteHeader({
  showBack,
  maxWidth,
}: {
  showBack?: boolean
  maxWidth?: "normal" | "wide"
}) {
  const widthClass = readingMaxWidthClass(maxWidth ?? "normal")
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const site = useSite()
  const [open, setOpen] = useState(false)
  // 按当前站点过滤 NAV（site=2 时隐藏仅论坛的入口）
  const items = NAV_ITEMS.filter((it) =>
    (it.sites as readonly SiteId[]).includes(site)
  )

  // 路由变化时收起移动端菜单（key 重置更干净，这里用 pathname 同步）
  const menuKey = pathname
  useEffect(() => {
    // 仅在 pathname 变化时关闭
    setOpen(false)
  }, [menuKey])

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div
        className={cn(
          "mx-auto flex h-14 items-center gap-1.5 px-2.5 sm:gap-2 sm:px-5",
          widthClass
        )}
      >
        {showBack ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="返回"
          >
            <IconChevronLeft size={18} />
          </button>
        ) : null}

        <Link
          to={routes.home}
          className="inline-flex h-11 shrink-0 items-center px-1.5 text-[15px] font-semibold tracking-tight text-foreground"
        >
          Purifier
        </Link>

        {/* Desktop nav — lg+ only so phone landscape keeps hamburger */}
        <nav className="ml-1 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          {items.map((item) => {
            const active = item.match(pathname)
            return (
              <Link
                key={item.href}
                to={navHref(item.href, site)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-0.5">
          <SiteSwitcher />
          <Link
            to={navHref(routes.search, site)}
            className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            aria-label="搜索"
          >
            <IconSearch size={18} />
          </Link>
          <ModeToggle />
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            aria-label={open ? "关闭菜单" : "打开菜单"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile / tablet drawer */}
      {open && (
        <nav
          className={cn(
            "mx-auto border-t border-border/60 px-3 py-3 lg:hidden",
            widthClass
          )}
        >
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {items.map((item) => {
              const active = item.match(pathname)
              return (
                <Link
                  key={item.href}
                  to={navHref(item.href, site)}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </header>
  )
}
