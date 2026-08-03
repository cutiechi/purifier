"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { IconMoon, IconSun } from "@/components/icons"

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-11 items-center justify-center rounded-xl transition-colors"
      aria-label="切换主题"
    >
      {mounted && resolvedTheme === "dark" ? (
        <IconSun size={18} />
      ) : (
        <IconMoon size={18} />
      )}
    </button>
  )
}
