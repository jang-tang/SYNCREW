// 서버와 프론트엔드가 함께 쓰는 Socket.IO 계약. 외부 패키지를 import하지 않는다.
// 명세: docs/realtime-protocol.md
import type { Lang } from "./languages";
import type {
  MembershipStatus,
  MessageStatus,
  MessageView,
  RecipientCounts,
  RecipientStatus,
  SiteRole,
  TranslationStatus,
} from "./api";

export const REALTIME_NAMESPACE = "/rt";

type Envelope = { eventId: string; at: string };

export type ServerToClientEvents = {
  "message:new": (payload: Envelope & { message: MessageView }) => void;
  "message:status": (
    payload: Envelope & {
      messageId: string;
      status: MessageStatus;
      translations: { lang: Lang; status: TranslationStatus; text?: string }[];
      recipients?: RecipientCounts;
    },
  ) => void;
  "instruction:recipient": (
    payload: Envelope & { messageId: string; userId: string; status: RecipientStatus },
  ) => void;
  "membership:changed": (
    payload: Envelope & { siteId: string; userId: string; role: SiteRole; status: MembershipStatus },
  ) => void;
  "join:requested": (
    payload: Envelope & { siteId: string; userId: string; displayName: string; lang: Lang },
  ) => void;
  "presence:changed": (payload: Envelope & { userId: string; online: boolean }) => void;
  "sync:required": (payload: Envelope & { siteId?: string }) => void;
  "auth:expired": (payload: Envelope) => void;
};

export type AckResult = { ok: true; updated?: number } | { ok: false; code: string };

export type ClientToServerEvents = {
  "site:subscribe": (payload: { siteId: string }, ack: (result: AckResult) => void) => void;
  "site:unsubscribe": (payload: { siteId: string }, ack: (result: AckResult) => void) => void;
  "receipt:delivered": (payload: { messageIds: string[] }, ack: (result: AckResult) => void) => void;
};

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
