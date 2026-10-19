// 서버와 프론트엔드가 함께 쓰는 Socket.IO 계약. 외부 패키지를 import하지 않는다.
// 명세: docs/realtime-protocol.md
import type { Lang } from "./languages";
import type {
  DeviceStatus,
  LiveSession,
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
  /** 나에게 걸려 온 1:1 통화, 내가 수신 대상인 일괄 지시 시작 (user: 방) */
  "session:invite": (payload: Envelope & { session: LiveSession }) => void;
  /** 세션 상태·참여자 연결 변화 (참여자 전원의 user: 방) */
  "session:updated": (payload: Envelope & { session: LiveSession }) => void;
  /** 구성원 오디오 장치 상태 변화 (site: 방) */
  "device:changed": (payload: Envelope & { siteId: string; userId: string; device: DeviceStatus | null }) => void;
  "auth:expired": (payload: Envelope) => void;

  // ─── 스트리밍 통역 (1:1 통화, docs/streaming-plan.md 3절) ───
  /** 상대 말의 통역이 시작됨 (듣는 사람에게). 이후 같은 turnId 로 음성·자막 조각이 온다 */
  "stream:out:start": (payload: StreamTurnStart) => void;
  /** 통역 음성 조각: PCM16 mono, start 의 sampleRate. seq 는 턴 안에서 0부터 */
  "stream:out:audio": (payload: { turnId: string; seq: number; pcm: ArrayBuffer }) => void;
  /** 실시간 자막: original = 말한 사람 원문 전사(완성본), translation = 번역 자막 조각(delta) */
  "stream:out:text": (payload: { turnId: string; kind: "original" | "translation"; text: string }) => void;
  /** 턴 끝. done 이면 기록(messageId)이 저장되고 message:new 도 따로 온다. failed 면 이 턴 통역 실패 */
  "stream:out:end": (payload: { turnId: string; status: "done" | "failed"; messageId: string | null }) => void;
  /** 내 말(말한 사람에게): 원문 전사(완성본)·번역 자막 조각 — 말한 사람 화면에 바로 보여 준다 (기록 알림보다 먼저, 2026-10-19) */
  "stream:mine:text": (payload: { sessionId: string; turnId: string; kind: "original" | "translation"; text: string }) => void;
  /** 내 말의 턴 끝 (말한 사람에게). failed 면 이 말은 통역되지 않았다 → 다시 말하도록 안내 */
  "stream:mine:end": (payload: { sessionId: string; turnId: string; status: "done" | "failed" }) => void;
  /** 스트리밍을 계속할 수 없음 → 앱은 발화 단위 방식으로 바꾼다 (말한 사람에게) */
  "stream:fallback": (payload: Envelope & { sessionId: string; streamId: string; reason: StreamFallbackReason }) => void;
};

export type StreamTurnStart = {
  sessionId: string;
  turnId: string;
  fromUserId: string;
  /** 통역 음성·자막 언어 (듣는 사람 언어) */
  lang: Lang;
  sampleRate: number;
};

/** ENGINE_FAILED: OpenAI 세션이 반복해서 끊기거나 다시 열 수 없음 / BUDGET_EXCEEDED: 비용 한도. (통화가 끝나면 폴백 없이 조용히 닫힌다) */
export type StreamFallbackReason = "ENGINE_FAILED" | "BUDGET_EXCEEDED";

/** 단말이 보내는 음성 형식. 앱 기본 16kHz, 서버가 OpenAI 형식(24kHz)으로 바꾼다 */
export type StreamFormat = { encoding: "pcm16"; sampleRate: 16000 | 24000; channels: 1 };

export type StreamOpenResult =
  /** mode: interpret = OpenAI 통역, relay = 같은 언어라 음성을 그대로 전달 (자막·기록 없음) */
  | { ok: true; streamId: string; outputSampleRate: number; mode: "interpret" | "relay" }
  | { ok: false; code: StreamOpenError };

/**
 * NOT_FOUND: 세션 없음·비참여자 / CONFLICT: 진행 중이 아님 / UNSUPPORTED: 일괄 지시(발화 단위 방식 유지)·
 * 스트리밍 꺼짐 / BUSY: 동시 통역 세션 상한 / BUDGET_EXCEEDED / VALIDATION_ERROR / ENGINE_UNAVAILABLE
 */
export type StreamOpenError =
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNSUPPORTED"
  | "BUSY"
  | "BUDGET_EXCEEDED"
  | "VALIDATION_ERROR"
  | "ENGINE_UNAVAILABLE";

export type AckResult = { ok: true; updated?: number } | { ok: false; code: string };

export type ClientToServerEvents = {
  "site:subscribe": (payload: { siteId: string }, ack: (result: AckResult) => void) => void;
  "site:unsubscribe": (payload: { siteId: string }, ack: (result: AckResult) => void) => void;
  "receipt:delivered": (payload: { messageIds: string[] }, ack: (result: AckResult) => void) => void;
  /** 내 오디오 장치 상태 알림 (헤드셋 연결·마이크 권한). 바뀔 때마다 보낸다. */
  "device:status": (payload: DeviceStatus, ack: (result: AckResult) => void) => void;

  // ─── 스트리밍 통역 ───
  /** 통화 중 스트림 열기 (통화 시작 후 1번). 다시 연결되면 새로 연다 */
  "stream:open": (payload: { sessionId: string; format: StreamFormat }, ack: (result: StreamOpenResult) => void) => void;
  /** 음성 조각 (약 100ms). 단말 VAD 가 말소리라고 판단한 구간 + 앞뒤 여유만 보낸다. ack 없음 */
  "stream:audio": (payload: { streamId: string; seq: number; pcm: ArrayBuffer }) => void;
  /** 단말이 말이 멎었다고 판단 (뒤 여유까지 보낸 뒤): 서버가 그 턴을 바로 확정한다 */
  "stream:pause": (payload: { streamId: string }) => void;
  "stream:close": (payload: { streamId: string }, ack: (result: AckResult) => void) => void;
};

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
