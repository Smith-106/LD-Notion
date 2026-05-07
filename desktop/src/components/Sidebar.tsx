import { Link } from "react-router-dom";
import PageTree from "./PageTree";
import SearchBar from "./SearchBar";
import StatusIndicator from "./StatusIndicator";
import { useAppStore } from "../store/appStore";
import { useMcpStatus } from "../hooks/useMcpStatus";
import "./Sidebar.css";

function Sidebar() {
  const collapseAll = useAppStore((s) => s.collapseAll);
  useMcpStatus();

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
          <button className="sidebar-action-btn" title="新建页面">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        </div>
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
