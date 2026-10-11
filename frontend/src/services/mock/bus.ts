import type { ServerEventName, ServerEventPayload } from "@shared/realtime";
import { newId } from "@/lib/id";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

/** 데모 모드에서 서버 → 앱 실시간 이벤트를 흉내 내는 버스 */
export const mockBus = {
  on(event: ServerEventName, handler: Handler) {
    const set = handlers.get(event) ?? new Set();
    set.add(handler);
    handlers.set(event, set);
    return () => set.delete(handler);
  },
  emit<E extends ServerEventName>(event: E, payload: Omit<ServerEventPayload<E>, "eventId" | "at">) {
    const full = { ...payload, eventId: newId(), at: new Date().toISOString() };
    handlers.get(event)?.forEach((handler) => handler(full));
  },
};
