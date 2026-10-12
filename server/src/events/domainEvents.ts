import type { MembershipStatus, MessageStatus, MessageView, RecipientCounts, SiteRole, TranslationStatus } from "../shared/api";
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
}

export const noopEvents: DomainEvents = {
  membershipChanged() {},
  joinRequested() {},
  messageNew() {},
  messageStatus() {},
};
