import { IconClose } from "@/components/icons"
import type { CharacterName } from "@workspace/core/character-highlight"
import { colorSlot } from "@workspace/core/character-highlight"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 人物面板（Settings Popover 内「人物」section）：
 * 高亮总开关 + 名单（色点 + 名 + 删除）+ 空态引导 + 错误重试。
 */
export function CharacterPanel({
  characters,
  enabled,
  setEnabled,
  onRemove,
  error,
  onRetry,
}: {
  characters: CharacterName[]
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  onRemove: (name: string) => void
  error: string
  onRetry: () => void
}) {
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
      ) : characters.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          还没有人物。在正文中选中人名即可标记，全文同名会按颜色高亮。
        </p>
      ) : (
        <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-0.5">
          {characters.map((c) => (
            <li key={c.name} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  `character-mark--${colorSlot(c.colorIndex)}`
                )}
                style={{ background: "var(--character-mark-bg)" }}
              />
              <span
                className="min-w-0 flex-1 truncate text-sm text-foreground"
                title={c.name}
              >
                {c.name}
              </span>
              <button
                type="button"
                aria-label={`删除人物 ${c.name}`}
                onClick={() => onRemove(c.name)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <IconClose size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
