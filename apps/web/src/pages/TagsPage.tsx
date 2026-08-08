import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { useConfirm } from "@/components/confirm-dialog"
import { IconClose } from "@/components/icons"
import { SoftButton } from "@/components/form-controls"
import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { PageSiteTabs } from "@/components/page-site-tabs"
import { SectionTabs } from "@/components/section-tabs"
import { AsyncBody } from "@/components/ui-state"
import { useMeTabs } from "@/lib/hub-tabs"
import { downloadBackup } from "@/lib/jobs"
import { api, meListQuery, routes, tagsPath } from "@/lib/routes"

interface TagCount {
  tag: string
  count: number
}

function TagListView() {
  const confirm = useConfirm()
  const [tags, setTags] = useState<TagCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(api.meTags)
      const json = (await res.json()) as { tags?: TagCount[]; error?: string }
      if (!res.ok) {
        setError(String(json.error || "请求失败"))
        return
      }
      setTags(json.tags ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tags
    return tags.filter((t) => t.tag.toLowerCase().includes(needle))
  }, [tags, q])

  const deleteTag = async (tag: string) => {
    const ok = await confirm({
      title: `删除标签「${tag}」？`,
      description: "将从所有贴子与书库上移除该标签。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (!ok) return
    setRemoving(tag)
    try {
      const res = await fetch(`${api.meTags}?tag=${encodeURIComponent(tag)}`, {
        method: "DELETE",
      })
      if (res.ok) await reload()
      else {
        const json = (await res.json()) as { error?: string }
        setError(String(json.error || "删除失败"))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    } finally {
      setRemoving(null)
    }
  }

  const { pathname } = useLocation()
  const sectionTabs = useMeTabs(pathname)

  return (
    <PageShell>
      <PageHeader
        title="我的"
        description={
          !loading && tags.length > 0
            ? `标签 · 共 ${tags.length} 个 · 点击筛选`
            : "标签 · 点击筛选贴子与书库"
        }
      />
      <PageSiteTabs />
      <SectionTabs items={sectionTabs} />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="筛选标签…"
        type="search"
        className="mb-4 h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-500/60"
      />

      <AsyncBody
        loading={loading}
        error={error}
        empty={filtered.length === 0}
        onRetry={() => void reload()}
        emptyText={q.trim() ? "没有匹配的标签" : "暂无标签"}
      >
        <div className="flex flex-wrap gap-2">
          {filtered.map((t) => (
            <span
              key={t.tag}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/80 bg-card/80 py-1 pr-1 pl-3 text-sm shadow-sm transition-colors hover:border-border hover:bg-accent/40"
            >
              <Link
                to={tagsPath({ tag: t.tag })}
                className="inline-flex max-w-[12rem] min-h-9 min-w-0 items-center gap-1.5 truncate font-medium text-foreground sm:min-h-0"
                title={t.tag}
              >
                <span className="truncate">#{t.tag}</span>
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground tabular-nums">
                  {t.count}
                </span>
              </Link>
              <button
                type="button"
                disabled={removing === t.tag}
                onClick={() => void deleteTag(t.tag)}
                aria-label={`删除标签 ${t.tag}`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50 sm:size-7"
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
        </div>
      </AsyncBody>

      {/* 有意为之：清空入口只出现在标签列表页底部 */}
      <DataManagement />
    </PageShell>
  )
}

function TagItemsView() {
  const [searchParams] = useSearchParams()
  const tag = searchParams.get("tag") ?? ""
  return (
    <MeListPage
      title={`#${tag}`}
      description="该标签下的贴子与书库"
      bookGroupScope="me-items"
      buildUrl={(q, kind, page) => {
        const params = meListQuery({ q, kind, page })
        const query = params ? `&${params}` : ""
        return `${api.meItems}?tag=${encodeURIComponent(tag)}${query}`
      }}
      pick={(json) =>
        json as { items: MeListItem[]; nextPage?: number; total?: number }
      }
      emptyText="该标签下暂无内容"
    />
  )
}

function DataManagement() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState("")

  const clearCache = async () => {
    setBusy(true)
    try {
      const res = await fetch(api.meCache, { method: "DELETE" })
      const json = (await res.json()) as { cleared?: number; error?: string }
      if (!res.ok) throw new Error(json.error || "清空失败")
      setResult(`已清除 ${json.cleared ?? 0} 个缓存文件`)
      setConfirming(false)
    } catch (e) {
      setResult(e instanceof Error ? e.message : "清空失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-12 rounded-2xl border border-border bg-card/50 p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold text-foreground">数据管理</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        清空正文/书库 HTML 与回复 JSON 缓存，不影响历史、收藏与标签。
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <SoftButton onClick={() => downloadBackup()}>导出备份</SoftButton>
        {confirming ? (
          <>
            <SoftButton
              destructive
              disabled={busy}
              onClick={() => void clearCache()}
              className="border-destructive/40 bg-destructive text-white hover:bg-destructive/90 hover:text-white"
            >
              确认清空
            </SoftButton>
            <SoftButton disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </SoftButton>
          </>
        ) : (
          <SoftButton onClick={() => setConfirming(true)}>清空缓存</SoftButton>
        )}
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        导出备份含历史、收藏、标签、分组与归档目录（JSON）。
      </p>
      {result && <p className="mt-2 text-xs text-muted-foreground">{result}</p>}
    </section>
  )
}

export default function TagsPage() {
  const [searchParams] = useSearchParams()
  const tag = searchParams.get("tag")?.trim()
  if (tag) return <TagItemsView />
  return <TagListView />
}
