-- CreateTable
CREATE TABLE "target_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "target_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_group_members" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "target_group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "target_groups_site_id_name_key" ON "target_groups"("site_id", "name");

-- CreateIndex
CREATE INDEX "target_group_members_user_id_idx" ON "target_group_members"("user_id");

-- AddForeignKey
ALTER TABLE "target_groups" ADD CONSTRAINT "target_groups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_group_members" ADD CONSTRAINT "target_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "target_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
