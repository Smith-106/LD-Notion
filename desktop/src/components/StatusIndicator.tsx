import { useAppStore } from "../store/appStore";
import "./StatusIndicator.css";

const STATUS_LABELS: Record<string, string> = {
  connected: "MCP 已连接",
  disconnected: "MCP 未连接",
  error: "MCP 连接错误",
};

function StatusIndicator() {
  const mcpStatus = useAppStore((s) => s.mcpStatus);

  return (
    <div className={`status-indicator status-${mcpStatus}`}>
      <span className="status-dot" />
      <span className="status-label">{STATUS_LABELS[mcpStatus]}</span>
    </div>
  );
}

export default StatusIndicator;
