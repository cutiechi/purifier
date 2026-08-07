import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { groupMeListItems } from "@/lib/book-groups"
import { parsePage, parseQuery } from "@/lib/routes"
import { formatTitleMeta, parseListTitle } from "@/lib/title-parse"
import { cn } from "@workspace/ui/lib/utils"

export type MeListPick = (json: Record<string, unknown>) => {
  items: MeListItem[]
  nextPage?: number
}

export function MeListPage({
  title,
  description,
  buildUrl,
  pick,
  renderTrailing,
  toolbar,
  emptyText,
  bookGroupScope,
}: {
  title: string
  description?: string
  /** (q, kind, page) → 完整请求 URL */
  buildUrl: (q: string, kind: string, page: number) => string
  pick: MeListPick
  renderTrailing?: (item: MeListItem, reload: () => void) => ReactNode
  /** 列表上方可选操作区（历史清空等） */
  toolbar?: (ctx: {
    items: MeListItem[]
    reload: () => void
    loading: boolean
  }) => ReactNode
  emptyText?: string
  /** 传入则启用同书折叠分组（值为 scope，如 'history'/'favorites'/'me-items'） */
  bookGroupScope?: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)

  const url = useMemo(() => buildUrl(q, kind, page), [buildUrl, q, kind, page])
  const pickRef = useRef(pick)
  pickRef.current = pick

  const [items, setItems] = useState<MeListItem[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError("")
    try {
      const res = await fetch(url)
      const json = (await res.json()) as Record<string, unknown>
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError(String(json.error || "请求失败"))
        return
      }
      const data = pickRef.current(json)
      setItems(data.items)
      setNextPage(data.nextPage)
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void reload()
  }, [reload])

  const { isExpanded, toggle } = useExpandedBooks(bookGroupScope ?? "__noop__")
  const grouped = useMemo(() => {
    if (!bookGroupScope) return null
    return groupMeListItems(items)
  }, [items, bookGroupScope])

  function update(next: { q?: string; kind?: string; page?: number }) {
    const params = new URLSearchParams(searchParams)
    const changeQ = next.q !== undefined
    const changeKind = next.kind !== undefined
    if (changeQ) {
      if (next.q) params.set("q", next.q)
      else params.delete("q")
    }
    if (changeKind) {
      if (next.kind) params.set("kind", next.kind)
      else params.delete("kind")
    }
    if (next.page !== undefined && next.page > 1) {
      params.set("page", String(next.page))
    } else if (changeQ || changeKind || next.page === 1) {
      params.delete("page")
    }
    setSearchParams(params, { replace: true })
  }

  const KIND_TABS = [
    { value: "", label: "全部" },
    { value: "post", label: "贴子" },
    { value: "book", label: "书库" },
  ]

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description ?? "最近访问的贴子与书库"}
      />

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const input = new FormData(e.currentTarget).get("q")
          update({ q: typeof input === "string" ? input.trim() : "" })
        }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索标题或标签…"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-foreground"
        >
          搜索
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => update({ kind: tab.value })}
            className={cn(
              "min-h-9 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors sm:min-h-0 sm:px-3",
              kind === tab.value
                ? "bg-accent text-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent/70"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {toolbar?.({ items, reload, loading })}

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={emptyText ?? "暂无内容"}
      >
        <PostList>
          {(grouped ?? items.map((item) => ({ type: "single" as const, item }))).map(
            (g) =>
              g.type === "single" ? (
                <MeItemCard
                  key={`${g.item.kind}:${g.item.id}`}
                  item={g.item}
                  trailing={renderTrailing?.(g.item, reload)}
                />
              ) : (
                <CollapsibleBookGroup
                  key={`group:${g.key}`}
                  title={g.title}
                  summary={g.author ?? undefined}
                  count={g.items.length}
                  bookKey={g.key}
                  isExpanded={isExpanded(g.key)}
                  onToggle={() => toggle(g.key)}
                  trailing={g.genre ? <GenrePill genre={g.genre} /> : undefined}
                >
                  {g.items.map((item) => {
                    const parsed = parseListTitle(item.title)
                    // 组内主标题用章节号；副标题用 formatTitleMeta（作者/题材）+
                    // 进度（保留，避免信息丢失）。时间/访问次数由组级上下文决定。
                    const sub = formatTitleMeta(parsed)
                    const subWithProgress =
                      (sub ? `${sub}` : "") +
                      (typeof item.read_progress === "number" &&
                      item.read_progress > 0
                        ? `${sub ? " · " : ""}已读 ${Math.round(item.read_progress * 100)}%`
                        : "")
                    return (
                      <MeItemCard
                        key={`${item.kind}:${item.id}`}
                        item={item}
                        trailing={renderTrailing?.(item, reload)}
                        titleOverride={parsed.chapters || undefined}
                        subtitleOverride={subWithProgress || undefined}
                      />
                    )
                  })}
                </CollapsibleBookGroup>
              ),
          )}
        </PostList>
        <Pager
          page={page}
          hasNext={nextPage !== undefined}
          onPrev={() => update({ page: page - 1 })}
          onNext={() => nextPage !== undefined && update({ page: nextPage })}
          disabled={loading}
        />
      </AsyncBody>
    </PageShell>
  )
}
