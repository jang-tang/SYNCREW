-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "preferred_lang" TEXT NOT NULL,
    "auto_play" BOOLEAN NOT NULL DEFAULT true,
    "speech_rate" REAL NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lang_override" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_join_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_join_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "direct_key" TEXT,
    "title" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateIndex
CREATE INDEX "site_memberships_user_id_status_idx" ON "site_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "site_memberships_site_id_status_idx" ON "site_memberships"("site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "site_memberships_site_id_user_id_key" ON "site_memberships"("site_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_join_codes_code_key" ON "site_join_codes"("code");

-- CreateIndex
CREATE INDEX "site_join_codes_site_id_idx" ON "site_join_codes"("site_id");

-- CreateIndex
CREATE INDEX "conversations_site_id_idx" ON "conversations"("site_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- AddForeignKey
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_join_codes" ADD CONSTRAINT "site_join_codes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Prisma 스키마로 표현할 수 없는 제약조건 (docs/database-design.md) ───
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_lang_check" CHECK ("preferred_lang" IN ('ko', 'zh', 'vi', 'uz', 'ru'));
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_name_check" CHECK (char_length("display_name") BETWEEN 1 AND 40);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_rate_check" CHECK ("speech_rate" BETWEEN 0.5 AND 1.5);

ALTER TABLE "sites" ADD CONSTRAINT "sites_status_check" CHECK ("status" IN ('active', 'archived'));
ALTER TABLE "sites" ADD CONSTRAINT "sites_name_check" CHECK (char_length("name") BETWEEN 1 AND 60);

ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_role_check" CHECK ("role" IN ('manager', 'member'));
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_status_check" CHECK ("status" IN ('pending', 'active', 'rejected', 'removed'));
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_lang_check" CHECK ("lang_override" IS NULL OR "lang_override" IN ('ko', 'zh', 'vi', 'uz', 'ru'));

ALTER TABLE "site_join_codes" ADD CONSTRAINT "site_join_codes_code_check" CHECK ("code" ~ '^[A-Z0-9]{8}$');
ALTER TABLE "site_join_codes" ADD CONSTRAINT "site_join_codes_uses_check" CHECK ("use_count" >= 0 AND ("max_uses" IS NULL OR "max_uses" > 0));

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_type_check" CHECK ("type" IN ('direct', 'group'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_key_check" CHECK (("type" = 'direct') = ("direct_key" IS NOT NULL));
-- MVP: 현장당 그룹 대화 1개, 같은 두 사람의 1:1 대화는 현장당 1개
CREATE UNIQUE INDEX "conversations_one_group_per_site" ON "conversations" ("site_id") WHERE "type" = 'group';
CREATE UNIQUE INDEX "conversations_direct_unique" ON "conversations" ("site_id", "direct_key") WHERE "type" = 'direct';
