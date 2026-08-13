import { useEffect, useRef, useState } from "react"
import { IconClose } from "@/components/icons"
import type { CharacterCluster } from "@workspace/core/character-highlight"
import { clampHue } from "@workspace/core/character-highlight"
import { CharacterSwatch } from "@/components/character-swatch"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 人物面板（Settings Popover 内「人物」section）：
 * 高亮总开关 + 组列表（色点可改色、称呼可删除/拆出、组可合并）+ 空态引导 +
 * 错误重试 + 增删失败提示（无重试按钮，用户重新操作即可）。
 * recolor 拖动时 200ms debounce 提交；merge 确认后清空 mergeFrom，避免
 * 父组件换新 clusters 后仍持有已消失的 cluster id。
 */
export function CharacterPanel({
  clusters,
  enabled,
  setEnabled,
  onRemove,
  onSplit,
  onMerge,
  onRecolor,
  error,
  onRetry,
  mutationError,
}: {
  clusters: CharacterCluster[]
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  onRemove: (name: string) => void
  onSplit: (clusterId: number, name: string) => void
  onMerge: (clusterIds: number[], hue: number) => void
  onRecolor: (clusterId: number, hue: number) => void
  error: string
  onRetry: () => void
  /** PUT/DELETE/PATCH 失败提示（本地名单已回滚/不变，直接展示） */
  mutationError?: string
}) {
  const [recolorId, setRecolorId] = useState<number | null>(null)
  const [draftHue, setDraftHue] = useState(85)
  const [mergeFrom, setMergeFrom] = useState<number | null>(null)
  const [mergeOther, setMergeOther] = useState<number | null>(null)
  const [mergeHue, setMergeHue] = useState(85)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清掉未提交的 recolor debounce
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const commitHue = (id: number, hue: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onRecolor(id, hue), 200)
  }

  const toggleRecolor = (c: CharacterCluster) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (recolorId === c.id) {
      setRecolorId(null)
      return
    }
    setDraftHue(c.hue)
    setRecolorId(c.id)
  }

  const pickMergeFrom = (id: number) => {
    if (mergeFrom === id) {
      setMergeFrom(null)
      setMergeOther(null)
      return
    }
    setMergeFrom(id)
    setMergeOther(null)
    const c = clusters.find((x) => x.id === id)
    if (c) setMergeHue(c.hue)
  }

  const confirmMerge = () => {
    if (mergeFrom === null || mergeOther === null) return
    onMerge([mergeFrom, mergeOther], mergeHue)
    setMergeFrom(null)
    setMergeOther(null)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">人物</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          显示人物高亮
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="显示人物高亮"
            onClick={() => setEnabled(!enabled)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              enabled ? "bg-foreground/70" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "inline-block size-3.5 rounded-full bg-background shadow transition-transform",
                enabled ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </button>
        </span>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-destructive/8 px-2.5 py-2 text-xs text-destructive">
          <span className="leading-relaxed">{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md bg-destructive/12 px-2 py-1 font-medium transition-colors hover:bg-destructive/20"
          >
            重试
          </button>
        </div>
      ) : (
        <>
          {mutationError && (
            <div className="rounded-lg bg-destructive/8 px-2.5 py-2 text-xs text-destructive">
              <span className="leading-relaxed">{mutationError}</span>
            </div>
          )}
          {clusters.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              还没有人物。在正文中选中人名即可标记；也可把多个称呼并成同一人，颜色会一致。
            </p>
          ) : (
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-0.5">
              {clusters.map((c) => (
                <li key={c.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`改色 ${c.names[0] ?? ""}`}
                      title="改色"
                      onClick={() => toggleRecolor(c)}
                      className="shrink-0 rounded-full transition-opacity hover:opacity-80"
                    >
                      <CharacterSwatch hue={c.hue} />
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {c.names.map((n) => (
                        <div key={n} className="flex items-center gap-1">
                          <span
                            className="min-w-0 flex-1 truncate text-sm text-foreground"
                            title={n}
                          >
                            {n}
                          </span>
                          {c.names.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onSplit(c.id, n)}
                              className="shrink-0 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              拆出
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`删除人物 ${n}`}
                            onClick={() => onRemove(n)}
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                          >
                            <IconClose size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => pickMergeFrom(c.id)}
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-1 text-xs transition-colors",
                        mergeFrom === c.id
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {mergeFrom === c.id ? "取消合并" : "与其他人合并"}
                    </button>
                  </div>

                  {recolorId === c.id && (
                    <div className="flex items-center gap-2 pl-[18px]">
                      <input
                        type="range"
                        min={0}
                        max={359}
                        className="reading-range h-1.5 flex-1"
                        aria-label={`改色 ${c.names[0] ?? ""}`}
                        value={draftHue}
                        onChange={(e) => {
                          const h = Number(e.target.value)
                          setDraftHue(h)
                          commitHue(c.id, h)
                        }}
                      />
                      <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                        {draftHue}
                      </span>
                    </div>
                  )}

                  {mergeFrom === c.id && (
                    <div className="flex flex-col gap-1 pl-[18px]">
                      {clusters
                        .filter((x) => x.id !== c.id)
                        .map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            onClick={() => {
                              setMergeOther(x.id)
                              setMergeHue(c.hue)
                            }}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                              mergeOther === x.id
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}
                          >
                            <CharacterSwatch hue={x.hue} />
                            <span className="min-w-0 flex-1 truncate">
                              {x.names.join(" / ")}
                            </span>
                            并入
                          </button>
                        ))}
                    </div>
                  )}

                  {mergeFrom === c.id && mergeOther !== null && (
                    <div className="flex flex-col gap-1.5 pl-[18px]">
                      <div className="flex items-center gap-2">
                        <CharacterSwatch hue={clampHue(mergeHue)} className="size-3.5" />
                        <input
                          type="range"
                          min={0}
                          max={359}
                          className="reading-range h-1.5 flex-1"
                          aria-label="合并后颜色"
                          value={mergeHue}
                          onChange={(e) => setMergeHue(Number(e.target.value))}
                        />
                        <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          {mergeHue}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={confirmMerge}
                        className="self-start rounded-md bg-foreground/70 px-2.5 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground"
                      >
                        合并
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
