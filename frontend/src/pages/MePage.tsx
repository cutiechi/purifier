import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Bookmark, BarChart3, Folder } from "lucide-react"
import {
  PageHeader,
  PageShell,
  AsyncBody,
  SectionLabel,
} from "@/components/page-shell"
import { SectionTabs } from "@/components/section-tabs"
import { buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { api, bookPath, forumRoutes, readPath, routes } from "@/lib/routes"
import { BookCover } from "@/components/book-cover"
import { useMeTabs } from "@/lib/hub-tabs"

interface ItemRecord {
  id: string
  title: string
  url: string
  site: string
  kind: string
  last_visited_at?: number
  read_progress?: number
  last_chapter?: number
}

export default function MePage() {
  const { user } = useAuth()
  const meTabs = useMeTabs(routes.me)

  // 小说书架数据
  const [books, setBooks] = useState<ItemRecord[]>([])
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [booksError, setBooksError] = useState("")

  // 论坛足迹数据
  const [posts, setPosts] = useState<ItemRecord[]>([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [postsError, setPostsError] = useState("")

  useEffect(() => {
    // 抓取小说书架（site=2 的历史即书架）与论坛收藏（site=1）
    let alive = true
    setLoadingBooks(true)
    setBooksError("")
    fetch(`${api.meHistory}?site=2&kind=book`)
      .then(async (res) => {
        if (!res.ok) throw new Error("书架加载失败")
        return (await res.json()) as { items: ItemRecord[] }
      })
      .then((data) => {
        if (!alive) return
        setBooks(data.items || [])
        setLoadingBooks(false)
      })
      .catch((e) => {
        if (!alive) return
        setBooksError(e instanceof Error ? e.message : "书架加载失败")
        setLoadingBooks(false)
      })

    setLoadingPosts(true)
    setPostsError("")
    fetch(`${api.meFavorites}?site=1&kind=post`)
      .then(async (res) => {
        if (!res.ok) throw new Error("收藏加载失败")
        return (await res.json()) as { items: ItemRecord[] }
      })
      .then((data) => {
        if (!alive) return
        setPosts(data.items || [])
        setLoadingPosts(false)
      })
      .catch((e) => {
        if (!alive) return
        setPostsError(e instanceof Error ? e.message : "收藏加载失败")
        setLoadingPosts(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <PageShell>
      <PageHeader
        title="我的"
        description="跨站无缝统一管理小说书架、论坛收藏、进度与书签"
      />
      <SectionTabs items={meTabs} />

      <div className="flex flex-col gap-6 pb-12">
        {/* 用户概览与快捷操作栏 */}
        <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-bold text-primary">
              {user?.name?.[0] || user?.email?.[0] || "读"}
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {user
                  ? user.name || user.email || "已登录用户"
                  : "纯净阅读资产中心"}
              </h1>
              <p className="text-xs text-muted-foreground">
                跨站无缝统一管理小说书架、论坛收藏、进度与书签
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={routes.bookmarks}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Bookmark className="size-4" />
              书签管理
            </Link>
            <Link
              to={routes.stats}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <BarChart3 className="size-4" />
              阅读统计
            </Link>
            <Link
              to={forumRoutes.groups}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Folder className="size-4" />
              作者分组
            </Link>
          </div>
        </section>

        {/* 我的小说书架 */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <SectionLabel>我的小说书架</SectionLabel>
            <Link
              to={`${routes.history}?site=2`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部记录 &rarr;
            </Link>
          </div>

          <AsyncBody
            loading={loadingBooks}
            error={booksError}
            empty={books.length === 0}
            emptyText="暂无阅读中的小说，快去书库挑选吧"
            onRetry={() => window.location.reload()}
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((item) => (
                <div
                  key={item.id}
                  className="group relative flex gap-3.5 rounded-2xl border border-border/60 bg-card/50 p-3.5 transition-all hover:border-border hover:bg-card"
                >
                  <BookCover title={item.title} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                    <div className="flex flex-col gap-1">
                      <Link
                        to={bookPath(item.id)}
                        className="line-clamp-2 text-sm font-semibold text-foreground transition-colors group-hover:text-primary"
                      >
                        {item.title}
                      </Link>
                      {item.last_chapter != null && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          上次读至: 第 {item.last_chapter} 章
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <Link
                        to={bookPath(item.id, {
                          chapter: String(item.last_chapter ?? 1),
                        })}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        继续阅读 &rarr;
                      </Link>
                      <Link
                        to={bookPath(item.id)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        目录
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </AsyncBody>
        </section>

        {/* 论坛帖子足迹 */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <SectionLabel>论坛收藏足迹</SectionLabel>
            <Link
              to={`${routes.favorites}?site=1`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部记录 &rarr;
            </Link>
          </div>

          <AsyncBody
            loading={loadingPosts}
            error={postsError}
            empty={posts.length === 0}
            emptyText="暂无收藏的论坛帖子"
            onRetry={() => window.location.reload()}
          >
            <div className="flex flex-col divide-y divide-border/40 rounded-2xl border border-border/60 bg-card/40">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-accent/40"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      to={readPath(post.id)}
                      className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {post.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      帖子 #{post.id}
                    </span>
                  </div>
                  <Link
                    to={readPath(post.id)}
                    className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    阅读帖子
                  </Link>
                </div>
              ))}
            </div>
          </AsyncBody>
        </section>
      </div>
    </PageShell>
  )
}
