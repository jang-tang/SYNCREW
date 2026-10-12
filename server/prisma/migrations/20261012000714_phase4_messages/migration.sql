-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "last_read_seq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "conversation_id" UUID,
    "kind" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "client_message_id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "input_type" TEXT NOT NULL,
    "input_audio_path" TEXT,
    "source_lang" TEXT NOT NULL,
    "raw_text" TEXT,
    "corrected_text" TEXT,
    "glossary_hits" JSONB NOT NULL DEFAULT '[]',
    "requires_ack" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "timings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "target_lang" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "translated_text" TEXT,
    "audio_path" TEXT,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "timings" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_recipients" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_lang" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "response_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_recipients_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateIndex
CREATE INDEX "messages_conversation_id_seq_idx" ON "messages"("conversation_id", "seq");

-- CreateIndex
CREATE INDEX "messages_site_id_kind_created_at_idx" ON "messages"("site_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sender_id_client_message_id_key" ON "messages"("sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_translations_message_id_target_lang_key" ON "message_translations"("message_id", "target_lang");

-- CreateIndex
CREATE INDEX "message_recipients_user_id_status_idx" ON "message_recipients"("user_id", "status");

-- CreateIndex
CREATE INDEX "message_recipients_user_id_updated_at_idx" ON "message_recipients"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 값 제약 (docs/database-design.md)
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_check" CHECK ("kind" IN ('direct', 'group', 'instruction'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_conversation_check" CHECK (("kind" = 'instruction') = ("conversation_id" IS NULL));
ALTER TABLE "messages" ADD CONSTRAINT "messages_input_type_check" CHECK ("input_type" IN ('text', 'audio'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_input_audio_check" CHECK (("input_type" = 'audio') = ("input_audio_path" IS NOT NULL));
ALTER TABLE "messages" ADD CONSTRAINT "messages_lang_check" CHECK ("source_lang" IN ('ko', 'zh', 'vi', 'uz', 'ru'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_status_check" CHECK ("status" IN ('queued', 'processing', 'done', 'partially_failed', 'failed'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_check" CHECK (char_length("client_message_id") BETWEEN 1 AND 64);

ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_lang_check" CHECK ("target_lang" IN ('ko', 'zh', 'vi', 'uz', 'ru'));
ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'skipped'));
ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_attempts_check" CHECK ("attempts" >= 0);

ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_lang_check" CHECK ("target_lang" IN ('ko', 'zh', 'vi', 'uz', 'ru'));
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_status_check" CHECK ("status" IN ('pending', 'sent', 'delivered', 'acknowledged', 'completed', 'failed'));
