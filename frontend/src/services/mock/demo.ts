import { mockDb } from "./mockDb";

/** 데모 모드 전용: 관리자가 실시간 일괄 지시를 보내는 상황을 흉내 낸다 */
export const demoIncomingBroadcast = (siteId: string) => mockDb.simulateIncomingBroadcast(siteId);
