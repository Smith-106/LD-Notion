import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

const MCP_HEALTH_URL = "http://localhost:3000/health";
const POLL_INTERVAL_MS = 10_000;

export function useMcpStatus() {
  const setMcpStatus = useAppStore((s) => s.setMcpStatus);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(MCP_HEALTH_URL, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          setMcpStatus("connected");
        } else {
          setMcpStatus("error");
        }
      } catch {
        setMcpStatus("disconnected");
      }
    }

    check();
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [setMcpStatus]);
}
