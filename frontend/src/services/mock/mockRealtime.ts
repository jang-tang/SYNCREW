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
  };
}
