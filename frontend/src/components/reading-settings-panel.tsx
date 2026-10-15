import { Type, Settings2, AlignLeft, Maximize2, RotateCcw } from "lucide-react"
import {
  useReadingSettings,
  DEFAULT_READING_SETTINGS,
  type ReadingFont,
  type ReadingMaxWidth,
} from "@/components/reading-settings"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"

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
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Type className="size-3.5" /> 字体
        </span>
        <Tabs
          value={settings.font}
          onValueChange={(val) => update({ font: val as ReadingFont })}
        >
          <TabsList className="h-7">
            {FONTS.map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className="h-5 px-2 text-[11px]"
              >
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Settings2 className="size-3.5" /> 字号
          <span className="text-foreground tabular-nums">
            {settings.fontSize}px
          </span>
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

      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <AlignLeft className="size-3.5" /> 行高
          <span className="text-foreground tabular-nums">
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
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Maximize2 className="size-3.5" /> 栏宽
        </span>
        <Tabs
          value={settings.maxWidth}
          onValueChange={(val) => update({ maxWidth: val as ReadingMaxWidth })}
        >
          <TabsList className="h-7">
            {WIDTHS.map((w) => (
              <TabsTrigger
                key={w.value}
                value={w.value}
                className="h-5 px-2 text-[11px]"
              >
                {w.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => update(DEFAULT_READING_SETTINGS)}
        className="h-7 self-start px-2 text-xs text-muted-foreground"
      >
        <RotateCcw className="mr-1 size-3" /> 恢复默认
      </Button>
    </div>
  )
}
