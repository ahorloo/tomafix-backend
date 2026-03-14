-- Migration: sync_office_schema_drift
-- Adds missing tables, columns and enum values that were in the Prisma schema
-- but never landed in the Render production database.

-- ─── 1. Extend OfficeRequestCategory enum ──────────────────────────────────
ALTER TYPE "OfficeRequestCategory" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "OfficeRequestCategory" ADD VALUE IF NOT EXISTS 'HR';
ALTER TYPE "OfficeRequestCategory" ADD VALUE IF NOT EXISTS 'PROCUREMENT';
ALTER TYPE "OfficeRequestCategory" ADD VALUE IF NOT EXISTS 'CLEANING';

-- ─── 2. Add missing columns to existing tables ─────────────────────────────

-- Workspace: Slack & outbound webhook integration fields
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "slackWebhookUrl"    TEXT,
  ADD COLUMN IF NOT EXISTS "outboundWebhookUrl" TEXT;

-- OfficeArea: ownerUserId
ALTER TABLE "OfficeArea"
  ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

-- OfficeRequest: requestTypeId + isEscalated
ALTER TABLE "OfficeRequest"
  ADD COLUMN IF NOT EXISTS "requestTypeId" TEXT,
  ADD COLUMN IF NOT EXISTS "isEscalated"   BOOLEAN NOT NULL DEFAULT false;

-- OfficeAsset: preventive-maintenance + cost tracking fields
ALTER TABLE "OfficeAsset"
  ADD COLUMN IF NOT EXISTS "pmIntervalDays"  INTEGER,
  ADD COLUMN IF NOT EXISTS "pmAutoCreate"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "costPerService"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "totalCostLogged" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ─── 3. Create missing tables ───────────────────────────────────────────────

-- OfficeRequestType
CREATE TABLE IF NOT EXISTS "OfficeRequestType" (
    "id"           TEXT NOT NULL,
    "workspaceId"  TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "baseCategory" "OfficeRequestCategory" NOT NULL DEFAULT 'FACILITY',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "slaHours"     INTEGER,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfficeRequestType_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OfficeRequestType_workspaceId_idx"          ON "OfficeRequestType"("workspaceId");
CREATE INDEX IF NOT EXISTS "OfficeRequestType_workspaceId_isActive_idx" ON "OfficeRequestType"("workspaceId", "isActive");

ALTER TABLE "OfficeRequestType"
  ADD CONSTRAINT "OfficeRequestType_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wire OfficeRequest.requestTypeId → OfficeRequestType.id
ALTER TABLE "OfficeRequest"
  ADD CONSTRAINT "OfficeRequest_requestTypeId_fkey"
  FOREIGN KEY ("requestTypeId") REFERENCES "OfficeRequestType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OfficeRequest_requestTypeId_idx"        ON "OfficeRequest"("requestTypeId");
CREATE INDEX IF NOT EXISTS "OfficeRequest_workspaceId_category_idx" ON "OfficeRequest"("workspaceId", "category");
CREATE INDEX IF NOT EXISTS "OfficeRequest_workspaceId_status_createdAt_idx" ON "OfficeRequest"("workspaceId", "status", "createdAt");

-- OfficeWorkOrderMessage
CREATE TABLE IF NOT EXISTS "OfficeWorkOrderMessage" (
    "id"           TEXT NOT NULL,
    "workspaceId"  TEXT NOT NULL,
    "workOrderId"  TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName"   TEXT NOT NULL,
    "body"         TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfficeWorkOrderMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OfficeWorkOrderMessage_workspaceId_idx"  ON "OfficeWorkOrderMessage"("workspaceId");
CREATE INDEX IF NOT EXISTS "OfficeWorkOrderMessage_workOrderId_idx"  ON "OfficeWorkOrderMessage"("workOrderId");
CREATE INDEX IF NOT EXISTS "OfficeWorkOrderMessage_workspaceId_workOrderId_createdAt_idx"
  ON "OfficeWorkOrderMessage"("workspaceId", "workOrderId", "createdAt");

ALTER TABLE "OfficeWorkOrderMessage"
  ADD CONSTRAINT "OfficeWorkOrderMessage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeWorkOrderMessage"
  ADD CONSTRAINT "OfficeWorkOrderMessage_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "OfficeWorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Property (estate property management)
CREATE TABLE IF NOT EXISTS "Property" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Property_workspaceId_name_key" ON "Property"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "Property_workspaceId_idx" ON "Property"("workspaceId");

ALTER TABLE "Property"
  ADD CONSTRAINT "Property_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. Extra indexes on OfficeArea ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "OfficeArea_ownerUserId_idx"  ON "OfficeArea"("ownerUserId");
CREATE INDEX IF NOT EXISTS "OfficeArea_workspaceId_type_idx" ON "OfficeArea"("workspaceId", "type");
