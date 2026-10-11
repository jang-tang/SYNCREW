import type { MembershipStatus, SiteRole } from "../shared/api";
import type { Lang } from "../shared/languages";

/**
 * 실시간으로 알려야 하는 도메인 사건. Phase 3에서 Socket.IO 구현으로 교체한다
 * (membership:changed, join:requested — docs/realtime-protocol.md).
 * 반드시 DB 트랜잭션이 커밋된 뒤에 호출한다.
 */
export interface DomainEvents {
  membershipChanged(event: { siteId: string; userId: string; role: SiteRole; status: MembershipStatus }): void;
  joinRequested(event: { siteId: string; userId: string; displayName: string; lang: Lang }): void;
}

export const noopEvents: DomainEvents = {
  membershipChanged() {},
  joinRequested() {},
};
