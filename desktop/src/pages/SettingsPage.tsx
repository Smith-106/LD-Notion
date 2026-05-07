import { Link } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle";
import StatusIndicator from "../components/StatusIndicator";
import "./SettingsPage.css";

function SettingsPage() {
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
        {/* 工作区管理 */}
        <section className="settings-section">
          <h2 className="settings-section-title">工作区管理</h2>
          <p className="settings-section-desc">
            管理本地工作区目录，工作区包含所有页面数据和配置。
          </p>
          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">当前工作区</label>
              <div className="settings-field-row">
                <code className="settings-path">~/ld-notion-workspace</code>
                <button className="settings-btn settings-btn-secondary">
                  更改
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-label">存储使用</label>
              <div className="settings-usage">
                <div className="settings-usage-bar">
                  <div className="settings-usage-fill" style={{ width: "12%" }} />
                </div>
                <span className="settings-usage-text">128 MB / 1 GB</span>
              </div>
            </div>
          </div>
        </section>

        {/* MCP 端点配置 */}
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
              <label className="settings-label">服务地址</label>
              <input
                className="settings-input"
                type="text"
                defaultValue="http://localhost:9876"
                readOnly
              />
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

        {/* 主题 */}
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

        {/* 关于 */}
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
                <span className="settings-about-value">v0.3.2</span>
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
