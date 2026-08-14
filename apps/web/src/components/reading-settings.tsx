import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

export type ReadingFont = "serif" | "sans" | "mono"
export type ReadingMaxWidth = "normal" | "wide"

export interface ReadingSettings {
  font: ReadingFont
  fontSize: number
  lineHeight: number
  maxWidth: ReadingMaxWidth
}

export interface ReadingSettingsContextValue {
  settings: ReadingSettings
  update: (patch: Partial<ReadingSettings>) => void
}

const STORAGE_KEY = "purifier:reading"
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  font: "serif",
  fontSize: 17,
  lineHeight: 1.8,
  maxWidth: "normal",
}

const ReadingSettingsContext = createContext<ReadingSettingsContextValue | null>(
  null
)

const FONT_VALUES: ReadingFont[] = ["serif", "sans", "mono"]
const MAXWIDTH_VALUES: ReadingMaxWidth[] = ["normal", "wide"]

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fallback
}

function loadSettings(): ReadingSettings {
  if (typeof localStorage === "undefined") return DEFAULT_READING_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_READING_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ReadingSettings>
    return {
      font: FONT_VALUES.includes(parsed.font as ReadingFont)
        ? (parsed.font as ReadingFont)
        : DEFAULT_READING_SETTINGS.font,
      fontSize: clampNumber(parsed.fontSize, 14, 22, DEFAULT_READING_SETTINGS.fontSize),
      lineHeight: clampNumber(parsed.lineHeight, 1.4, 2.2, DEFAULT_READING_SETTINGS.lineHeight),
      maxWidth: MAXWIDTH_VALUES.includes(parsed.maxWidth as ReadingMaxWidth)
        ? (parsed.maxWidth as ReadingMaxWidth)
        : DEFAULT_READING_SETTINGS.maxWidth,
    }
  } catch {
    return DEFAULT_READING_SETTINGS
  }
}

const FONT_VAR: Record<ReadingFont, string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
}

/** 页面栏宽（含宽屏档）；与阅读偏好 ReadingMaxWidth 分离，不进存储/面板 */
export type PageWidth = "normal" | "wide" | "xwide"

const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
  normal: "max-w-3xl",
  wide: "max-w-4xl",
  xwide: "max-w-5xl",
}

export function ReadingSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ReadingSettings>(loadSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // 存储失败（隐私模式/配额）静默：内存值仍生效
    }
  }, [settings])

  // 将设置映射成 CSS 变量挂到 <html>，供 .reading-body 消费
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--reading-font", FONT_VAR[settings.font])
    root.style.setProperty(
      "--reading-font-size",
      `${settings.fontSize}px`
    )
    root.style.setProperty(
      "--reading-line-height",
      String(settings.lineHeight)
    )
    root.dataset.readingMaxWidth = settings.maxWidth
  }, [settings])

  const value = useMemo<ReadingSettingsContextValue>(
    () => ({
      settings,
      update: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    }),
    [settings]
  )

  return (
    <ReadingSettingsContext.Provider value={value}>
      {children}
    </ReadingSettingsContext.Provider>
  )
}

export function useReadingSettings(): ReadingSettingsContextValue {
  const ctx = useContext(ReadingSettingsContext)
  if (!ctx) {
    throw new Error("useReadingSettings must be used within ReadingSettingsProvider")
  }
  return ctx
}

export function pageWidthClass(maxWidth: PageWidth): string {
  return PAGE_WIDTH_CLASS[maxWidth]
}
