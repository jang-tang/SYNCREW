-- 현장 전체 연결 (2026-10-27): 현장 사람 여럿이 함께 쓰는 실시간 통역 연결. 현장 그룹 대화에 기록이 남는다.
--   mode 'group' 추가, 참여 역할 'participant' 추가
--   현장마다 열린 현장 전체 연결은 하나 (두 사람이 동시에 시작해도 하나만 생기고, 늦은 쪽은 그 연결에 들어간다)
ALTER TABLE "live_sessions" DROP CONSTRAINT "live_sessions_mode_check";
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_mode_check" CHECK ("mode" IN ('call', 'broadcast', 'group'));
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_group_conversation_check" CHECK ("mode" <> 'group' OR "conversation_id" IS NOT NULL);
ALTER TABLE "live_session_participants" DROP CONSTRAINT "live_session_participants_role_check";
ALTER TABLE "live_session_participants" ADD CONSTRAINT "live_session_participants_role_check" CHECK ("role" IN ('caller', 'callee', 'speaker', 'listener', 'participant'));
CREATE UNIQUE INDEX "live_sessions_one_open_group" ON "live_sessions" ("site_id") WHERE "mode" = 'group' AND "status" <> 'ended';
