import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { HealthResponse } from "@shared/api";
import { apiFetch, ApiError } from "@/api/client";

export type ServerStatus = "checking" | "online" | "degraded" | "offline";

export type ServerHealth = {
  status: ServerStatus;
  health?: HealthResponse;
  error?: string;
  checkedAt?: Date;
  refresh: () => void;
};

const POLL_INTERVAL_MS = 15_000;

const ServerHealthContext = createContext<ServerHealth | null>(null);

/** 서버 /health 를 앱 전역에서 한 번만 주기적으로 확인한다. 앱이 다시 활성화되면 즉시 확인한다. */
export function ServerHealthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<ServerHealth, "refresh">>({ status: "checking" });
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // 서버는 DB 오류 시 503과 함께 상태 본문을 보낸다.
      const health = await apiFetch<HealthResponse>("/health", { acceptStatuses: [503] });
      setState({ status: health.status === "ok" ? "online" : "degraded", health, checkedAt: new Date() });
    } catch (error) {
      setState({
        status: "offline",
        error: error instanceof ApiError ? error.message : String(error),
        checkedAt: new Date(),
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [check]);

  const refresh = useCallback(() => void check(), [check]);

  return <ServerHealthContext.Provider value={{ ...state, refresh }}>{children}</ServerHealthContext.Provider>;
}

export function useServerHealth(): ServerHealth {
  const value = useContext(ServerHealthContext);
  if (!value) throw new Error("useServerHealth는 ServerHealthProvider 안에서만 사용할 수 있습니다.");
  return value;
}
