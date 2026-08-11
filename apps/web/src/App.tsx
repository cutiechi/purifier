import { lazy, Suspense, type ReactNode } from "react"
import { Route, Routes, useLocation } from "react-router-dom"
import { ErrorBoundary } from "@/components/error-boundary"

const HomePage = lazy(() => import("@/pages/HomePage"))
const CategoriesPage = lazy(() => import("@/pages/CategoriesPage"))
const DiscoverPage = lazy(() => import("@/pages/DiscoverPage"))
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
const GroupPage = lazy(() => import("@/pages/GroupPage"))
const JobsPage = lazy(() => import("@/pages/JobsPage"))
const ArchivePage = lazy(() => import("@/pages/ArchivePage"))

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
  return (
    <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route
            path="/"
            element={
              <RouteBoundary>
                <HomePage />
              </RouteBoundary>
            }
          />
          <Route
            path="/categories"
            element={
              <RouteBoundary>
                <CategoriesPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/discover"
            element={
              <RouteBoundary>
                <DiscoverPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/featured"
            element={
              <RouteBoundary>
                <FeaturedPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/picks"
            element={
              <RouteBoundary>
                <PicksPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/comments"
            element={
              <RouteBoundary>
                <CommentsPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/trending"
            element={
              <RouteBoundary>
                <TrendingPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/browse"
            element={
              <RouteBoundary>
                <BrowsePage />
              </RouteBoundary>
            }
          />
          <Route
            path="/search"
            element={
              <RouteBoundary>
                <SearchPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/read/:tid"
            element={
              <RouteBoundary>
                <ReadPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/book/:cid"
            element={
              <RouteBoundary>
                <BookPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/me"
            element={
              <RouteBoundary>
                <MePage />
              </RouteBoundary>
            }
          />
          <Route
            path="/history"
            element={
              <RouteBoundary>
                <HistoryPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/favorites"
            element={
              <RouteBoundary>
                <FavoritesPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/tags"
            element={
              <RouteBoundary>
                <TagsPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/groups"
            element={
              <RouteBoundary>
                <GroupPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/jobs"
            element={
              <RouteBoundary>
                <JobsPage />
              </RouteBoundary>
            }
          />
          <Route
            path="/archive"
            element={
              <RouteBoundary>
                <ArchivePage />
              </RouteBoundary>
            }
          />
          <Route
            path="*"
            element={
              <RouteBoundary>
                <HomePage />
              </RouteBoundary>
            }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
