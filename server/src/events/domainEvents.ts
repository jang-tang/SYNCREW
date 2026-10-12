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
} from "../shared/api";
import type { Lang } from "../shared/languages";

export type MessageStatusEvent = {
  messageId: string;
  status: MessageStatus;
  translations: { lang: Lang; status: TranslationStatus; text?: string }[];
  recipients?: RecipientCounts;
};

/**
 * 실시간으로 알려야 하는 도메인 사건. 서버 시작 시 Socket.IO 구현(realtime/gateway.ts)으로 교체된다
 * (docs/realtime-protocol.md). 반드시 DB 트랜잭션이 커밋된 뒤에 호출한다.
 */
export interface DomainEvents {
  membershipChanged(event: { siteId: string; userId: string; role: SiteRole; status: MembershipStatus }): void;
  joinRequested(event: { siteId: string; userId: string; displayName: string; lang: Lang }): void;
  /** 수신자 1명에게 그 사람 언어로 된 메시지 (user:{id} 방) */
  messageNew(event: { userId: string; message: MessageView }): void;
  /** 발신자에게 처리 상태 (user:{id} 방) */
  messageStatus(event: { userId: string } & MessageStatusEvent): void;
  /** 지시 수신자 상태 변화(수신·확인·완료) → 현장 관리자들 */
  instructionRecipient(event: { siteId: string; messageId: string; userId: string; status: RecipientStatus }): void;
  /** 통화 수신·일괄 지시 시작 알림 (대상자 user: 방) */
  sessionInvite(event: { userId: string; session: LiveSession }): void;
  /** 세션 상태 변화 (참여자 전원) */
  sessionUpdated(event: { userIds: string[]; session: LiveSession }): void;
  /** 구성원 오디오 장치 상태 변화 (그 사람이 속한 현장들) */
  deviceChanged(event: { siteIds: string[]; userId: string; device: DeviceStatus | null }): void;
}

export const noopEvents: DomainEvents = {
  membershipChanged() {},
  joinRequested() {},
  messageNew() {},
  messageStatus() {},
  instructionRecipient() {},
  sessionInvite() {},
  sessionUpdated() {},
  deviceChanged() {},
};
