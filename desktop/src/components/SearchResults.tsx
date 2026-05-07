import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { getPageContent } from "../services/api";
import "./SearchResults.css";

function SearchResults() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchResults = useAppStore((s) => s.searchResults);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setSearchResults = useAppStore((s) => s.setSearchResults);

  const handleSelect = useCallback(
    async (pageId: string, title: string) => {
      try {
        const content = await getPageContent(pageId);
        setCurrentPage({ id: pageId, title: content.title, body: content.body, saved: true });
      } catch {
        setCurrentPage({ id: pageId, title, body: "", saved: true });
      }
      setSearchQuery("");
      setSearchResults([]);
    },
    [setCurrentPage, setSearchQuery, setSearchResults],
  );

  if (!searchQuery || searchResults.length === 0) return null;

  return (
    <div className="search-results" role="list" aria-label="搜索结果">
      <div className="search-results-header">
        <span>{searchResults.length} 个结果</span>
      </div>
      {searchResults.map((r) => (
        <button
          key={r.page_id}
          className="search-result-item"
          onClick={() => handleSelect(r.page_id, r.title)}
          role="listitem"
        >
          <span className="search-result-title">{r.title}</span>
          <span className="search-result-snippet">{r.snippet}</span>
        </button>
      ))}
    </div>
  );
}

export default SearchResults;
