import { useMemo } from "react"
import { cn } from "@/lib/utils"

interface BookCoverProps {
  title: string
  author?: string | null
  coverUrl?: string
  size?: "sm" | "md" | "lg"
  className?: string
}

// 基于标题稳定计算色彩
const GRADIENTS = [
  "from-amber-600/80 to-amber-900/90 text-amber-100",
  "from-emerald-600/80 to-emerald-950/90 text-emerald-100",
  "from-sky-600/80 to-sky-950/90 text-sky-100",
  "from-indigo-600/80 to-indigo-950/90 text-indigo-100",
  "from-purple-600/80 to-purple-950/90 text-purple-100",
  "from-rose-600/80 to-rose-950/90 text-rose-100",
  "from-cyan-600/80 to-blue-950/90 text-cyan-100",
  "from-orange-600/80 to-red-950/90 text-orange-100",
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function BookCover({
  title,
  coverUrl,
  size = "md",
  className,
}: BookCoverProps) {
  const cleanTitle = useMemo(() => {
    return title.replace(/【[^】]*】/g, "").replace(/\([^)]*\)/g, "").trim() || title
  }, [title])

  const initial = cleanTitle.charAt(0) || "书"

  const gradient = useMemo(() => {
    const idx = hashString(cleanTitle) % GRADIENTS.length
    return GRADIENTS[idx]
  }, [cleanTitle])

  const sizeClasses = {
    sm: "w-12 h-16 text-sm rounded-md",
    md: "w-16 h-22 text-lg rounded-lg",
    lg: "w-24 h-32 text-2xl rounded-xl",
  }[size]

  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={title}
        loading="lazy"
        className={cn(
          "shrink-0 object-cover shadow-sm transition-transform duration-200 group-hover:scale-[1.02]",
          sizeClasses,
          className
        )}
      />
    )
  }

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br p-2 font-serif font-bold shadow-sm transition-transform duration-200 select-none group-hover:scale-[1.02]",
        gradient,
        sizeClasses,
        className
      )}
    >
      {/* 书脊立体光影效果 */}
      <div className="absolute inset-y-0 left-0 w-1.5 bg-black/25" />
      <div className="absolute inset-y-0 left-1.5 w-0.5 bg-white/20" />

      {/* 封面装饰首字 */}
      <div className="self-end text-right text-xs opacity-80">网文</div>
      <div className="text-center font-bold tracking-tight">{initial}</div>
      <div className="line-clamp-1 text-[9px] font-sans font-normal opacity-75">
        {cleanTitle.slice(0, 4)}
      </div>
    </div>
  )
}
