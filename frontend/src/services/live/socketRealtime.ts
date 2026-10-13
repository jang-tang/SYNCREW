import { io, type Socket } from "socket.io-client";
import type { DeviceStatus } from "@shared/api";
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

  // 마지막으로 알린 장치 상태: 다시 연결되면 서버에 다시 보낸다 (서버는 연결이 끊기면 지운다).
  let lastDevice: DeviceStatus | null = null;
  socket.on("connect", () => {
    emitState("connected");
    if (lastDevice) void socket.timeout(ACK_TIMEOUT_MS).emitWithAck("device:status", lastDevice).catch(() => undefined);
  });
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
    async reportDevice(device) {
      lastDevice = device;
      if (!socket.connected) return;
      await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("device:status", device);
    },
    async openStream(sessionId, format) {
      if (!socket.connected) return { ok: false, code: "ENGINE_UNAVAILABLE" };
      try {
        // 엔진(OpenAI 세션) 여는 시간을 고려해 넉넉히
        return await socket.timeout(15_000).emitWithAck("stream:open", { sessionId, format });
      } catch {
        return { ok: false, code: "ENGINE_UNAVAILABLE" };
      }
    },
    sendStreamAudio(streamId, seq, pcm) {
      // 끊긴 동안 쌓아 두면 다시 연결될 때 한꺼번에 몰려가므로 버린다 (서버 스트림도 연결이 끊기면 닫힌다).
      // volatile 은 쓰지 않는다: 소켓이 앞 조각을 보내는 중이면 버려서 말 앞부분이 사라졌다 (2026-10-14 실제 OpenAI 확인에서 발견)
      if (socket.connected) socket.emit("stream:audio", { streamId, seq, pcm });
    },
    pauseStream(streamId) {
      if (socket.connected) socket.emit("stream:pause", { streamId });
    },
    closeStream(streamId) {
      if (socket.connected) socket.emit("stream:close", { streamId }, () => undefined);
    },
  };
}
