-- CreateEnum
CREATE TYPE "UserAccountType" AS ENUM ('individual', 'influencer', 'agency');

-- CreateEnum
CREATE TYPE "UserAuthProvider" AS ENUM ('email', 'google');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked', 'pending');

-- CreateEnum
CREATE TYPE "VideoJobProductType" AS ENUM ('greeting', 'video-ad', 'image-ad');

-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('pending', 'in-progress', 'review', 'delivered', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'negotiating', 'paid', 'closed', 'lost');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('book-call', 'contact-form', 'direct');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super-admin', 'admin', 'ops');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "avatar_url" TEXT,
    "account_type" "UserAccountType" NOT NULL DEFAULT 'individual',
    "auth_provider" "UserAuthProvider" NOT NULL DEFAULT 'email',
    "has_email_password" BOOLEAN NOT NULL DEFAULT false,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verification_token" TEXT,
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "celebrities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "nationality_ar" TEXT NOT NULL,
    "languages" TEXT[],
    "tags" TEXT[],
    "tags_ar" TEXT[],
    "bio" TEXT,
    "bio_ar" TEXT,
    "avatar_color" TEXT NOT NULL DEFAULT 'linear-gradient(135deg, #9a78fe, #422266)',
    "initials" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "voice_model_id" TEXT,
    "training_audio_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "price_range" JSONB NOT NULL DEFAULT '{"greeting":{"min":500,"max":2000},"video-ad":{"min":2000,"max":8000}}',
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "celebrities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "celebrity_id" TEXT NOT NULL,
    "product_type" "VideoJobProductType" NOT NULL,
    "purpose" TEXT NOT NULL,
    "template_id" TEXT,
    "script" TEXT NOT NULL,
    "tone" TEXT,
    "duration" TEXT NOT NULL DEFAULT '30s',
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '1080p',
    "channels" TEXT[],
    "status" "VideoJobStatus" NOT NULL DEFAULT 'pending',
    "status_history" JSONB NOT NULL DEFAULT '[]',
    "estimated_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "download_enabled" BOOLEAN NOT NULL DEFAULT false,
    "preview_url" TEXT,
    "final_video_url" TEXT,
    "watermarked_url" TEXT,
    "creatify_job_id" TEXT,
    "voice_job_id" TEXT,
    "voice_audio_url" TEXT,
    "voice_model" TEXT,
    "voice_speed" DOUBLE PRECISION,
    "voice_change_enabled" BOOLEAN NOT NULL DEFAULT false,
    "voice_change_source_url" TEXT,
    "prop_images" TEXT[],
    "scene_notes" TEXT,
    "background_image_url" TEXT,
    "audio_duration" DOUBLE PRECISION,
    "processed_script" TEXT,
    "error_message" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "video_job_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "celebrity_name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "notes" TEXT,
    "estimated_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "status_history" JSONB NOT NULL DEFAULT '[]',
    "assigned_to" TEXT,
    "follow_up_date" TIMESTAMP(3),
    "source" "LeadSource" NOT NULL DEFAULT 'book-call',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ops',
    "role_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_ar" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "purpose_ar" TEXT NOT NULL,
    "sample_script" TEXT NOT NULL,
    "sample_script_ar" TEXT NOT NULL,
    "product_types" TEXT[],
    "duration" TEXT NOT NULL DEFAULT '30s',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_ar" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "detail_ar" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "price_from" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" TEXT NOT NULL DEFAULT '',
    "duration_ar" TEXT NOT NULL DEFAULT '',
    "use_cases" TEXT[],
    "use_cases_ar" TEXT[],
    "video_prompt" TEXT NOT NULL DEFAULT '',
    "gemini_system_prompt" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'general',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_words" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "celebrities_slug_key" ON "celebrities"("slug");

-- CreateIndex
CREATE INDEX "celebrities_industry_is_active_idx" ON "celebrities"("industry", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "video_jobs_reference_id_key" ON "video_jobs"("reference_id");

-- CreateIndex
CREATE INDEX "video_jobs_user_id_status_idx" ON "video_jobs"("user_id", "status");

-- CreateIndex
CREATE INDEX "video_jobs_status_idx" ON "video_jobs"("status");

-- CreateIndex
CREATE INDEX "video_jobs_creatify_job_id_idx" ON "video_jobs"("creatify_job_id");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "templates_product_types_idx" ON "templates"("product_types");

-- CreateIndex
CREATE INDEX "templates_is_active_idx" ON "templates"("is_active");

-- CreateIndex
CREATE INDEX "templates_purpose_idx" ON "templates"("purpose");

-- CreateIndex
CREATE UNIQUE INDEX "product_types_slug_key" ON "product_types"("slug");

-- CreateIndex
CREATE INDEX "product_types_is_active_order_idx" ON "product_types"("is_active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_words_word_key" ON "blocked_words"("word");

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_celebrity_id_fkey" FOREIGN KEY ("celebrity_id") REFERENCES "celebrities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_video_job_id_fkey" FOREIGN KEY ("video_job_id") REFERENCES "video_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
