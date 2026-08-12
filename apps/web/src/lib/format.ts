import type { CSSProperties } from "react"

export function formatCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  }
  if (n >= 10_000) {
    return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}万`
  }
  return n.toLocaleString()
}

export function hashHue(seed: string): number {
  const hues = [210, 250, 280, 330, 20, 160, 190]
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  return hues[Math.abs(hash) % hues.length] ?? 210
}

export function avatarStyle(seed: string): CSSProperties {
  const hue = hashHue(seed)
  return {
    background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 50% 32%))`,
  }
}

export function initials(title: string): string {
  return title.trim().slice(0, 1) || "#"
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0m"
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h > 0) return `${h}h ${mm}m`
  if (m > 0) return `${m}m ${Math.floor(s % 60)}s`
  return `${Math.floor(s)}s`
}
