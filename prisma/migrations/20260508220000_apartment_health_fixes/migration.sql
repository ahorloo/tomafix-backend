-- Apartment template health fixes
-- 1) Invite gains optional unitId for unit-scoped invites
-- 2) WorkOrderStatus gains WAITING
-- 3) Apartment/Estate work orders gain waitingReason + slaBreachAlertedAt
-- 4) Apartment/Estate notices gain target{Block,Floor,UnitId}
-- 5) New RequestCategory model (workspace-scoped)
-- 6) New NotificationDeadLetter model (failed-send retry queue)

-- Postgres requires ALTER TYPE ADD VALUE outside a transaction, so this
-- statement is committed standalone before any other DDL touches the type.
ALTER TYPE "WorkOrderStatus" ADD VALUE IF NOT EXISTS 'WAITING' BEFORE 'COMPLETED';

ALTER TABLE "Invite"
  ADD COLUMN IF NOT EXISTS "unitId" TEXT;

ALTER TABLE "ApartmentRequest"
  ADD COLUMN IF NOT EXISTS "category" TEXT;

ALTER TABLE "ApartmentNotice"
  ADD COLUMN IF NOT EXISTS "targetBlock" TEXT,
  ADD COLUMN IF NOT EXISTS "targetFloor" TEXT,
  ADD COLUMN IF NOT EXISTS "targetUnitId" TEXT;

CREATE INDEX IF NOT EXISTS "ApartmentNotice_workspaceId_targetBlock_targetFloor_idx"
  ON "ApartmentNotice" ("workspaceId", "targetBlock", "targetFloor");
CREATE INDEX IF NOT EXISTS "ApartmentNotice_workspaceId_targetUnitId_idx"
  ON "ApartmentNotice" ("workspaceId", "targetUnitId");

ALTER TABLE "EstateNotice"
  ADD COLUMN IF NOT EXISTS "targetBlock" TEXT,
  ADD COLUMN IF NOT EXISTS "targetFloor" TEXT,
  ADD COLUMN IF NOT EXISTS "targetUnitId" TEXT;

CREATE INDEX IF NOT EXISTS "EstateNotice_workspaceId_targetBlock_targetFloor_idx"
  ON "EstateNotice" ("workspaceId", "targetBlock", "targetFloor");
CREATE INDEX IF NOT EXISTS "EstateNotice_workspaceId_targetUnitId_idx"
  ON "EstateNotice" ("workspaceId", "targetUnitId");

ALTER TABLE "ApartmentWorkOrder"
  ADD COLUMN IF NOT EXISTS "waitingReason" TEXT,
  ADD COLUMN IF NOT EXISTS "slaBreachAlertedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_slaDeadline_slaBreachAlertedAt_idx"
  ON "ApartmentWorkOrder" ("slaDeadline", "slaBreachAlertedAt");

ALTER TABLE "EstateWorkOrder"
  ADD COLUMN IF NOT EXISTS "waitingReason" TEXT,
  ADD COLUMN IF NOT EXISTS "slaBreachAlertedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EstateWorkOrder_slaDeadline_slaBreachAlertedAt_idx"
  ON "EstateWorkOrder" ("slaDeadline", "slaBreachAlertedAt");

CREATE TABLE IF NOT EXISTS "RequestCategory" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequestCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestCategory_workspaceId_name_key"
  ON "RequestCategory" ("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "RequestCategory_workspaceId_active_sortOrder_idx"
  ON "RequestCategory" ("workspaceId", "active", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "RequestCategory"
    ADD CONSTRAINT "RequestCategory_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('PENDING','RETRYING','FAILED','SENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL','SMS','WHATSAPP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "NotificationDeadLetter" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "channel" "NotificationChannel" NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT,
  "payload" JSONB NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDeadLetter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationDeadLetter_status_nextAttemptAt_idx"
  ON "NotificationDeadLetter" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "NotificationDeadLetter_workspaceId_status_idx"
  ON "NotificationDeadLetter" ("workspaceId", "status");

DO $$ BEGIN
  ALTER TABLE "NotificationDeadLetter"
    ADD CONSTRAINT "NotificationDeadLetter_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
