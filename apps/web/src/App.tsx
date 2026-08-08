import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router-dom"
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

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/featured" element={<FeaturedPage />} />
          <Route path="/picks" element={<PicksPage />} />
          <Route path="/comments" element={<CommentsPage />} />
          <Route path="/trending" element={<TrendingPage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/read/:tid" element={<ReadPage />} />
          <Route path="/book/:cid" element={<BookPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/groups" element={<GroupPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
