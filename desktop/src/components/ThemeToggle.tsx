import { useAppStore, ThemeMode } from "../store/appStore";
import "./ThemeToggle.css";

const MODES: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "auto", label: "自动", icon: "A" },
  { mode: "light", label: "亮色", icon: "☀" },
  { mode: "dark", label: "暗色", icon: "☾" },
];

function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="主题切换">
      {MODES.map(({ mode, label, icon }) => (
        <button
          key={mode}
          className={`theme-toggle-btn ${theme === mode ? "active" : ""}`}
          onClick={() => setTheme(mode)}
          role="radio"
          aria-checked={theme === mode}
          aria-label={label}
          title={label}
        >
          <span className="theme-toggle-icon">{icon}</span>
          <span className="theme-toggle-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default ThemeToggle;
