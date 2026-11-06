import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AsyncBody, EmptyState } from "@/components/ui-state"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { Pager } from "@/components/pager"
import { GroupedPostList } from "@/components/grouped-post-list"
import { SiteTabs } from "@/components/site-tabs"
import { PostList } from "@/components/post-card"
import { ListPostCard } from "@/components/list-post-card"
import { SectionLabel } from "@/components/page-header"
import { SearchForm, ListMeta, useScrollTop } from "@/components/form-controls"
import { formatListPagination } from "@/lib/list-meta"
import { useSite } from "@/hooks/use-site"
import { api, bookPath, forumRoutes, libraryRoutes, parsePage, parseQuery, readPath, searchPath } from "@/lib/routes"
import type { ChapterLink } from "@/lib/types"
import { compareTid } from "@/lib/groups"

interface BrowseResponse {
  links: ChapterLink[] | null
  nextPage: number | null
  category?: string
  error?: string
}

/** 单源搜索：论坛 /cool-18/search，书库 /xbook-cn/search（源由路径前缀表达） */
export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const site = useSite()
  const q = parseQuery(searchParams)
  const pageParam = parsePage(searchParams)
  const isLibrary = site === "2"

  const [input, setInput] = useState(q)
  const [links, setLinks] = useState<ChapterLink[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [localItems, setLocalItems] = useState<ChapterLink[]>([])
  const [localTotal, setLocalTotal] = useState(0)
  const [localLoading, setLocalLoading] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    setInput(q)
  }, [q])

  // 本地归档检索：与在线结果独立展示；鉴权失败（未登录）静默隐藏
  useEffect(() => {
    if (!q) {
      setLocalItems([])
      setLocalTotal(0)
      setLocalLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLocalLoading(true)
    fetch(`${api.meArchive}?site=${site}&q=${encodeURIComponent(q)}&limit=50`, {
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: { items?: ChapterLink[]; total?: number }) => {
        setLocalItems(Array.isArray(d.items) ? d.items : [])
        setLocalTotal(typeof d.total === "number" ? d.total : 0)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLocalLoading(false)
      })
    return () => ctrl.abort()
  }, [q, site])

  useScrollTop([q, pageParam])

  const loadPage = useCallback(
    async (keyword: string, p: number) => {
      const seq = ++seqRef.current
      setLinks([])
      setLoading(true)
      setError("")
      try {
        const res = await fetch(
          `${api.browse}?q=${encodeURIComponent(keyword)}&site=${site}&page=${p}`
        )
        const json = (await res.json()) as BrowseResponse
        if (seq !== seqRef.current) return
        if (!res.ok) {
          setError(json.error || "请求失败")
          return
        }
        const hits = json.links ?? []
        // 章节顺序：按 tid 升序（与折叠组内成员排序一致）
        setLinks([...hits].sort((a, b) => compareTid(a.tid, b.tid)))
        setNextPage(json.nextPage)
      } catch (e) {
        if (seq === seqRef.current)
          setError(e instanceof Error ? e.message : "未知错误")
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    },
    [site]
  )

  useEffect(() => {
    if (!q) {
      setLinks([])
      setNextPage(null)
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
            : isLibrary
              ? "搜索书库书籍"
              : "搜索论坛帖子"
        }
        action={
          <SiteTabs
            site={site}
            targets={{
              "1": `${forumRoutes.search}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
              "2": `${libraryRoutes.search}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
            }}
          />
        }
      />

      <SearchForm
        value={input}
        onChange={setInput}
        placeholder={isLibrary ? "输入书名关键词" : "输入关键词"}
        maxLength={40}
        showIcon
        buttonLabel="搜索"
        className="mb-6 sm:mb-8"
        onSubmit={(next) => {
          if (!next) return
          goTo(next, 1)
        }}
      />

      {q && (localLoading || localItems.length > 0) && (
        <section className="mb-8">
          <SectionLabel
            action={
              <span className="text-xs tabular-nums text-muted-foreground">
                {localLoading ? "检索中…" : `共 ${localTotal} 条`}
              </span>
            }
          >
            本地归档
          </SectionLabel>
          <PostList>
            {localItems.map((it) => (
              <ListPostCard
                key={it.tid}
                href={isLibrary ? bookPath(it.tid) : readPath(it.tid)}
                rawTitle={it.title}
                showGenre
              />
            ))}
          </PostList>
          {localTotal > localItems.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              仅显示前 {localItems.length} 条 · 完整列表请到
              <Link
                to={
                  isLibrary
                    ? `${libraryRoutes.archive}?q=${encodeURIComponent(q)}`
                    : `${forumRoutes.archive}?q=${encodeURIComponent(q)}`
                }
                className="mx-1 text-foreground underline underline-offset-2"
              >
                目录
              </Link>
              查看
            </p>
          )}
        </section>
      )}

      {!q && !loading ? (
        <EmptyState>输入关键词开始搜索</EmptyState>
      ) : (
        <AsyncBody
          loading={loading}
          error={error}
          empty={!!q && links.length === 0 && localItems.length === 0}
          onRetry={() => q && loadPage(q, pageParam)}
          emptyText={
            q
              ? localItems.length > 0
                ? "在线无更多结果"
                : `没有找到「${q}」相关内容`
              : "输入关键词开始搜索"
          }
        >
          <ListMeta>
            {formatListPagination({
              page: pageParam,
              pageCount: links.length,
              pageSize: Math.max(links.length, 1),
              hasNext: nextPage !== null,
            })}
          </ListMeta>
          <GroupedPostList items={links} site={site} storageKey="search" />
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
