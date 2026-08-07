import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageShell } from "@/components/page-shell"
import { AsyncBody } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { api, readPath, routes } from "@/lib/routes"

interface ArchivePost {
  site: string
  tid: string
  title: string
  first_seen_at: number
  archived_at: number
}

type SortKey = "title" | "tid" | "archived_at"

const SORT_LABEL: Record<SortKey, string> = {
  title: "标题",
  tid: "最新",
  archived_at: "最近更新",
}

export default function ArchivePage() {
  const [items, setItems] = useState<ArchivePost[]>([])
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("title")
  const [page, setPage] = useState(1)

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("sort", sort)
      params.set("page", String(page))
      if (q) params.set("q", q)
      const res = await fetch(`${api.meArchive}?${params.toString()}`)
      const json = (await res.json()) as {
        items: ArchivePost[]
        nextPage?: number
        error?: string
      }
      if (!res.ok) {
        setError(json.error || "请求失败")
        return
      }
      setItems(json.items ?? [])
      setNextPage(json.nextPage)
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [sort, page, q])

  useEffect(() => {
    const t = setTimeout(() => void reload(), 300) // debounce q
    return () => clearTimeout(t)
  }, [reload])

  return (
    <PageShell>
      <PageHeader title="归档" description="全站主帖目录（tid + 标题）" />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="搜索标题"
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        />
        <div className="ml-auto flex gap-1">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSort(key)
                setPage(1)
              }}
              className={`rounded-lg px-2.5 py-1 text-sm transition-colors ${
                sort === key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {SORT_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
      <AsyncBody
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={() => void reload()}
        emptyText={
          <>
            还没有归档，去
            <Link
              to={routes.jobs}
              className="text-foreground underline underline-offset-2"
            >
              任务
            </Link>
            开始一次归档
          </>
        }
      >
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={`${it.site}:${it.tid}`}
              className="flex items-baseline gap-2"
            >
              <a
                href={readPath(it.tid, it.site)}
                className="text-sm text-foreground hover:underline"
              >
                {it.title}
              </a>
              <span className="text-xs text-muted-foreground/70 tabular-nums">
                #{it.tid}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            上一页
          </button>
          <span className="px-2 py-1 text-sm text-muted-foreground tabular-nums">
            第 {page} 页
          </span>
          <button
            type="button"
            disabled={!nextPage}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </AsyncBody>
    </PageShell>
  )
}
