export function ReadingProgress({
  progress,
  bottomOffset = 0,
}: {
  progress: number
  bottomOffset?: number
}) {
  const clamped = Math.max(0, Math.min(1, progress))
  const barBottom = `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px))`
  const pctBottom = `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px) + 0.4rem)`
  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-0.5 bg-transparent"
        style={{ bottom: barBottom }}
        aria-hidden
      >
        <div
          className="h-full bg-foreground/30"
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span
        className="pointer-events-none fixed right-2 z-30 text-[10px] leading-none text-muted-foreground/80 tabular-nums"
        style={{ bottom: pctBottom }}
        aria-hidden
      >
        {Math.round(clamped * 100)}%
      </span>
    </>
  )
}
