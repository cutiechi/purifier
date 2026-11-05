import { lazy, Suspense, type ReactNode } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { ErrorBoundary } from "@/components/error-boundary"

const HomePage = lazy(() => import("@/pages/HomePage"))
const NovelPage = lazy(() => import("@/pages/NovelPage"))
const CategoriesPage = lazy(() => import("@/pages/CategoriesPage"))
const FeaturedPage = lazy(() => import("@/pages/FeaturedPage"))
const PicksPage = lazy(() => import("@/pages/PicksPage"))
const CommentsPage = lazy(() => import("@/pages/CommentsPage"))
const TrendingPage = lazy(() => import("@/pages/TrendingPage"))
const BrowsePage = lazy(() => import("@/pages/BrowsePage"))
const SearchPage = lazy(() => import("@/pages/SearchPage"))
const ReadPage = lazy(() => import("@/pages/ReadPage"))
const BookPage = lazy(() => import("@/pages/BookPage"))
const MePage = lazy(() => import("@/pages/MePage"))
const HistoryPage = lazy(() => import("@/pages/HistoryPage"))
const FavoritesPage = lazy(() => import("@/pages/FavoritesPage"))
const TagsPage = lazy(() => import("@/pages/TagsPage"))
const BookmarksPage = lazy(() => import("@/pages/BookmarksPage"))
const GroupPage = lazy(() => import("@/pages/GroupPage"))
const JobsPage = lazy(() => import("@/pages/JobsPage"))
const ArchivePage = lazy(() => import("@/pages/ArchivePage"))
const StatsPage = lazy(() => import("@/pages/StatsPage"))
const LoginPage = lazy(() => import("@/pages/LoginPage"))
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"))

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      加载中…
    </div>
  )
}

/**
 * 每路由错误边界：key=pathname，导航即自愈。
 * 单页渲染 bug 只进本路由兜底屏，不炸整个应用（含顶栏）。
 */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // 只用 resetKey：导航清错误状态但不重挂 children（key 会连页面一起 remount，丢失状态）
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

function page(node: ReactNode) {
  return <RouteBoundary>{node}</RouteBoundary>
}

/**
 * 路由表：一级 = 内容类型，二级 = 内容源（路径前缀 /cool-18 · /xbook-cn）。
 * 静态段（categories/featured/…）由 React Router 优先匹配，
 * 极简内容路由 /cool-18/:tid · /xbook-cn/:cid 只兜底其余一级路径。
 */
export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/cool-18" replace />} />

          {/* 首页 */}
          <Route path="/cool-18" element={page(<HomePage />)} />
          <Route path="/xbook-cn" element={page(<NovelPage />)} />

          {/* 分类 */}
          <Route
            path="/cool-18/categories"
            element={page(<CategoriesPage />)}
          />
          <Route path="/cool-18/browse" element={page(<BrowsePage />)} />
          <Route
            path="/xbook-cn/categories"
            element={page(<CategoriesPage />)}
          />
          <Route path="/xbook-cn/browse" element={page(<BrowsePage />)} />

          {/* 榜单（论坛全量，书库仅人气） */}
          <Route
            path="/cool-18/featured"
            element={page(<FeaturedPage />)}
          />
          <Route path="/cool-18/picks" element={page(<PicksPage />)} />
          <Route
            path="/cool-18/comments"
            element={page(<CommentsPage />)}
          />
          <Route
            path="/cool-18/trending"
            element={page(<TrendingPage />)}
          />
          <Route
            path="/xbook-cn/trending"
            element={page(<TrendingPage />)}
          />

          {/* 目录 */}
          <Route
            path="/cool-18/archive"
            element={page(<ArchivePage />)}
          />
          <Route path="/cool-18/groups" element={page(<GroupPage />)} />
          <Route
            path="/xbook-cn/archive"
            element={page(<ArchivePage />)}
          />

          {/* 搜索（单源，跨站合并搜索已退场） */}
          <Route path="/cool-18/search" element={page(<SearchPage />)} />
          <Route path="/xbook-cn/search" element={page(<SearchPage />)} />

          {/* 内容页（极简动态段，静态段优先级更高） */}
          <Route path="/cool-18/:tid" element={page(<ReadPage />)} />
          <Route path="/xbook-cn/:cid" element={page(<BookPage />)} />

          {/* 我的（跨站个人资产，保留可选 ?site= 过滤） */}
          <Route path="/me" element={page(<MePage />)} />
          <Route path="/history" element={page(<HistoryPage />)} />
          <Route path="/favorites" element={page(<FavoritesPage />)} />
          <Route path="/tags" element={page(<TagsPage />)} />
          <Route path="/bookmarks" element={page(<BookmarksPage />)} />
          <Route path="/jobs" element={page(<JobsPage />)} />
          <Route path="/stats" element={page(<StatsPage />)} />

          <Route path="/login" element={page(<LoginPage />)} />
          <Route path="*" element={page(<NotFoundPage />)} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
