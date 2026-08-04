import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { MeItemCard, type MeListItem } from "@/components/me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell, AsyncBody, Pager } from "@/components/page-shell"
import { PostList } from "@/components/post-card"
import { parsePage, parseQuery } from "@/lib/routes"
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
  emptyText,
}: {
  title: string
  description?: string
  /** (q, kind, page) → 完整请求 URL */
  buildUrl: (q: string, kind: string, page: number) => string
  pick: MeListPick
  renderTrailing?: (item: MeListItem, reload: () => void) => ReactNode
  emptyText?: string
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
          className="border-border bg-card text-foreground placeholder:text-muted-foreground/60 h-11 min-w-0 flex-1 rounded-xl border px-3.5 text-sm outline-none focus:border-sky-500/60"
        />
        <button
          type="submit"
          className="bg-accent text-foreground h-11 shrink-0 rounded-xl px-4 text-sm font-medium"
        >
          搜索
        </button>
      </form>

      <div className="mb-4 flex gap-1.5">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => update({ kind: tab.value })}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              kind === tab.value
                ? "bg-accent text-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent/70"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={emptyText ?? "暂无内容"}
      >
        <PostList>
          {items.map((item) => (
            <MeItemCard
              key={`${item.kind}:${item.id}`}
              item={item}
              trailing={renderTrailing?.(item, reload)}
            />
          ))}
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
