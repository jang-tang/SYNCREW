-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "session_id" UUID;

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "conversation_id" UUID,
    "started_by" UUID NOT NULL,
    "end_reason" TEXT,
    "ended_by" UUID,
    "answered_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_session_participants" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "live_session_participants_pkey" PRIMARY KEY ("session_id","user_id")
);

-- CreateIndex
CREATE INDEX "live_sessions_site_id_mode_created_at_idx" ON "live_sessions"("site_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "live_sessions_status_idx" ON "live_sessions"("status");

-- CreateIndex
CREATE INDEX "live_session_participants_user_id_idx" ON "live_session_participants"("user_id");

-- CreateIndex
CREATE INDEX "messages_session_id_seq_idx" ON "messages"("session_id", "seq");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_participants" ADD CONSTRAINT "live_session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 값 제약 (docs/database-design.md)
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_mode_check" CHECK ("mode" IN ('call', 'broadcast'));
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_status_check" CHECK ("status" IN ('ringing', 'active', 'ended'));
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_end_check" CHECK (("status" = 'ended') = ("ended_at" IS NOT NULL));
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_reason_check" CHECK ("end_reason" IS NULL OR "end_reason" IN ('hangup', 'declined', 'missed', 'cancelled', 'connection_lost', 'removed'));
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_call_conversation_check" CHECK ("mode" <> 'call' OR "conversation_id" IS NOT NULL);
ALTER TABLE "live_session_participants" ADD CONSTRAINT "live_session_participants_role_check" CHECK ("role" IN ('caller', 'callee', 'speaker', 'listener'));
