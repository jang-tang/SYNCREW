// 서버와 프론트엔드가 함께 쓰는 REST 계약. 외부 패키지를 import하지 않는다.
// 명세: docs/api-specification.md
import type { Lang } from "./languages";

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PROFILE_REQUIRED",
  "ALREADY_MEMBER",
  "INVALID_JOIN_CODE",
  "OPENAI_NOT_CONFIGURED",
  "BUDGET_EXCEEDED",
  "BUSY",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string };
};

export type HealthResponse = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  openai: "configured" | "not_configured";
  dataset: { name: string; version: string; lexicon: number; phrases: number };
  /** 개발 환경에서만 포함된다. */
  budget?: { limitUsd: number; spentUsd: number; remainingUsd: number; period: "month" | "total" };
};

// ─── 내 정보 ─────────────────────────────────────────

export type Profile = {
  id: string;
  email: string;
  displayName: string;
  preferredLang: Lang;
  autoPlay: boolean;
  /** 0.5 – 1.5 */
  speechRate: number;
};

export type ProfileInput = {
  displayName: string;
  preferredLang: Lang;
  autoPlay?: boolean;
  speechRate?: number;
};

// ─── 현장과 멤버 ─────────────────────────────────────

export type SiteRole = "manager" | "member";
export type MembershipStatus = "pending" | "active" | "rejected" | "removed";

export type Site = {
  id: string;
  name: string;
  address: string | null;
  status: "active" | "archived";
};

/** GET /me/sites */
export type MySite = Site & {
  role: SiteRole;
  membershipStatus: MembershipStatus;
  memberCount: number;
};

export type SiteInput = { name: string; address?: string };

export type Member = {
  userId: string;
  displayName: string;
  role: SiteRole;
  status: MembershipStatus;
  /** 현장 내 언어 (lang_override 또는 preferred_lang) */
  lang: Lang;
  online: boolean;
  /** 앱이 마지막으로 알린 오디오 장치 상태 (접속 중일 때만, 없으면 null) */
  device: DeviceStatus | null;
};

/** 단말 오디오 상태. 앱이 실시간 연결로 서버에 알린다 (device:status). */
export type DeviceStatus = {
  /** 통역 음성이 나가는 경로: bluetooth(헤드셋) / wired(유선) / builtin(휴대폰 스피커·마이크) / unknown(확인 불가) */
  audioRoute: "bluetooth" | "wired" | "builtin" | "unknown";
  /** 사용 중인 입력 장치 이름 (예: 헤드셋 이름) */
  inputName: string | null;
  micPermission: "granted" | "denied" | "undetermined";
};

export type MemberAction =
  | { action: "approve" | "reject" | "remove" }
  | { langOverride: Lang | null };

export type JoinCode = {
  id: string;
  code: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  /** syncrew://join?code=XXXX */
  qrPayload: string;
};

export type JoinCodeInput = { expiresInHours?: number; maxUses?: number };

export type JoinResult = { siteId: string; siteName: string; status: MembershipStatus };

// ─── 대화와 메시지 ───────────────────────────────────

export type ConversationType = "direct" | "group";
export type MessageKind = "direct" | "group" | "instruction";
export type MessageStatus = "queued" | "processing" | "done" | "partially_failed" | "failed";
export type TranslationStatus = "pending" | "processing" | "done" | "failed" | "skipped";
export type RecipientStatus = "pending" | "sent" | "delivered" | "acknowledged" | "completed" | "failed";

export type ConversationSummary = {
  id: string;
  type: ConversationType;
  /** group: 현장 이름, direct: 상대 이름 */
  title: string;
  /** direct일 때 상대 */
  peer?: { userId: string; displayName: string; lang: Lang };
  participantCount: number;
  lastMessage?: { text: string; senderName: string; createdAt: string };
  unreadCount: number;
};

/** 조회하는 사람 기준으로 만든 메시지 */
export type MessageView = {
  id: string;
  kind: MessageKind;
  siteId: string;
  conversationId: string | null;
  seq: number;
  senderId: string;
  senderName: string;
  sourceLang: Lang;
  /** 발신자가 말한 원문 (보정 전) */
  originalText: string | null;
  /** 조회자 언어로 된 문장. 처리 중이면 null */
  text: string | null;
  /** 조회자 언어 번역 음성 */
  audioUrl: string | null;
  status: MessageStatus;
  requiresAck: boolean;
  createdAt: string;
  /** 발신자가 볼 때만: 언어별 번역 상태 */
  translations?: { lang: Lang; status: TranslationStatus }[];
  /** 수신자가 볼 때만: 내 전달 상태 */
  myStatus?: RecipientStatus;
  /** 실시간 통역 세션(1:1 통화·일괄 지시) 중 발화면 세션 id, 직접 입력한 메시지는 null */
  sessionId: string | null;
};

export type SendTextInput = { clientMessageId: string; text: string };
export type SendAudioInput = { clientMessageId: string; audioUri: string; mimeType: string };
export type SendResult = { messageId: string; status: MessageStatus };

// ─── 일괄 지시 ───────────────────────────────────────

export type RecipientCounts = Record<RecipientStatus, number>;

export type InstructionTarget = "all" | { userIds: string[] };

/** 일괄 지시 작업조 (B2): 자주 쓰는 대상 묶음. 현장 관리자끼리 공유. userIds 는 지금 활성 멤버만 */
export type TargetGroup = {
  id: string;
  name: string;
  userIds: string[];
  createdBy: string;
  updatedAt: string;
};

/** 만들기: name·userIds 필수 / 수정: 바꿀 것만 */
export type TargetGroupInput = { name: string; userIds: string[] };

export type InstructionSummary = {
  id: string;
  /** 실시간 일괄 지시 중 발화면 세션 id, 직접 작성한 지시는 null */
  sessionId: string | null;
  senderName: string;
  text: string;
  sourceLang: Lang;
  status: MessageStatus;
  requiresAck: boolean;
  createdAt: string;
  total: number;
  counts: RecipientCounts;
};

export type InstructionRecipient = {
  userId: string;
  displayName: string;
  lang: Lang;
  status: RecipientStatus;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  responseNote: string | null;
};

export type InstructionDetail = InstructionSummary & {
  recipients: InstructionRecipient[];
  translations: { lang: Lang; status: TranslationStatus; text: string | null }[];
};

/** 구성원이 받은 지시 */
export type InboxItem = MessageView & {
  myStatus: RecipientStatus;
  acknowledgedAt: string | null;
  completedAt: string | null;
};

// ─── 실시간 통역 세션 (1:1 통화, 관리자 일괄 지시) ──────
// docs/live-interpretation.md

/** call: 1:1 통역 통화 / broadcast: 관리자 → 여러 구성원 실시간 일괄 지시 */
export type SessionMode = "call" | "broadcast";
export type SessionStatus = "ringing" | "active" | "ended";
export type SessionEndReason = "hangup" | "declined" | "missed" | "cancelled" | "connection_lost" | "removed";
export type SessionRole = "caller" | "callee" | "speaker" | "listener";

export type SessionParticipant = {
  userId: string;
  displayName: string;
  lang: Lang;
  role: SessionRole;
  /** 실시간 연결 여부 */
  online: boolean;
  device: DeviceStatus | null;
  joinedAt: string | null;
  leftAt: string | null;
};

export type LiveSession = {
  id: string;
  siteId: string;
  mode: SessionMode;
  status: SessionStatus;
  /** call: 1:1 대화 id (통화 발화가 이 대화 기록에 남는다) */
  conversationId: string | null;
  startedBy: string;
  startedByName: string;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: SessionEndReason | null;
  participants: SessionParticipant[];
};

/** 세션 발화 1건 (음성). 텍스트 입력은 기존 메시지 전송을 쓴다. */
export type SendUtteranceInput = { clientMessageId: string; audioUri: string; mimeType: string };

// ─── 동기화 ──────────────────────────────────────────

export type SyncResponse = {
  cursor: string;
  conversations: ConversationSummary[];
  messages: MessageView[];
  memberships: { siteId: string; status: MembershipStatus; role: SiteRole }[];
};
