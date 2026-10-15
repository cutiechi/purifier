import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageShell, AsyncBody } from "@/components/page-shell"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { api, bookPath, readPath, routes } from "@/lib/routes"
import { BookCover } from "@/components/book-cover"

interface ItemRecord {
  id: string
  title: string
  url: string
  site: string
  kind: string
  lastVisitAt?: string
  progress?: number
  lastChapter?: string
}

export default function MePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<string>("bookshelf")
  
  // 小说书架数据
  const [books, setBooks] = useState<ItemRecord[]>([])
  const [loadingBooks, setLoadingBooks] = useState(true)

  // 论坛足迹数据
  const [posts, setPosts] = useState<ItemRecord[]>([])
  const [loadingPosts, setLoadingPosts] = useState(true)

  useEffect(() => {
    // 抓取小说历史与书架（site=2）
    fetch(`${api.meHistory}?site=2&kind=book&limit=20`)
      .then(async (res) => {
        if (!res.ok) return { items: [] }
        return (await res.json()) as { items: ItemRecord[] }
      })
      .then((data) => {
        setBooks(data.items || [])
        setLoadingBooks(false)
      })
      .catch(() => setLoadingBooks(false))

    // 抓取论坛足迹与收藏（site=1）
    fetch(`${api.meFavorites}?site=1&kind=post&limit=20`)
      .then(async (res) => {
        if (!res.ok) return { items: [] }
        return (await res.json()) as { items: ItemRecord[] }
      })
      .then((data) => {
        setPosts(data.items || [])
        setLoadingPosts(false)
      })
      .catch(() => setLoadingPosts(false))
  }, [])

  return (
    <PageShell>
      <div className="flex flex-col gap-6 pb-12">
        {/* 用户概览与快捷操作栏 */}
        <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-bold text-primary">
              {user?.name?.[0] || user?.email?.[0] || "读"}
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {user ? user.name || user.email || "已登录用户" : "纯净阅读资产中心"}
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
              🔖 书签管理
            </Link>
            <Link
              to={routes.stats}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              📊 阅读统计
            </Link>
            <Link
              to={routes.archive}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              📁 作者分组
            </Link>
          </div>
        </section>

        {/* 核心分栏：我的小说书架 vs 论坛帖子足迹 */}
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between border-b border-border/50 pb-1">
            <TabsList className="bg-muted/70">
              <TabsTrigger value="bookshelf" className="text-xs sm:text-sm font-medium">
                📚 我的小说书架
              </TabsTrigger>
              <TabsTrigger value="forum" className="text-xs sm:text-sm font-medium">
                💬 论坛收藏足迹
              </TabsTrigger>
            </TabsList>

            <Link
              to={tab === "bookshelf" ? `${routes.history}?site=2` : `${routes.favorites}?site=1`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部记录 &rarr;
            </Link>
          </div>

          {/* 小说书架分栏 */}
          <TabsContent value="bookshelf" className="pt-4">
            <AsyncBody
              loading={loadingBooks}
              error={null}
              empty={books.length === 0}
              emptyText="暂无阅读中的小说，快去书库挑选吧"
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
                          to={bookPath(item.id, { site: "2" })}
                          className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary transition-colors"
                        >
                          {item.title}
                        </Link>
                        {item.lastChapter && (
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            上次读至: 第 {item.lastChapter} 章
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <Link
                          to={bookPath(item.id, {
                            site: "2",
                            chapter: item.lastChapter || "1",
                          })}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          继续阅读 &rarr;
                        </Link>
                        <Link
                          to={bookPath(item.id, { site: "2" })}
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
          </TabsContent>

          {/* 论坛足迹分栏 */}
          <TabsContent value="forum" className="pt-4">
            <AsyncBody
              loading={loadingPosts}
              error={null}
              empty={posts.length === 0}
              emptyText="暂无收藏的论坛帖子"
            >
              <div className="flex flex-col divide-y divide-border/40 rounded-2xl border border-border/60 bg-card/40">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        to={readPath(post.id, "1")}
                        className="truncate text-sm font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {post.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        帖子 #{post.id}
                      </span>
                    </div>
                    <Link
                      to={readPath(post.id, "1")}
                      className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      阅读帖子
                    </Link>
                  </div>
                ))}
              </div>
            </AsyncBody>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  )
}
