-- Phase 2 schema additions
-- 1) Notice pin + acknowledgement-required flags + acknowledgements JSON
-- 2) ApartmentInspection.inspectionType (ROUTINE | MOVE_IN | MOVE_OUT)
-- 3) ApartmentAsset model + ApartmentAssetStatus enum
-- 4) Notification model (in-app feed)

ALTER TABLE "ApartmentNotice"
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acknowledgeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acknowledgements" JSONB;

ALTER TABLE "EstateNotice"
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acknowledgeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acknowledgements" JSONB;

ALTER TABLE "ApartmentInspection"
  ADD COLUMN IF NOT EXISTS "inspectionType" TEXT DEFAULT 'ROUTINE';

DO $$ BEGIN
  CREATE TYPE "ApartmentAssetStatus" AS ENUM ('ACTIVE','UNDER_MAINTENANCE','RETIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ApartmentAsset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "location" TEXT,
  "block" TEXT,
  "serialNumber" TEXT,
  "purchaseDate" TIMESTAMP(3),
  "warrantyEndDate" TIMESTAMP(3),
  "status" "ApartmentAssetStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "serviceIntervalDays" INTEGER,
  "lastServiceAt" TIMESTAMP(3),
  "nextServiceAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApartmentAsset_workspaceId_idx"
  ON "ApartmentAsset" ("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentAsset_workspaceId_status_idx"
  ON "ApartmentAsset" ("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ApartmentAsset_workspaceId_nextServiceAt_idx"
  ON "ApartmentAsset" ("workspaceId", "nextServiceAt");

DO $$ BEGIN
  ALTER TABLE "ApartmentAsset"
    ADD CONSTRAINT "ApartmentAsset_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "data" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_workspaceId_userId_readAt_createdAt_idx"
  ON "Notification" ("workspaceId", "userId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx"
  ON "Notification" ("userId", "readAt", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
