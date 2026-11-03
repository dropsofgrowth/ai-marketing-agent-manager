-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('OWNER', 'ADMIN', 'APPROVER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('META_ADS', 'SHOPIFY', 'HIGGSFIELD');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('NOT_CONFIGURED', 'MOCK', 'CONNECTED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "approval_type" AS ENUM ('BUDGET_CHANGE', 'CREATIVE_PUBLISH');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'EXECUTING', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "request_source" AS ENUM ('USER', 'AUTOMATION', 'AI_AGENT');

-- CreateEnum
CREATE TYPE "execution_mode" AS ENUM ('SIMULATED', 'LIVE');

-- CreateEnum
CREATE TYPE "creative_status" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "creative_format" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "external_account_id" TEXT,
    "display_name" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encrypted_credentials" TEXT,
    "credentials_key_version" INTEGER,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "format" "creative_format" NOT NULL,
    "aspect_ratio" TEXT NOT NULL,
    "status" "creative_status" NOT NULL DEFAULT 'DRAFT',
    "provider" "integration_provider" NOT NULL DEFAULT 'HIGGSFIELD',
    "provider_job_id" TEXT,
    "asset_url" TEXT,
    "thumbnail_url" TEXT,
    "headline" TEXT,
    "primary_text" TEXT,
    "call_to_action" TEXT,
    "metadata" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "approval_type" NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "rationale" TEXT,
    "payload" JSONB NOT NULL,
    "risk_level" "risk_level" NOT NULL DEFAULT 'MEDIUM',
    "source" "request_source" NOT NULL DEFAULT 'USER',
    "source_ref" TEXT,
    "provider" "integration_provider" NOT NULL,
    "target_external_id" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "creative_id" TEXT,
    "requested_by_id" TEXT,
    "requested_by_label" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "execution_mode" "execution_mode",
    "executed_at" TIMESTAMP(3),
    "execution_result" JSONB,
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_workspace_id_user_id_key" ON "memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "integration_connections_workspace_id_provider_idx" ON "integration_connections"("workspace_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_external_acco_key" ON "integration_connections"("workspace_id", "provider", "external_account_id");

-- CreateIndex
CREATE INDEX "creatives_workspace_id_status_idx" ON "creatives"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_workspace_id_status_created_at_idx" ON "approval_requests"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_workspace_id_target_external_id_idx" ON "approval_requests"("workspace_id", "target_external_id");

-- CreateIndex
CREATE INDEX "automations_workspace_id_idx" ON "automations"("workspace_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Safety constraints (hand-written; Prisma cannot express these in the schema).
-- -----------------------------------------------------------------------------

-- Automations may only ever propose changes for human approval.
ALTER TABLE "automations"
  ADD CONSTRAINT "automations_requires_approval_check" CHECK ("requires_approval" = true);

-- An approval can only be claimed/executed after a reviewer approved it.
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_execution_requires_review_check"
  CHECK ("status" NOT IN ('EXECUTING', 'EXECUTED', 'FAILED') OR "reviewed_at" IS NOT NULL);

-- Phase 1 has no live adapters: only simulated execution may be recorded.
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_simulated_only_check"
  CHECK ("execution_mode" IS NULL OR "execution_mode" = 'SIMULATED');

-- At most one open request per target (campaign for budgets; campaign+creative
-- for publishing). Backs up the application-level duplicate check under races.
CREATE UNIQUE INDEX "approval_requests_one_open_per_target"
  ON "approval_requests" ("workspace_id", "type", "target_external_id", COALESCE("creative_id", ''))
  WHERE "status" IN ('PENDING', 'APPROVED', 'EXECUTING');
