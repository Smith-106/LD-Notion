import { useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import PageTree from "./PageTree";
import SearchBar from "./SearchBar";
import StatusIndicator from "./StatusIndicator";
import { useAppStore } from "../store/appStore";
import { useMcpStatus } from "../hooks/useMcpStatus";
import {
  listWorkspaces,
  createWorkspace,
  createPage,
  getPageTree,
} from "../services/api";
import "./Sidebar.css";

function Sidebar() {
  const collapseAll = useAppStore((s) => s.collapseAll);
  const workspaces = useAppStore((s) => s.workspaces);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const setPageTree = useAppStore((s) => s.setPageTree);
  useMcpStatus();

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, [setWorkspaces]);

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
      <div className="page-tree-wrapper">
        <PageTree />
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
