import { useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle";
import StatusIndicator from "../components/StatusIndicator";
import { useAppStore } from "../store/appStore";
import { listWorkspaces, deleteWorkspace } from "../services/api";
import "./SettingsPage.css";

function SettingsPage() {
  const workspaces = useAppStore((s) => s.workspaces);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    listWorkspaces().then(setWorkspaces).catch(() => {});
  }, [setWorkspaces]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`删除工作区「${name}」及其所有页面？此操作不可撤销。`)) return;
    try {
      await deleteWorkspace(id);
      const updated = await listWorkspaces();
      setWorkspaces(updated);
      if (activeWorkspaceId === id) setActiveWorkspaceId(null);
    } catch (err) {
      alert(`删除失败: ${err}`);
    }
  }, [activeWorkspaceId, setActiveWorkspaceId, setWorkspaces]);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Link to="/" className="settings-back-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>返回</span>
        </Link>
        <h1 className="settings-title">设置</h1>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2 className="settings-section-title">工作区管理</h2>
          <p className="settings-section-desc">
            管理本地工作区，每个工作区包含独立的页面数据。
          </p>
          <div className="settings-card">
            {workspaces.length === 0 ? (
              <p className="settings-section-desc">暂无工作区</p>
            ) : (
              <div className="settings-workspace-list">
                {workspaces.map((ws) => (
                  <div key={ws.id} className="settings-workspace-item">
                    <div className="settings-workspace-info">
                      <span className="settings-workspace-name">{ws.name}</span>
                      <span className="settings-workspace-meta">
                        {ws.root_path}
                      </span>
                    </div>
                    <button
                      className="settings-btn settings-btn-danger"
                      onClick={() => handleDelete(ws.id, ws.name)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">MCP 端点配置</h2>
          <p className="settings-section-desc">
            配置 Model Context Protocol 服务端点，用于 AI 助手与知识库的连接。
          </p>
          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">连接状态</label>
              <StatusIndicator />
            </div>
            <div className="settings-field">
              <label className="settings-label">健康检查端点</label>
              <input
                className="settings-input"
                type="text"
                defaultValue="/health"
                readOnly
              />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">外观</h2>
          <p className="settings-section-desc">
            选择桌面应用的主题模式。
          </p>
          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">主题模式</label>
              <ThemeToggle />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">关于</h2>
          <div className="settings-card">
            <div className="settings-about">
              <div className="settings-about-row">
                <span className="settings-about-key">应用名称</span>
                <span className="settings-about-value">LD-Notion Hub</span>
              </div>
              <div className="settings-about-row">
                <span className="settings-about-key">版本</span>
                <span className="settings-about-value">v0.5.1</span>
              </div>
              <div className="settings-about-row">
                <span className="settings-about-key">技术栈</span>
                <span className="settings-about-value">Tauri v2 + React 18 + Rust</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;
