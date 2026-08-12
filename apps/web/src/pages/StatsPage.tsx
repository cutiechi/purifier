import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader, SectionLabel } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { StatsHeatmap } from "@/components/stats-heatmap"
import { AsyncBody } from "@/components/ui-state"
import { api, bookPath, readPath, type SiteId } from "@/lib/routes"
import { formatDateTime, formatDuration } from "@/lib/format"
import { cn } from "@workspace/ui/lib/utils"

type StatsResult = {
  summary: {
    totalDurationS: number
    currentStreak: number
    longestStreak: number
    activeDays: number
    thisWeekS: number
    thisMonthS: number
    trackedSince: number | null
    lastActiveAt: number | null
  }
  calendar: { date: string; durationS: number; estimated: number }[]
  timeOfDay: number[]
  topItems: {
    kind: "post" | "book"
    site: SiteId
    id: string
    title: string
    durationS: number
    sessions: number
  }[]
  recentSessions: {
    startedAt: number
    durationS: number
    kind: "post" | "book"
    site: SiteId
    id: string
    title: string
  }[]
  inventory: {
    history: number
    favorites: number
    tags: number
    groups: number
    characters: number
  }
}

type Scope = "all" | SiteId
const SCOPE_TABS: { key: Scope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "1", label: "论坛" },
  { key: "2", label: "书库" },
]

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 px-4 py-3.5">
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export default function StatsPage() {
  const [scope, setScope] = useState<Scope>("all")
  const [data, setData] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    const url = scope === "all" ? api.meStats : `${api.meStats}?site=${scope}`
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error("请求失败")
        const json = (await r.json()) as StatsResult
        if (!cancelled) setData(json)
      })
      .catch((e) => !cancelled && setError(e?.message ?? "请求失败"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [scope, reloadKey])

  const hasSessions = !!data && (data.summary.trackedSince !== null)
  const maxHour = data ? Math.max(1, ...data.timeOfDay) : 1

  return (
    <PageShell>
      <PageHeader title="统计" description="阅读时长 · 连读 · 时段" />
      <div
        className="mb-4 flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1"
        role="tablist"
        aria-label="站点"
      >
        {SCOPE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={scope === t.key}
            onClick={() => setScope(t.key)}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              scope === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AsyncBody
        loading={loading}
        error={error}
        empty={!hasSessions}
        emptyText="还没有阅读记录，读几篇再来看看吧"
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        {data && (
          <div className="space-y-8">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard value={formatDuration(data.summary.totalDurationS)} label="累计时长" />
              <StatCard value={String(data.summary.currentStreak)} label="当前连读(天)" />
              <StatCard value={String(data.summary.longestStreak)} label="最长连读(天)" />
              <StatCard value={String(data.summary.activeDays)} label="活跃天数" />
              <StatCard value={formatDuration(data.summary.thisWeekS)} label="本周时长" />
              <StatCard value={formatDuration(data.summary.thisMonthS)} label="本月时长" />
              {data.summary.trackedSince != null && (
                <StatCard
                  value={formatDateTime(data.summary.trackedSince)}
                  label="记录始于"
                />
              )}
            </section>

            <section>
              <SectionLabel>每日热力图（近一年）</SectionLabel>
              <StatsHeatmap days={data.calendar} />
            </section>

            <section>
              <SectionLabel>阅读时段分布</SectionLabel>
              <div className="flex h-32 items-end gap-1">
                {data.timeOfDay.map((s, h) => (
                  <div
                    key={h}
                    title={`${h}:00 · ${formatDuration(s)}`}
                    className="flex-1 rounded-t bg-primary/70"
                    style={{ height: `${(s / maxHour) * 100}%`, minHeight: s > 0 ? 2 : 0 }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
              </div>
            </section>

            <section className="grid gap-8 lg:grid-cols-2">
              <div>
                <SectionLabel>时长 TOP</SectionLabel>
                {data.topItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无</p>
                ) : (
                  <ul className="space-y-2">
                    {data.topItems.map((t) => {
                      const href =
                        t.kind === "post" ? readPath(t.id, t.site) : bookPath(t.id, { site: t.site })
                      return (
                        <li key={`${t.site}:${t.kind}:${t.id}`}>
                          <Link to={href} className="block">
                            <div className="flex items-center justify-between gap-3">
                              <span className="line-clamp-1 text-sm text-foreground">{t.title}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatDuration(t.durationS)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-muted">
                              <div
                                className="h-full rounded bg-primary/70"
                                style={{
                                  width: `${(t.durationS / data.topItems[0].durationS) * 100}%`,
                                }}
                              />
                            </div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <div>
                <SectionLabel>最近阅读</SectionLabel>
                {data.recentSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.recentSessions.map((r, i) => {
                      const href =
                        r.kind === "post" ? readPath(r.id, r.site) : bookPath(r.id, { site: r.site })
                      return (
                        <li key={i}>
                          <Link to={href} className="flex items-center justify-between gap-3 text-sm">
                            <span className="line-clamp-1 text-foreground">{r.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateTime(r.startedAt)} · {formatDuration(r.durationS)}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <SectionLabel>库存</SectionLabel>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard value={String(data.inventory.history)} label="历史" />
                <StatCard value={String(data.inventory.favorites)} label="收藏" />
                <StatCard value={String(data.inventory.tags)} label="标签" />
                <StatCard value={String(data.inventory.groups)} label="分组" />
                <StatCard value={String(data.inventory.characters)} label="角色" />
              </div>
            </section>
          </div>
        )}
      </AsyncBody>
    </PageShell>
  )
}
