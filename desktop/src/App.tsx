import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import EditorPage from "./pages/EditorPage";
import SettingsPage from "./pages/SettingsPage";
import ThemeToggle from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";
import "./App.css";

function App() {
  useTheme();

  return (
    <div className="app-shell">
      <header className="app-header" role="banner">
        <div className="header-left">
          <span className="app-logo">LD-Notion Hub</span>
        </div>
        <div className="header-right">
          <ThemeToggle />
        </div>
      </header>
      <div className="app-body">
        <Sidebar />
        <main className="editor-area" role="main">
          <Routes>
            <Route path="/" element={<EditorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
