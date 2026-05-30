-- CreateTable
CREATE TABLE "managers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "agency_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add manager_id to celebrity_manager_links
ALTER TABLE "celebrity_manager_links" ADD COLUMN IF NOT EXISTS "manager_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "managers_email_key" ON "managers"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "celebrity_manager_links_celebrity_id_manager_id_key" ON "celebrity_manager_links"("celebrity_id", "manager_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "celebrity_manager_links_manager_id_idx" ON "celebrity_manager_links"("manager_id");

-- AddForeignKey
ALTER TABLE "celebrity_manager_links" ADD CONSTRAINT "celebrity_manager_links_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
