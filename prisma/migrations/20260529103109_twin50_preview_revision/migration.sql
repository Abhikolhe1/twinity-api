/*
  Warnings:

  - A unique constraint covering the columns `[celebrity_id]` on the table `admins` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "OtpType" AS ENUM ('email_verification', 'login_mfa', 'mfa_setup', 'password_reset_otp');

-- CreateEnum
CREATE TYPE "CelebrityOnboardingStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RevisionType" AS ENUM ('minor', 'material', 'escalation');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('pending', 'approved', 'rejected', 'escalated');

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "celebrity_id" TEXT,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfa_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_secret" TEXT,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profile_completed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "celebrities" ADD COLUMN     "allowed_content_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "approval_preferences" JSONB NOT NULL DEFAULT '{"greetingAutoApprove":false,"manualReviewRequired":true,"slaHours":48,"fastTrackEligible":false,"templatePolicyReviewed":false}',
ADD COLUMN     "approved_media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "competitor_brands" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "contract_acceptance" JSONB NOT NULL DEFAULT '{"accepted":false,"acceptedAt":null,"signedName":""}',
ADD COLUMN     "geographic_availability" JSONB NOT NULL DEFAULT '{"mode":"global","allowedRegions":[],"restrictedRegions":[]}',
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "manager_settings" JSONB NOT NULL DEFAULT '{"selfManaged":true,"agencyName":"","managerName":"","managerEmail":"","managerPhone":"","permissions":[]}',
ADD COLUMN     "onboarding_status" "CelebrityOnboardingStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "preapproved_template_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "prohibited_industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "region" TEXT,
ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_admin_id" TEXT,
ADD COLUMN     "social_links" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tone_style_preferences" JSONB NOT NULL DEFAULT '{"communicationStyle":"","visualStyle":"","endorsedTopics":[],"personalRestrictions":[]}';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_admin_id" TEXT,
ADD COLUMN     "suspension_reason" TEXT;

-- AlterTable
ALTER TABLE "video_jobs" ADD COLUMN     "approval_path" TEXT,
ADD COLUMN     "business_verification_passed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "business_verification_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "client_preview_approved_at" TIMESTAMP(3),
ADD COLUMN     "is_escalated_to_support" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision_limit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "submission_audit" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "submission_context" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "validation_result" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_name" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "OtpType" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_revisions" (
    "id" TEXT NOT NULL,
    "video_job_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "type" "RevisionType" NOT NULL DEFAULT 'minor',
    "reason" TEXT NOT NULL,
    "classification" "RevisionType",
    "classification_note" TEXT,
    "status" "RevisionStatus" NOT NULL DEFAULT 'pending',
    "submitted_by_user_id" TEXT NOT NULL,
    "provider_job_id" TEXT,
    "escalation_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preview_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "celebrity_manager_links" (
    "id" TEXT NOT NULL,
    "celebrity_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "linked_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "celebrity_manager_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_id_idx" ON "audit_logs"("target_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "otp_codes_email_type_idx" ON "otp_codes"("email", "type");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE INDEX "preview_revisions_video_job_id_idx" ON "preview_revisions"("video_job_id");

-- CreateIndex
CREATE INDEX "preview_revisions_status_idx" ON "preview_revisions"("status");

-- CreateIndex
CREATE INDEX "celebrity_manager_links_celebrity_id_idx" ON "celebrity_manager_links"("celebrity_id");

-- CreateIndex
CREATE INDEX "celebrity_manager_links_admin_id_idx" ON "celebrity_manager_links"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "celebrity_manager_links_celebrity_id_admin_id_key" ON "celebrity_manager_links"("celebrity_id", "admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_celebrity_id_key" ON "admins"("celebrity_id");

-- CreateIndex
CREATE INDEX "celebrities_onboarding_status_idx" ON "celebrities"("onboarding_status");

-- CreateIndex
CREATE INDEX "celebrities_is_active_onboarding_status_idx" ON "celebrities"("is_active", "onboarding_status");

-- AddForeignKey
ALTER TABLE "celebrities" ADD CONSTRAINT "celebrities_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_celebrity_id_fkey" FOREIGN KEY ("celebrity_id") REFERENCES "celebrities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_revisions" ADD CONSTRAINT "preview_revisions_video_job_id_fkey" FOREIGN KEY ("video_job_id") REFERENCES "video_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "celebrity_manager_links" ADD CONSTRAINT "celebrity_manager_links_celebrity_id_fkey" FOREIGN KEY ("celebrity_id") REFERENCES "celebrities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "celebrity_manager_links" ADD CONSTRAINT "celebrity_manager_links_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
