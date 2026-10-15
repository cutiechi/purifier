import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { api, bookPath, browsePath, routes } from "@/lib/routes"
import { BookCover } from "@/components/book-cover"

interface BookItem {
  index: number
  title: string
  tid: string
}

interface HomeData {
  category: string
  links: BookItem[]
}

const NOVEL_TAGS = [
  "玄幻",
  "仙侠",
  "都市",
  "武侠",
  "科幻",
  "奇幻",
  "同人",
  "言情",
  "穿越",
  "历史",
  "悬疑",
  "网游",
] as const

export default function NovelPage() {
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(api.booksHome)
      .then(async (res) => {
        if (!res.ok) throw new Error(`书库加载异常: ${res.status}`)
        return (await res.json()) as HomeData
      })
      .then((d) => {
        if (active) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "获取小说列表失败")
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <PageShell>
      <div className="flex flex-col gap-8 pb-12">
        {/* 顶部标语与热门分类标签 */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                纯净小说书库
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                沉浸式网文阅读，无弹窗、无转码广告、极速正文解析
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={routes.trending + "?site=2"}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border/60 bg-card/60 px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                🔥 书库排行榜
              </Link>
            </div>
          </div>

          {/* 常用分类快捷 Pill */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {NOVEL_TAGS.map((tag) => (
              <Link
                key={tag}
                to={browsePath({ site: "2", type: tag })}
                className="inline-flex items-center rounded-lg border border-border/50 bg-secondary/60 px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground"
              >
                {tag}
              </Link>
            ))}
          </div>
        </section>

        {/* 推荐书单列表 */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              热门推荐
            </h2>
            <Link
              to={browsePath({ site: "2", type: "玄幻" })}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              浏览更多 &rarr;
            </Link>
          </div>

          <AsyncBody
            loading={loading}
            error={error}
            empty={!data || data.links.length === 0}
            emptyText="书库暂无推荐小说"
            onRetry={() => window.location.reload()}
          >
            {data && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.links.map((b) => (
                  <Link
                    key={b.tid}
                    to={bookPath(b.tid, { site: "2" })}
                    className="group relative flex gap-3.5 rounded-2xl border border-border/60 bg-card/50 p-3.5 transition-all hover:border-border hover:bg-card hover:shadow-sm"
                  >
                    <BookCover title={b.title} size="md" />
                    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      <div className="flex flex-col gap-1">
                        <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {b.title}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          书号 #{b.tid}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                          连载网文
                        </span>
                        <span className="text-xs font-medium text-primary/80 group-hover:text-primary">
                          阅读目录 &rarr;
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </AsyncBody>
        </section>
      </div>
    </PageShell>
  )
}
