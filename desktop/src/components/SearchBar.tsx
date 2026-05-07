import { useRef, useCallback, useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { searchPages } from "../services/api";
import "./SearchBar.css";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

function SearchBar() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setSearchResults = useAppStore((s) => s.setSearchResults);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchQuery(q);

      if (timerRef.current) clearTimeout(timerRef.current);

      if (q.trim().length < MIN_QUERY_LEN) {
        setSearchResults([]);
        return;
      }

      timerRef.current = setTimeout(() => {
        searchPages(q.trim())
          .then((results) => setSearchResults(results))
          .catch(() => setSearchResults([]));
      }, DEBOUNCE_MS);
    },
    [setSearchQuery, setSearchResults],
  );

  const handleClear = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
  }, [setSearchQuery, setSearchResults]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="search-bar-container">
      <svg className="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z" clipRule="evenodd" />
      </svg>
      <input
        className="search-input"
        type="text"
        placeholder="搜索页面..."
        value={searchQuery}
        onChange={handleChange}
      />
      {searchQuery && (
        <button
          className="search-clear-btn"
          onClick={handleClear}
          aria-label="清除搜索"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default SearchBar;
