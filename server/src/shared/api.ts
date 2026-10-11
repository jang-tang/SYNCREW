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
};

export type SendTextInput = { clientMessageId: string; text: string };
export type SendAudioInput = { clientMessageId: string; audioUri: string; mimeType: string };
export type SendResult = { messageId: string; status: MessageStatus };

// ─── 일괄 지시 ───────────────────────────────────────

export type RecipientCounts = Record<RecipientStatus, number>;

export type InstructionTarget = "all" | { userIds: string[] };

export type InstructionSummary = {
  id: string;
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

// ─── 동기화 ──────────────────────────────────────────

export type SyncResponse = {
  cursor: string;
  conversations: ConversationSummary[];
  messages: MessageView[];
  memberships: { siteId: string; status: MembershipStatus; role: SiteRole }[];
};
