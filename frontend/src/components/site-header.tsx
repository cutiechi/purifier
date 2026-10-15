import { Link } from "react-router-dom"
import { useLocation, useNavigate } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import {
  IconChevronLeft,
  IconClose,
  IconMenu,
  IconSearch,
} from "@/components/icons"
import { ModeToggle } from "@/components/mode-toggle"
import { useSite } from "@/hooks/use-site"
import { useAuth } from "@/lib/auth"
import {
  FORUM_NAV_ITEMS,
  NOVEL_NAV_ITEMS,
  routes,
} from "@/lib/routes"
import { cn } from "@/lib/utils"

export function SiteHeader({ showBack }: { showBack?: boolean }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const site = useSite()
  const { enabled, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  // 频道判断：路径为 novel 或 book 或 site=2 时进入小说书库模式
  const isNovel =
    pathname === routes.novel ||
    pathname.startsWith("/novel") ||
    pathname.startsWith("/book") ||
    site === "2" ||
    search.includes("site=2")

  const currentChannel = isNovel ? "novel" : "forum"
  const items = isNovel ? NOVEL_NAV_ITEMS : FORUM_NAV_ITEMS

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // 点击外部关闭折叠菜单
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (
        t instanceof Node &&
        (menuRef.current?.contains(t) || toggleRef.current?.contains(t))
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
      >
        跳到正文
      </a>
      <div className="flex h-14 items-center gap-2 px-2.5 sm:gap-3 sm:px-5">
        {showBack ? (
          <button
            type="button"
            onClick={() => {
              if (window.history.state?.idx === 0) navigate(routes.home)
              else navigate(-1)
            }}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="返回"
          >
            <IconChevronLeft size={18} />
          </button>
        ) : null}

        <Link
          to={isNovel ? routes.novel : routes.home}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-accent"
          aria-label="Purifier 首页"
        >
          <img
            src="/logo.png"
            alt="Purifier"
            width={28}
            height={28}
            className="size-7 object-contain"
          />
        </Link>

        {/* 顶级频道切换 Segmented Pill (论坛 vs 书库) */}
        <div className="flex items-center rounded-xl bg-muted/60 p-0.5 text-xs font-medium">
          <Link
            to={routes.home}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition-all select-none",
              currentChannel === "forum"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            论坛
          </Link>
          <Link
            to={routes.novel}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition-all select-none",
              currentChannel === "novel"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            书库
          </Link>
        </div>

        {/* 频道专属导航项（桌面端） */}
        <nav className="ml-1 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          {items.map((item) => {
            const active = item.match(pathname)
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center rounded-lg px-2.5 text-[13px] font-medium transition-colors",
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

        <div className="ml-auto flex items-center gap-1">
          <Link
            to={isNovel ? routes.search + "?site=2" : routes.search}
            className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            aria-label="搜索"
          >
            <IconSearch size={18} />
          </Link>

          {enabled && user ? (
            <>
              <span className="hidden max-w-40 truncate px-2 text-[13px] text-muted-foreground sm:inline">
                {user.name || user.email || user.sub?.slice(0, 8)}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex h-10 items-center justify-center rounded-xl px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                退出
              </button>
            </>
          ) : null}

          <ModeToggle />

          <button
            type="button"
            ref={toggleRef}
            className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            aria-label={open ? "关闭菜单" : "打开菜单"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      {/* 移动端折叠菜单 */}
      {open && (
        <nav
          ref={menuRef}
          className="relative z-50 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur-md md:hidden"
        >
          <div className="grid grid-cols-2 gap-1.5 pb-1 sm:grid-cols-4">
            {items.map((item) => {
              const active = item.match(pathname)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "inline-flex h-10 items-center justify-center rounded-xl px-3.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground font-semibold"
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
