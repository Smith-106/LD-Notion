import { useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import PageTree from "./PageTree";
import SearchBar from "./SearchBar";
import SearchResults from "./SearchResults";
import StatusIndicator from "./StatusIndicator";
import { useAppStore } from "../store/appStore";
import { useMcpStatus } from "../hooks/useMcpStatus";
import {
  listWorkspaces,
  createWorkspace,
  createPage,
  importPage,
  getPageTree,
  listTags,
  listRecentPages,
  listPinnedPages,
  togglePagePin,
  getPageContent,
} from "../services/api";
import "./Sidebar.css";

function Sidebar() {
  const collapseAll = useAppStore((s) => s.collapseAll);
  const workspaces = useAppStore((s) => s.workspaces);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const setPageTree = useAppStore((s) => s.setPageTree);
  const setWorkspaceTags = useAppStore((s) => s.setWorkspaceTags);
  const workspaceTags = useAppStore((s) => s.workspaceTags);
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const recentPages = useAppStore((s) => s.recentPages);
  const setRecentPages = useAppStore((s) => s.setRecentPages);
  const pinnedPages = useAppStore((s) => s.pinnedPages);
  const setPinnedPages = useAppStore((s) => s.setPinnedPages);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setCurrentTags = useAppStore((s) => s.setCurrentTags);
  const searchQuery = useAppStore((s) => s.searchQuery);
  useMcpStatus();

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, [setWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceTags([]);
      setTagFilter(null);
      setRecentPages([]);
      setPinnedPages([]);
      return;
    }
    listTags(activeWorkspaceId).then(setWorkspaceTags).catch(() => {});
    listRecentPages(activeWorkspaceId).then(setRecentPages).catch(() => {});
    listPinnedPages(activeWorkspaceId).then(setPinnedPages).catch(() => {});
  }, [activeWorkspaceId, setWorkspaceTags, setTagFilter, setRecentPages, setPinnedPages]);

  const handleCreateWorkspace = useCallback(async () => {
    const name = prompt("工作区名称:");
    if (!name?.trim()) return;
    try {
      const ws = await createWorkspace(name.trim());
      const updated = await listWorkspaces();
      setWorkspaces(updated);
      setActiveWorkspaceId(ws.id);
    } catch (err) {
      alert(`创建失败: ${err}`);
    }
  }, [setWorkspaces, setActiveWorkspaceId]);

  const handleCreatePage = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const title = prompt("页面标题:");
    if (!title?.trim()) return;
    try {
      await createPage(activeWorkspaceId, title.trim());
      const tree = await getPageTree(activeWorkspaceId);
      setPageTree(tree);
    } catch (err) {
      alert(`创建失败: ${err}`);
    }
  }, [activeWorkspaceId, setPageTree]);

  const handleImport = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const title = file.name.replace(/\.(md|markdown|txt)$/, "");
      try {
        await importPage(activeWorkspaceId, title, text);
        const tree = await getPageTree(activeWorkspaceId);
        setPageTree(tree);
      } catch (err) {
        alert(`导入失败: ${err}`);
      }
    };
    input.click();
  }, [activeWorkspaceId, setPageTree]);

  const handleQuickSelect = useCallback(async (pageId: string, title: string) => {
    try {
      const content = await getPageContent(pageId);
      setCurrentPage({ id: pageId, title: content.title, body: content.body, saved: true });
      setCurrentTags(content.tags);
    } catch {
      setCurrentPage({ id: pageId, title, body: "", saved: true });
      setCurrentTags([]);
    }
  }, [setCurrentPage, setCurrentTags]);

  const handleTogglePin = useCallback(async (pageId: string) => {
    try {
      await togglePagePin(pageId);
      if (activeWorkspaceId) {
        listPinnedPages(activeWorkspaceId).then(setPinnedPages).catch(() => {});
        listRecentPages(activeWorkspaceId).then(setRecentPages).catch(() => {});
      }
    } catch {}
  }, [activeWorkspaceId, setPinnedPages, setRecentPages]);

  return (
    <aside className="sidebar" role="navigation" aria-label="页面导航">
      <div className="sidebar-header">
        <span className="sidebar-header-title">页面</span>
        <div className="sidebar-header-actions">
          <button
            className="sidebar-action-btn"
            onClick={collapseAll}
            title="折叠全部"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 4L8 9L14 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M2 9L8 13L14 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <button
            className="sidebar-action-btn"
            onClick={handleCreatePage}
            title="新建页面"
            disabled={!activeWorkspaceId}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <button
            className="sidebar-action-btn"
            onClick={handleImport}
            title="导入 Markdown"
            disabled={!activeWorkspaceId}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1 1l3 3 2-2 3 3H4z" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* 工作区选择 */}
      <div className="sidebar-workspace-select">
        <select
          value={activeWorkspaceId ?? ""}
          onChange={(e) => setActiveWorkspaceId(e.target.value || null)}
          className="workspace-dropdown"
        >
          <option value="">选择工作区...</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
        <button
          className="sidebar-action-btn"
          onClick={handleCreateWorkspace}
          title="新建工作区"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
      </div>

      <SearchBar />
      {pinnedPages.length > 0 && (
        <div className="sidebar-section">
          <span className="sidebar-section-label">收藏</span>
          {pinnedPages.map((p) => (
            <button
              key={p.id}
              className="sidebar-quick-item"
              onClick={() => handleQuickSelect(p.id, p.title)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sidebar-pin-icon active">
                <path d="M8 1l2.2 4.5 5 .7-3.6 3.5.9 5L8 12.4 3.5 14.7l.9-5L.8 6.2l5-.7z" />
              </svg>
              <span className="sidebar-quick-title">{p.title}</span>
              <button
                className="sidebar-quick-unpin"
                onClick={(e) => { e.stopPropagation(); handleTogglePin(p.id); }}
                title="取消收藏"
              >
                ×
              </button>
            </button>
          ))}
        </div>
      )}
      {recentPages.length > 0 && (
        <div className="sidebar-section">
          <span className="sidebar-section-label">最近编辑</span>
          {recentPages.slice(0, 5).map((p) => (
            <button
              key={p.id}
              className="sidebar-quick-item"
              onClick={() => handleQuickSelect(p.id, p.title)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sidebar-clock-icon">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              <span className="sidebar-quick-title">{p.title}</span>
              {!p.is_pinned && (
                <button
                  className="sidebar-quick-pin"
                  onClick={(e) => { e.stopPropagation(); handleTogglePin(p.id); }}
                  title="收藏"
                >
                  ☆
                </button>
              )}
            </button>
          ))}
        </div>
      )}
      {workspaceTags.length > 0 && (
        <div className="sidebar-tags">
          <button
            className={`sidebar-tag-chip ${!tagFilter ? "sidebar-tag-chip-active" : ""}`}
            onClick={() => setTagFilter(null)}
          >
            全部
          </button>
          {workspaceTags.map((t) => (
            <button
              key={t.name}
              className={`sidebar-tag-chip ${tagFilter === t.name ? "sidebar-tag-chip-active" : ""}`}
              onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
            >
              {t.name}
              <span className="sidebar-tag-count">{t.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="page-tree-wrapper">
        {searchQuery.trim().length >= 2 ? <SearchResults /> : <PageTree />}
      </div>
      <div className="sidebar-footer">
        <StatusIndicator />
        <Link to="/settings" className="sidebar-settings-link">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M7.5.5l.5.5.5-.5.5.5V2.3c.3.1.6.3.9.5l1.3-.7.7.7-.7 1.3c.2.3.4.6.5.9H13l.5.5v1l-.5.5h-1.3c-.1.3-.3.6-.5.9l.7 1.3-.7.7-1.3-.7c-.3.2-.6.4-.9.5v1.3l-.5.5h-1l-.5-.5v-1.3c-.3-.1-.6-.3-.9-.5l-1.3.7-.7-.7.7-1.3c-.2-.3-.4-.6-.5-.9H3l-.5-.5v-1l.5-.5h1.3c.1-.3.3-.6.5-.9l-.7-1.3.7-.7 1.3.7c.3-.2.6-.4.9-.5V.5H7.5z" clipRule="evenodd" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>设置</span>
        </Link>
      </div>
    </aside>
  );
}

export default Sidebar;
