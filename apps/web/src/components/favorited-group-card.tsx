import { useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown } from "lucide-react"
import { IconBookOpen } from "@/components/icons"
import { SimilarSearchPanel } from "@/components/similar-search-panel"
import { SimilarTrigger } from "@/components/similar-trigger"
import { compareTid, type Group } from "@/lib/groups"
import { api, readPath } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

export function FavoritedGroupCard({
  group,
  onChanged,
}: {
  group: Group
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [showSimilar, setShowSimilar] = useState(false)
  const [busy, setBusy] = useState(false)

  async function unfavorite() {
    setBusy(true)
    try {
      const res = await fetch(`${api.meGroups}/${group.id}/favorite`, {
        method: "DELETE",
      })
      if (res.ok) onChanged()
    } catch {
      // 网络失败：静默（无用户反馈面），避免未处理的 rejection
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 shadow-sm transition-all duration-200 hover:border-border">
      <div className="flex items-center gap-2 px-3.5 py-3 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconBookOpen size={15} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
              {group.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.author ?? `共 ${group.items.length} 章`}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            共 {group.items.length} 章
          </span>
          <ChevronDown
            size={16}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void unfavorite()}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          取消收藏
        </button>
        <SimilarTrigger
          open={showSimilar}
          onToggle={() => setShowSimilar((v) => !v)}
        />
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3.5 py-3 sm:px-4">
          {/* 展示按 tid 数字升序（章节顺序），服务端存储顺序不变 */}
          {[...group.items]
            .sort((a, b) => compareTid(a.tid, b.tid))
            .map((m) => {
              const parsed = parseListTitle(m.title)
              const sub = formatTitleMeta(
                parsed.chapters ? { ...parsed, chapters: null } : parsed
              )
              return (
                <Link
                  key={m.tid}
                  to={readPath(m.tid)}
                  className="flex min-w-0 flex-col rounded-xl bg-muted/40 px-3 py-2 transition-colors hover:bg-accent/60"
                >
                  <span className="line-clamp-1 text-sm font-medium text-foreground">
                    {parsed.chapters || m.title}
                  </span>
                  {sub && (
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  )}
                </Link>
              )
            })}
          {showSimilar && (
            <SimilarSearchPanel
              title={group.title}
              groupKey={group.key}
              seedItems={group.items}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  )
}
