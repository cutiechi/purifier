import { Type, Settings2, AlignLeft, Maximize2, RotateCcw } from "lucide-react"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  useReadingSettings,
  DEFAULT_READING_SETTINGS,
  type ReadingFont,
  type ReadingMaxWidth,
} from "@/components/reading-settings"

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
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium text-muted-foreground">阅读偏好</div>

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Type className="size-3.5" /> 字体
        </span>
        <SegmentedControl
          aria-label="字体"
          options={FONTS}
          value={settings.font}
          onChange={(font) => update({ font })}
        />
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Settings2 className="size-3.5" /> 字号
          <span className="tabular-nums text-foreground">{settings.fontSize}px</span>
        </span>
        <input
          type="range"
          className="reading-range"
          min={14}
          max={22}
          step={1}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <AlignLeft className="size-3.5" /> 行高
          <span className="tabular-nums text-foreground">
            {settings.lineHeight.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          className="reading-range"
          min={1.4}
          max={2.2}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => update({ lineHeight: Number(e.target.value) })}
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Maximize2 className="size-3.5" /> 栏宽
        </span>
        <SegmentedControl
          aria-label="栏宽"
          options={WIDTHS}
          value={settings.maxWidth}
          onChange={(maxWidth) => update({ maxWidth })}
        />
      </div>

      <button
        type="button"
        onClick={() => update(DEFAULT_READING_SETTINGS)}
        className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1">
          <RotateCcw className="size-3" /> 恢复默认
        </span>
      </button>
    </div>
  )
}
