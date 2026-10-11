import { io, type Socket } from "socket.io-client";
import { REALTIME_NAMESPACE, type ClientToServerEvents, type ServerToClientEvents } from "@shared/realtime";
import { API_BASE_URL } from "@/config";
import type { ConnectionState } from "@/stores/session";
import type { AuthService, RealtimeService } from "../types";

const ACK_TIMEOUT_MS = 5000;

/** docs/realtime-protocol.md 의 Socket.IO 연결 */
export function createSocketRealtime(auth: AuthService): RealtimeService {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(`${API_BASE_URL}${REALTIME_NAMESPACE}`, {
    autoConnect: false,
    transports: ["websocket"],
    // 연결·재연결 때마다 최신 토큰을 보낸다.
    auth: (callback) => {
      void auth.getSession().then((session) => callback({ token: session?.accessToken ?? "" }));
    },
  });

  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const emitState = (state: ConnectionState) => connectionListeners.forEach((listener) => listener(state));

  socket.on("connect", () => emitState("connected"));
  socket.on("disconnect", () => emitState("offline"));
  socket.on("connect_error", () => emitState("offline"));
  socket.io.on("reconnect_attempt", () => emitState("connecting"));
  // 토큰 만료: 연결을 끊고 새 토큰으로 다시 연결
  socket.on("auth:expired", () => {
    socket.disconnect();
    socket.connect();
  });

  return {
    connect() {
      emitState("connecting");
      socket.connect();
    },
    disconnect() {
      socket.disconnect();
      emitState("idle");
    },
    async subscribeSite(siteId) {
      await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("site:subscribe", { siteId });
    },
    on(event, handler) {
      socket.on(event, handler as never);
      return () => {
        socket.off(event, handler as never);
      };
    },
    onConnection(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    async sendReceipts(messageIds) {
      if (messageIds.length === 0 || !socket.connected) return;
      await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("receipt:delivered", { messageIds });
    },
  };
}
