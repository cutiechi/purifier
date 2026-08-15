import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { startJob, type ArchiveMode, type ArchiveStatus } from "@/lib/jobs"
import type { SiteId } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

type JobKind = "archive_posts" | "archive_books" | "archive_auto_group"

const KINDS: { value: JobKind; label: string; desc: string }[] = [
  {
    value: "archive_posts",
    label: "论坛归档",
    desc: "同步论坛主帖目录到本地",
  },
  { value: "archive_books", label: "书库归档", desc: "同步书库收录到本地" },
  {
    value: "archive_auto_group",
    label: "自动分组",
    desc: "按书名把多章帖子归入分组",
  },
]

const MODES: { value: ArchiveMode; label: string; desc: string }[] = [
  { value: "incremental", label: "增量", desc: "只补比库内新的内容（日常）" },
  { value: "full", label: "全量", desc: "从头扫全站，可能要一个多小时" },
  { value: "resume", label: "续跑", desc: "从上次中断处接着扫" },
]

/** 游标可续：next_mtid 存在且 status !== done（全站唯一判定，UI 不展示游标值） */
function cursorResumable(s: ArchiveStatus | null): boolean {
  return !!s?.cursor?.next_mtid && s.cursor.status !== "done"
}

export function CreateJobModal({
  open,
  onClose,
  statuses,
  hasActive,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  statuses: Record<SiteId, ArchiveStatus | null>
  hasActive: boolean
  onStarted: () => void
}) {
  const confirm = useConfirm()
  const [step, setStep] = useState<1 | 2>(1)
  const [kind, setKind] = useState<JobKind>("archive_posts")
  const [mode, setMode] = useState<ArchiveMode>("incremental")
  const [minMembers, setMinMembers] = useState(2)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // 聚焦对话框内首个可聚焦控件（与 ConfirmDialog 同一套焦点管理）
  const focusFirst = useCallback(() => {
    const el = dialogRef.current
    if (!el) return
    const first = el.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
  }, [])

  // 关闭前把焦点还给打开前的元素（与 ConfirmDialog 的 finish 一致）
  const close = useCallback(() => {
    const prev = prevFocusRef.current
    prevFocusRef.current = null
    if (prev && document.contains(prev)) prev.focus()
    onClose()
  }, [onClose])

  useEffect(() => {
    if (open) {
      setStep(1)
      setMode("incremental")
      setError("")
    }
  }, [open])

  // 打开时记录焦点来源并聚焦首个控件
  useEffect(() => {
    if (!open) return
    prevFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const t = requestAnimationFrame(() => focusFirst())
    return () => cancelAnimationFrame(t)
  }, [open, focusFirst])

  // 步骤切换后把焦点移入新步骤的首个控件
  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => focusFirst())
    return () => cancelAnimationFrame(t)
  }, [open, step, focusFirst])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // ConfirmDialog 的 document 监听先触发并 preventDefault，此时不重复关闭
      if (e.key === "Escape" && !e.defaultPrevented) close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  if (!open) return null

  const isAutoGroup = kind === "archive_auto_group"
  const site: SiteId = kind === "archive_books" ? "2" : "1"
  const resumable = cursorResumable(statuses[site])

  const submit = async () => {
    if (hasActive) return
    if (!isAutoGroup && mode === "full") {
      const ok = await confirm({
        title: "全量归档？",
        description: "会从头扫全站目录，耗时可能很长；日常同步用「增量」即可。",
        confirmLabel: "开始全量",
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    setError("")
    try {
      if (isAutoGroup) {
        await startJob("archive_auto_group", {
          site: "1",
          minMembers: Math.min(50, Math.max(2, Math.floor(minMembers) || 2)),
        })
      } else {
        await startJob(kind, { site, mode })
      }
      onStarted()
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="创建任务"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-lg"
        onKeyDown={(e) => {
          // Tab 循环圈在对话框内（与 ConfirmDialog 同一套）
          if (e.key !== "Tab") return
          const el = dialogRef.current
          if (!el) return
          const focusables = Array.from(
            el.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          )
          if (focusables.length === 0) return
          const first = focusables[0]!
          const last = focusables[focusables.length - 1]!
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 className="text-base font-semibold text-foreground">
          创建任务{step === 2 ? " · 选择参数" : ""}
        </h2>

        {step === 1 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  kind === k.value
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <div className="text-sm font-medium text-foreground">
                  {k.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {k.desc}
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 &&
          (kind === "archive_auto_group" ? (
            <label className="mt-4 block text-sm text-muted-foreground">
              最少章节数（2–50）
              <input
                type="number"
                min={2}
                max={50}
                value={minMembers}
                onChange={(e) => setMinMembers(Number(e.target.value))}
                className="mt-1 h-10 w-28 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          ) : (
            <div className="mt-4">
              {/* 模式：单行 segmented control（规格要求），选中态对所有模式生效（含续跑） */}
              <div className="flex gap-1.5">
                {MODES.map((m) => {
                  const disabled = m.value === "resume" && !resumable
                  return (
                    <button
                      key={m.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(m.value)}
                      className={cn(
                        "min-h-10 flex-1 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-40",
                        mode === m.value
                          ? "border-primary bg-accent text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent/50"
                      )}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {mode === "resume" && !resumable
                  ? "没有可续跑的进度"
                  : mode === "resume"
                    ? `从中断处接着扫（已记 ${statuses[site]?.cursor?.pages ?? 0} 页）`
                    : MODES.find((m) => m.value === mode)!.desc}
              </p>
            </div>
          ))}

        {hasActive && step === 2 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} /> 已有任务进行中或已暂停
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-2 py-1 underline underline-offset-2"
            >
              查看进行中任务
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="min-h-10 rounded-xl px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || hasActive}
              className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {busy ? "启动中…" : "启动"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
