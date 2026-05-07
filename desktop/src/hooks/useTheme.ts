import { useEffect } from "react";
import { useAppStore, ThemeMode } from "../store/appStore";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }
  return mode;
}

export function useTheme() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute("data-ldb-theme", resolved);
  }, [theme]);

  useEffect(() => {
    if (theme !== "auto") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = resolveTheme("auto");
      document.documentElement.setAttribute("data-ldb-theme", resolved);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
}
