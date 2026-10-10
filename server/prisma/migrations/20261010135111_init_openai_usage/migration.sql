-- CreateTable
CREATE TABLE "openai_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_text_tokens" INTEGER NOT NULL DEFAULT 0,
    "input_audio_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_text_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_audio_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "openai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openai_usage_created_at_idx" ON "openai_usage"("created_at");
