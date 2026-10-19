import type { ConnectionState } from "@/stores/session";
import type { RealtimeService } from "../types";
import { mockBus } from "./bus";
import { mockDb } from "./mockDb";

export function createMockRealtime(): RealtimeService {
  const listeners = new Set<(state: ConnectionState) => void>();
  const emit = (state: ConnectionState) => listeners.forEach((listener) => listener(state));

  return {
    connect() {
      emit("connecting");
      setTimeout(() => emit("connected"), 400);
    },
    disconnect() {
      emit("idle");
    },
    async subscribeSite() {},
    on(event, handler) {
      return mockBus.on(event, handler as (payload: unknown) => void);
    },
    onConnection(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async sendReceipts(messageIds) {
      mockDb.markDelivered(messageIds);
    },
    async reportDevice(device) {
      const me = mockDb.users.get("me");
      if (me) me.device = device;
    },
    // 데모 모드는 스트리밍을 흉내 내지 않는다 → 통화 화면은 발화 단위 방식(데모 발화 버튼)으로 동작
    async openStream() {
      return { ok: false, code: "UNSUPPORTED" };
    },
    sendStreamAudio() {},
    pauseStream() {},
    reportStreamPlaying() {},
    closeStream() {},
  };
}
