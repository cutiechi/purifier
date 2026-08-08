import { Route, Routes } from "react-router-dom"
import HomePage from "@/pages/HomePage"
import CategoriesPage from "@/pages/CategoriesPage"
import DiscoverPage from "@/pages/DiscoverPage"
import FeaturedPage from "@/pages/FeaturedPage"
import PicksPage from "@/pages/PicksPage"
import CommentsPage from "@/pages/CommentsPage"
import TrendingPage from "@/pages/TrendingPage"
import BrowsePage from "@/pages/BrowsePage"
import SearchPage from "@/pages/SearchPage"
import ReadPage from "@/pages/ReadPage"
import BookPage from "@/pages/BookPage"
import MePage from "@/pages/MePage"
import HistoryPage from "@/pages/HistoryPage"
import FavoritesPage from "@/pages/FavoritesPage"
import TagsPage from "@/pages/TagsPage"
import GroupPage from "@/pages/GroupPage"
import JobsPage from "@/pages/JobsPage"
import ArchivePage from "@/pages/ArchivePage"

export function App() {
  return (
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
  )
}
