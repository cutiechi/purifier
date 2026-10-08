import { IconSearch } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/** 「搜索相似」入口按钮：由容器渲染在卡片外右侧，点击开合下方搜索结果面板 */
export function SimilarTrigger({
  open,
  onToggle,
  className,
}: {
  open: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="搜索相似"
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
        open
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
    >
      <IconSearch size={13} />
      {/* 移动端只留图标：文字常驻会挤压卡片标题空间（aria-label 保证可访问名） */}
      <span className="hidden sm:inline">搜索相似</span>
    </button>
  )
}
