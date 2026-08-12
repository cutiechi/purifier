import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { CharacterName } from "@workspace/core/character-highlight"
import { normalizeCharacterName } from "@workspace/core/character-highlight"

interface Anchor {
  name: string
  rect: DOMRect
}

const GAP = 8
const EDGE = 8

function isInReadingBody(node: Node | null): boolean {
  if (!node) return false
  if (node instanceof Element) return !!node.closest(".reading-body")
  return !!node.parentElement?.closest(".reading-body")
}

/**
 * 选区浮条：mouseup/touchend 时检查正文选区，合法则浮在选区上方。
 * 仅在 .reading-body 内的选区触发；normalizeCharacterName 失败（含换行/制表符、
 * 空、超长）则不显示。Esc / 滚动 / 点空白关闭。
 */
export function CharacterSelectionToolbar({
  characters,
  onAdd,
  onRemove,
}: {
  characters: CharacterName[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // 先给占位坐标让浮条挂载，useLayoutEffect 在绘制前测宽高并重定位
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  const handleSelection = useCallback((e: MouseEvent | TouchEvent) => {
    const target = e.target
    if (!(target instanceof Element)) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setAnchor(null)
      return
    }
    // 选区须落在正文内（以选区文本所在节点为准，鼠标落点兜底）
    if (
      !isInReadingBody(selection.anchorNode) &&
      !isInReadingBody(selection.focusNode) &&
      !target.closest(".reading-body")
    ) {
      setAnchor(null)
      return
    }
    const name = normalizeCharacterName(selection.toString())
    if (!name) {
      setAnchor(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setAnchor(null)
      return
    }
    setAnchor({ name, rect })
  }, [])

  useEffect(() => {
    document.addEventListener("mouseup", handleSelection)
    document.addEventListener("touchend", handleSelection)
    return () => {
      document.removeEventListener("mouseup", handleSelection)
      document.removeEventListener("touchend", handleSelection)
    }
  }, [handleSelection])

  // 定位：默认在选区上方，上方放不下则翻到下方；水平钳制在视口内
  useLayoutEffect(() => {
    if (!anchor || !barRef.current) return
    const bar = barRef.current
    let top = anchor.rect.top - bar.offsetHeight - GAP
    if (top < EDGE) top = anchor.rect.bottom + GAP
    top = Math.min(top, window.innerHeight - bar.offsetHeight - EDGE)
    const left = Math.max(
      EDGE,
      Math.min(anchor.rect.left, window.innerWidth - bar.offsetWidth - EDGE)
    )
    setPos({ top, left })
  }, [anchor])

  // 关闭：Esc / 任意滚动（capture 覆盖滚动容器）/ 点空白
  useEffect(() => {
    if (!anchor) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAnchor(null)
    }
    const onScroll = () => setAnchor(null)
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current?.contains(e.target as Node)) return
      setAnchor(null)
    }
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", onScroll, true)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", onScroll, true)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [anchor])

  if (!anchor) return null

  const exists = characters.some((c) => c.name === anchor.name)
  const act = () => {
    const name = anchor.name
    setAnchor(null)
    if (exists) onRemove(name)
    else onAdd(name)
  }

  return (
    <div
      ref={barRef}
      className="fixed z-50 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md"
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={act}
        className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        {exists ? "取消标记" : "标记为人物"}
      </button>
    </div>
  )
}
