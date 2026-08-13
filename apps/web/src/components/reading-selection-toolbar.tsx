import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { normalizeBookmarkQuote } from "@workspace/core/bookmarks"
import { normalizeCharacterName } from "@workspace/core/character-highlight"
import type { CharacterCluster } from "@workspace/core/character-highlight"
import { CharacterSwatch } from "@/components/character-swatch"

type Mode = "select" | "bookmark"

interface Anchor {
  quote: string
  rect: DOMRect
  mode: Mode
  note: string
  nameError: boolean
}

const GAP = 8
const EDGE = 8

function isInReadingBody(node: Node | null): boolean {
  if (!node) return false
  if (node instanceof Element) return !!node.closest(".reading-body")
  return !!node.parentElement?.closest(".reading-body")
}

/**
 * 选区浮条：mouseup/touchend 时检查正文选区（非折叠且落在 .reading-body 内），
 * 浮在选区上方。Esc / 滚动 / 点空白关闭。
 *
 * 两态：
 * - select：提供「书签」「人物」（已在组则「取消标记」）；人名不合法时点「人物」
 *   显示内联错误「不能作为人名」；合法且未标记时下方列表可挂靠已有组。
 * - bookmark：点「书签」进入，只读展示摘录 + 笔记输入；「保存」回调
 *   onBookmark(quote, note) 后关闭，「取消」回到 select。
 */
export function ReadingSelectionToolbar({
  clusters,
  onAdd,
  onRemove,
  onBookmark,
}: {
  clusters: CharacterCluster[]
  onAdd: (name: string, clusterId?: number) => void
  onRemove: (name: string) => void
  onBookmark: (quote: string, note: string) => void
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // 先给占位坐标让浮条挂载，useLayoutEffect 在绘制前测宽高并重定位
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  const handleSelection = useCallback((e: MouseEvent | TouchEvent) => {
    // 点在浮条内（如笔记输入框）不因选区被清空而关闭
    if (barRef.current?.contains(e.target as Node)) return
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
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setAnchor(null)
      return
    }
    // 显示与否不再取决于 normalizeCharacterName；quote 存原文，动作时再规范化
    setAnchor({
      quote: selection.toString(),
      rect,
      mode: "select",
      note: "",
      nameError: false,
    })
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

  // 关闭：Esc / 任意滚动（capture 覆盖滚动容器）/ 点空白（两态都关）
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

  const name = normalizeCharacterName(anchor.quote)
  const exists = name !== null && clusters.some((c) => c.names.includes(name))

  const openBookmark = () => {
    // 摘录无法规范化（空白）则忽略：不调用 onBookmark、不关闭
    if (normalizeBookmarkQuote(anchor.quote) === null) return
    setAnchor({ ...anchor, mode: "bookmark", note: "", nameError: false })
  }
  const act = () => {
    if (name === null) {
      setAnchor({ ...anchor, nameError: true })
      return
    }
    setAnchor(null)
    if (exists) onRemove(name)
    else onAdd(name)
  }
  const attach = (clusterId: number) => {
    if (name === null) return
    setAnchor(null)
    onAdd(name, clusterId)
  }
  const saveBookmark = () => {
    const quote = normalizeBookmarkQuote(anchor.quote)
    if (quote === null) return
    onBookmark(quote, anchor.note)
    setAnchor(null)
  }
  const cancelBookmark = () => {
    setAnchor({ ...anchor, mode: "select", note: "", nameError: false })
  }

  if (anchor.mode === "bookmark") {
    const quote = normalizeBookmarkQuote(anchor.quote)
    if (quote === null) return null // 进入时已校验，理论不可达
    return (
      <div
        ref={barRef}
        className="fixed z-50 flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-md"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="max-h-32 break-words overflow-y-auto text-sm leading-snug text-foreground">
          {quote}
        </p>
        <input
          value={anchor.note}
          onChange={(e) => setAnchor({ ...anchor, note: e.target.value })}
          placeholder="笔记（可选）"
          className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancelBookmark}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={saveBookmark}
            className="rounded-md bg-foreground/70 px-2.5 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground"
          >
            保存
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={barRef}
      className="fixed z-50 flex max-h-72 flex-col rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openBookmark}
          className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          书签
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={act}
          className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {exists ? "取消标记" : "人物"}
        </button>
      </div>
      {anchor.nameError && (
        <p className="px-2 pb-1 text-xs text-destructive">不能作为人名</p>
      )}
      {anchor.mode === "select" &&
        name !== null &&
        !exists &&
        clusters.length > 0 && (
          <ul className="mt-1 flex max-h-48 flex-col overflow-y-auto border-t border-border pt-1">
            {clusters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => attach(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent"
                >
                  <CharacterSwatch hue={c.hue} />
                  <span className="min-w-0 flex-1 truncate">
                    {c.names.join(" / ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
