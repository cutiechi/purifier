import { useCallback, useEffect, useMemo, useState } from "react"
import { Link2 } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { api } from "@/lib/routes"
import { cn } from "@/lib/utils"

export interface NavLinkItem {
  tid: string
  title: string
}

interface LinkStat {
  id: string
  title: string
  visitCount: number
  lastVisitedAt: number | null
  totalDurationS: number
  lastReadAt: number | null
}

/** 12 → "12 秒"；90 → "2 分钟"；5400 → "1.5 小时" */
function formatDuration(totalS: number): string {
  if (totalS < 60) return `${totalS} 秒`
  if (totalS < 3600) return `${Math.round(totalS / 60)} 分钟`
  return `${(totalS / 3600).toFixed(1)} 小时`
}

/** ms → "刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日" */
function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  })
}

/**
 * 正文页链接导航：浮动按钮列出正文内全部站内跳转链接（body 内链 + contentLinks，
 * 调用方去重），每条显示目标访问次数/最后打开/累计阅读时长，点击新标签打开。
 *
 * 目标页自身的 useReadingSession（时长）与 RecordVisit（计数/最后打开）负责累积，
 * 本组件只读聚合（GET /api/me/link-stats），面板每次展开时拉取。
 *
 * 位置：右列堆叠在 ItemActions 之上。ItemActions bottom = safe+1.25rem，
 * 按钮 size-11（44px = 2.75rem），加 0.75rem 间隙 → 本组件 bottom = safe+4.75rem；
 * 改动任一高度/边距需与 item-actions.tsx 一起调整。
 */
export function LinkNavFab({
  links,
  currentId,
  site,
  kind,
  hrefFor,
}: {
  links: NavLinkItem[]
  /** 当前篇 id，从列表中排除 */
  currentId: string
  site: string
  kind: "post" | "book"
  /** 站内路径构造：论坛 readPath / 书库 bookPath */
  hrefFor: (id: string) => string
}) {
  const targets = useMemo(() => {
    const seen = new Set<string>()
    const out: NavLinkItem[] = []
    for (const l of links) {
      if (!l.tid || l.tid === currentId || seen.has(l.tid)) continue
      seen.add(l.tid)
      out.push({ tid: l.tid, title: l.title.trim() })
    }
    return out
  }, [links, currentId])

  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState<Map<string, LinkStat>>(new Map())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (targets.length === 0) return
    setLoading(true)
    try {
      const ids = targets.map((t) => encodeURIComponent(t.tid))
        .join(",")
      const res = await fetch(
        `${api.meLinkStats}?kind=${kind}&site=${site}&ids=${ids}`,
      )
      if (!res.ok) return
      const json = (await res.json()) as { items?: LinkStat[] }
      const map = new Map<string, LinkStat>()
      for (const it of json.items ?? []) map.set(it.id, it)
      setStats(map)
    } catch {
      // 统计拉取失败不阻塞列表：条目仍可点击跳转
    } finally {
      setLoading(false)
    }
  }, [targets, site, kind])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void load()
  }

  // 面板开着时用户点了链接去新标签阅读，切回本页焦点/可见性变化 → 重拉统计，
  // 次数/最后打开/时长即时反映，无需关开面板。
  useEffect(() => {
    if (!open) return
    const onFocus = () => void load()
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [open, load])

  if (targets.length === 0) return null

  return (
    <div
      className="fixed right-4 z-50"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)" }}
    >
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          aria-label={`正文链接（${targets.length} 条）`}
          className="relative inline-flex size-11 items-center justify-center rounded-2xl border border-border/80 bg-card/95 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground sm:size-10"
        >
          <Link2 className="size-5 sm:size-4" />
          <span
            className="absolute top-1 right-1 rounded-full bg-primary px-1 text-[10px] leading-tight font-medium text-primary-foreground"
            aria-hidden
          >
            {targets.length}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="max-h-[min(70vh,32rem)] w-80 overflow-y-auto overscroll-contain p-2 sm:w-96"
        >
          <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
            正文链接 · {targets.length} 条
          </p>
          {loading && stats.size === 0 && (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              统计加载中…
            </p>
          )}
          <div className="flex flex-col gap-1">
            {targets.map((t) => {
              const st = stats.get(t.tid)
              const meta = st
                ? [
                    `${st.visitCount} 次`,
                    st.lastVisitedAt
                      ? formatRelative(st.lastVisitedAt)
                      : null,
                    st.totalDurationS > 0
                      ? `看过 ${formatDuration(st.totalDurationS)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "未读过"
              return (
                <button
                  key={t.tid}
                  onClick={() =>
                    window.open(hrefFor(t.tid), "_blank", "noopener,noreferrer")
                  }
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
                    "focus-visible:bg-accent focus-visible:outline-none"
                  )}
                >
                  <span className="line-clamp-2 block text-sm leading-snug">
                    {st?.title || t.title || t.tid}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {meta}
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
