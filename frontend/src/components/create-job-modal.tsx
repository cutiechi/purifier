import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useConfirm } from "@/components/confirm-dialog"
import { startJob, type ArchiveMode, type ArchiveStatus } from "@/lib/jobs"
import type { SiteId } from "@/lib/routes"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"

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

  const site: SiteId = kind === "archive_books" ? "2" : "1"
  const resumable = cursorResumable(statuses[site])

  const submit = async () => {
    setError("")
    if (kind === "archive_auto_group" && (minMembers < 2 || minMembers > 50)) {
      setError("最少章节数需在 2 到 50 之间")
      return
    }

    if (hasActive) {
      const ok = await confirm({
        title: "已有运行中任务",
        description: "启动新任务可能会增加系统负载并排队执行，确定要继续吗？",
        confirmLabel: "继续启动",
        cancelLabel: "取消",
      })
      if (!ok) return
    }

    setBusy(true)
    try {
      if (kind === "archive_auto_group") {
        await startJob(kind, { minMembers })
      } else {
        await startJob(kind, { site, mode })
      }
      onStarted()
      onClose()
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>创建任务{step === 2 ? " · 选择参数" : ""}</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                最少章节数（2–50）
              </label>
              <Input
                type="number"
                min={2}
                max={50}
                value={minMembers}
                onChange={(e) => setMinMembers(Number(e.target.value))}
                className="w-28"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                {MODES.map((m) => {
                  const disabled = m.value === "resume" && !resumable
                  return (
                    <Button
                      key={m.value}
                      type="button"
                      disabled={disabled}
                      variant={mode === m.value ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setMode(m.value)}
                    >
                      {m.label}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "resume" && !resumable
                  ? "没有可续跑的进度"
                  : mode === "resume"
                    ? `从中断处接着扫（已记 ${statuses[site]?.cursor?.pages ?? 0} 页）`
                    : MODES.find((m) => m.value === mode)?.desc}
              </p>
            </div>
          ))}

        {hasActive && step === 2 && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription className="text-xs">
              系统当前已有正在运行的任务，新任务可能会排队等待。
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={() => setStep(2)}>下一步</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                上一步
              </Button>
              <Button disabled={busy} onClick={submit}>
                {busy ? "启动中…" : "启动任务"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
