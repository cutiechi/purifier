import { useEffect, useRef, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { formatDuration } from "@/lib/format"

type Day = { date: string; durationS: number; estimated: number }

function level(s: number): number {
  if (s <= 0) return 0
  if (s < 300) return 1
  if (s < 1200) return 2
  if (s < 3600) return 3
  return 4
}
const LEVEL_BG = [
  "bg-muted/60",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
]
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`

/**
 * 近 365 天 GitHub 式热力图：列=周、行=周日…周六。先按首日 weekday 补 null 对齐到
 * 周日，再每 7 个切一列。空日也画（durationS=0）。
 */
export function StatsHeatmap({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<Day | null>(null)
  const [selected, setSelected] = useState<Day | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const all: Day[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date(todayMid)
    d.setDate(d.getDate() - i)
    const key = keyOf(d)
    all.push(byDate.get(key) ?? { date: key, durationS: 0, estimated: 0 })
  }
  // 对齐到周日（getDay 周日=0）：首日之前补 null，使每列同 weekday
  const pad = all.length ? new Date(all[0].date + "T00:00:00").getDay() : 0
  const flat: (Day | null)[] = [...Array(pad).fill(null), ...all]
  const weeks: (Day | null)[][] = []
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7))
  // 挂载/周数变化时滚到最近一周（365 天从最旧画起，最新在右端）
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [weeks.length])
  // selected 优先，hover 仅桌面预览
  const shown = selected ?? hover
  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={scrollRef}
        className="flex gap-[3px] overflow-x-auto"
        role="group"
        aria-label="近一年阅读热力图，左右方向键切换所选日期"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
          e.preventDefault()
          const base = shown?.date ?? keyOf(todayMid)
          const d = new Date(base + "T00:00:00")
          d.setDate(d.getDate() + (e.key === "ArrowRight" ? 1 : -1))
          const nextKey = keyOf(d)
          setSelected(
            byDate.get(nextKey) ?? { date: nextKey, durationS: 0, estimated: 0 }
          )
        }}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }).map((_, di) => {
              const c = week[di] ?? null
              if (!c) return <div key={di} className="h-2.5 w-2.5" />
              return (
                <div
                  key={c.date}
                  title={`${c.date} · ${formatDuration(c.durationS)}`}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSelected(c)}
                  className={cn(
                    "h-2.5 w-2.5 rounded-[2px]",
                    LEVEL_BG[level(c.durationS)],
                    c.estimated === 1 && "ring-1 ring-inset ring-amber-400/70"
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
      {shown && (
        <p className="text-xs text-muted-foreground">
          {shown.date} · {formatDuration(shown.durationS)}
          {shown.estimated === 1 ? "（历史活跃日，无时长）" : ""}
        </p>
      )}
    </div>
  )
}
