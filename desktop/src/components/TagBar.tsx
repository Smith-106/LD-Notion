import { useState, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { updatePageTags, listTags } from "../services/api";
import "./TagBar.css";

export default function TagBar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const currentTags = useAppStore((s) => s.currentTags);
  const setCurrentTags = useAppStore((s) => s.setCurrentTags);
  const setWorkspaceTags = useAppStore((s) => s.setWorkspaceTags);
  const workspaceTags = useAppStore((s) => s.workspaceTags);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshWorkspaceTags = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const tags = await listTags(activeWorkspaceId);
      setWorkspaceTags(tags);
    } catch {}
  }, [activeWorkspaceId, setWorkspaceTags]);

  const handleAdd = useCallback(async (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || !currentPage || currentTags.includes(trimmed)) return;
    const next = [...currentTags, trimmed];
    setCurrentTags(next);
    setInput("");
    setShowSuggestions(false);
    try {
      await updatePageTags(currentPage.id, next);
      refreshWorkspaceTags();
    } catch {}
  }, [currentPage, currentTags, setCurrentTags, refreshWorkspaceTags]);

  const handleRemove = useCallback(async (tag: string) => {
    if (!currentPage) return;
    const next = currentTags.filter((t) => t !== tag);
    setCurrentTags(next);
    try {
      await updatePageTags(currentPage.id, next);
      refreshWorkspaceTags();
    } catch {}
  }, [currentPage, currentTags, setCurrentTags, refreshWorkspaceTags]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && input.trim()) {
        e.preventDefault();
        handleAdd(input);
      }
      if (e.key === "Backspace" && !input && currentTags.length > 0) {
        handleRemove(currentTags[currentTags.length - 1]);
      }
    },
    [input, currentTags, handleAdd, handleRemove],
  );

  const suggestions = showSuggestions && input.trim()
    ? workspaceTags
        .filter((t) => t.name.toLowerCase().includes(input.toLowerCase()))
        .filter((t) => !currentTags.includes(t.name))
        .slice(0, 5)
    : [];

  useEffect(() => {
    setInput("");
    setShowSuggestions(false);
  }, [currentPage?.id]);

  if (!currentPage) return null;

  return (
    <div className="tag-bar">
      {currentTags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            className="tag-chip-remove"
            onClick={() => handleRemove(tag)}
            aria-label={`移除标签 ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <div className="tag-input-wrapper">
        <input
          ref={inputRef}
          className="tag-input"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={currentTags.length === 0 ? "添加标签..." : ""}
        />
        {suggestions.length > 0 && (
          <div className="tag-suggestions">
            {suggestions.map((s) => (
              <button
                key={s.name}
                className="tag-suggestion-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAdd(s.name);
                }}
              >
                {s.name}
                <span className="tag-suggestion-count">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
