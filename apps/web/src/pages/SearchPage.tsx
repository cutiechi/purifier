import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, Spinner } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { PostList } from "@/components/post-card"
import { ListPostCard, GenrePill } from "@/components/list-post-card"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { SimilarPostCard } from "@/components/similar-post-card"
import { groupMeListItems } from "@/lib/book-groups"
import { mergeItemKey, toMeListItems } from "@/lib/merge-search"
import { ListMeta, SearchForm, useScrollTop } from "@/components/form-controls"
import { formatListPagination } from "@/lib/list-meta"
import { cn } from "@workspace/ui/lib/utils"
import { useSite } from "@/hooks/use-site"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import type { MergedSearchItem } from "@workspace/core"
import {
  api,
  bookPath,
  parsePage,
  parseQuery,
  readPath,
  searchPath,
  SITES,
  type SiteId,
} from "@/lib/routes"

interface SearchResponse {
  items: MergedSearchItem[]
  nextPage: number | null
  errors?: Record<string, string>
}

/** 来源标签：论坛 = 中性，书库 = 强调 */
function SourceBadge({ site }: { site: SiteId }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        site === "2"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {SITES[site]?.label ?? site}
    </span>
  )
}

function SearchContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ?site= 只服务全站导航（顶栏上下文），不参与 /api/search 请求
  const site = useSite()
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)

  const [input, setInput] = useState(q)
  const [links, setLinks] = useState<MergedSearchItem[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const seqRef = useRef(0)

  const { isExpanded, toggle } = useExpandedBooks("search")
  const grouped = useMemo(() => groupMeListItems(toMeListItems(links)), [links])

  useEffect(() => {
    setInput(q)
  }, [q])

  useScrollTop([q, pageParam])

  const loadPage = useCallback(async (keyword: string, p: number) => {
    const seq = ++seqRef.current
    setLinks([])
    setLoading(true)
    setError("")
    setErrors({})
    try {
      const res = await fetch(
        `${api.search}?q=${encodeURIComponent(keyword)}&page=${p}`
      )
      const json = (await res.json()) as SearchResponse
      if (seq !== seqRef.current) return
      if (!res.ok) {
        setError((json as { error?: string }).error || "请求失败")
        return
      }
      setLinks(json.items)
      setNextPage(json.nextPage)
      setErrors(json.errors ?? {})
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : "未知错误")
      }
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!q) {
      setLinks([])
      setNextPage(null)
      setErrors({})
      setError("")
      setLoading(false)
      return
    }
    loadPage(q, pageParam)
  }, [q, pageParam, loadPage])

  function goTo(keyword: string, p: number) {
    navigate(searchPath({ q: keyword, page: p, site }))
  }

  return (
    <PageShell>
      <PageHeader
        title="搜索"
        description={
          q && !loading && links.length > 0
            ? `「${q}」· 第 ${pageParam} 页 · ${links.length} 条`
            : "同时搜索论坛与书库"
        }
      />

      <SearchForm
        value={input}
        onChange={setInput}
        placeholder="输入关键词"
        maxLength={40}
        showIcon
        buttonLabel="搜索"
        className="mb-6 sm:mb-8"
        onSubmit={(next) => {
          if (!next) return
          goTo(next, 1)
        }}
      />

      {Object.keys(errors).length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {Object.entries(errors).map(([sid, msg]) => (
            <div key={sid}>
              {SITES[sid]?.label ?? sid}搜索暂不可用：{msg}
            </div>
          ))}
        </div>
      )}

      {!q && !loading ? (
        <AsyncBody
          loading={false}
          error=""
          empty
          emptyText="输入关键词开始搜索"
        >
          {null}
        </AsyncBody>
      ) : (
        <AsyncBody
          loading={loading}
          error={error}
          empty={!!q && links.length === 0}
          onRetry={() => q && loadPage(q, pageParam)}
          emptyText={q ? `没有找到「${q}」相关内容` : "输入关键词开始搜索"}
        >
          <ListMeta>
            {formatListPagination({
              page: pageParam,
              pageCount: links.length,
              pageSize: Math.max(links.length, 1),
              hasNext: nextPage !== null,
            })}
          </ListMeta>
          <PostList>
            {grouped.map((g) =>
              g.type === "group" ? (
                <CollapsibleBookGroup
                  key={`group:${g.key}`}
                  title={g.title}
                  summary={g.author ?? undefined}
                  count={g.items.length}
                  bookKey={g.key}
                  isExpanded={isExpanded(g.key)}
                  onToggle={() => toggle(g.key)}
                  trailing={
                    <span className="flex shrink-0 items-center gap-2">
                      {g.genre ? <GenrePill genre={g.genre} /> : null}
                      <SourceBadge site="1" />
                    </span>
                  }
                  similar={{
                    title: g.title,
                    groupKey: g.key,
                    seedItems: g.items.map((m) => ({
                      tid: m.id,
                      title: m.title,
                    })),
                  }}
                >
                  {g.items.map((m) => (
                    <ListPostCard
                      key={mergeItemKey(m)}
                      href={readPath(m.id, m.site)}
                      rawTitle={m.title}
                      showGenre
                    />
                  ))}
                </CollapsibleBookGroup>
              ) : g.item.kind === "book" ? (
                <ListPostCard
                  key={mergeItemKey(g.item)}
                  href={bookPath(g.item.id, { site: g.item.site })}
                  rawTitle={g.item.title}
                  showGenre
                  trailing={<SourceBadge site={g.item.site} />}
                />
              ) : (
                <SimilarPostCard
                  key={mergeItemKey(g.item)}
                  href={readPath(g.item.id, g.item.site)}
                  rawTitle={g.item.title}
                  tid={g.item.id}
                  site={g.item.site}
                  showGenre
                  badge={<SourceBadge site="1" />}
                />
              )
            )}
          </PostList>
          <Pager
            page={pageParam}
            hasNext={nextPage !== null}
            onPrev={() => goTo(q, pageParam - 1)}
            onNext={() => nextPage !== null && goTo(q, nextPage)}
            disabled={loading}
          />
        </AsyncBody>
      )}
    </PageShell>
  )
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <Spinner />
        </PageShell>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
