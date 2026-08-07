import { IconSearch } from "@/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/** 「搜索相似」入口按钮：容器渲染在标题行最右侧，点击开合下方搜索结果面板 */
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
      onClick={(e) => {
        // 触发器可能位于卡片 <Link> 内部（PostCard 的 trailing 插槽），
        // 拦截事件避免点击触发页面跳转
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
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
      <span className="hidden sm:inline">搜索相似</span>
    </button>
  )
}
