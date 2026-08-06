import { Settings2, Type, AlignLeft, Maximize2 } from "lucide-react"
import { useReadingSettings } from "@/components/reading-settings"
import type { ReadingFont, ReadingMaxWidth } from "@/components/reading-settings"

const FONTS: { value: ReadingFont; label: string }[] = [
  { value: "serif", label: "衬线" },
  { value: "sans", label: "无衬线" },
  { value: "mono", label: "等宽" },
]

const WIDTHS: { value: ReadingMaxWidth; label: string }[] = [
  { value: "normal", label: "标准" },
  { value: "wide", label: "宽屏" },
]

export function ReadingSettingsPanel() {
  const { settings, update } = useReadingSettings()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Type className="size-3.5" /> 字体
        </span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1"
          value={settings.font}
          onChange={(e) => update({ font: e.target.value as ReadingFont })}
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Settings2 className="size-3.5" /> 字号 {settings.fontSize}px
        </span>
        <input
          type="range"
          min={14}
          max={22}
          step={1}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <AlignLeft className="size-3.5" /> 行高 {settings.lineHeight.toFixed(1)}
        </span>
        <input
          type="range"
          min={1.4}
          max={2.2}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => update({ lineHeight: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Maximize2 className="size-3.5" /> 栏宽
        </span>
        <select
          className="rounded-md border border-border bg-background px-2 py-1"
          value={settings.maxWidth}
          onChange={(e) =>
            update({ maxWidth: e.target.value as ReadingMaxWidth })
          }
        >
          {WIDTHS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
