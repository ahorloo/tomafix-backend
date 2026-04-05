-- CreateEnum: missing enums for estate ops models
DO $$ BEGIN
  CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReminderType" AS ENUM ('PAYMENT_DUE_SOON', 'PAYMENT_OVERDUE', 'LEASE_EXPIRING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "UtilityType" AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'WASTE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "UtilityMeterStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ViolationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ESCALATED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable: EstateLease
CREATE TABLE IF NOT EXISTS "EstateLease" (
  "id"                   TEXT NOT NULL,
  "workspaceId"          TEXT NOT NULL,
  "estateId"             TEXT,
  "unitId"               TEXT NOT NULL,
  "residentId"           TEXT,
  "leaseHolderName"      TEXT NOT NULL,
  "startDate"            TIMESTAMP(3) NOT NULL,
  "endDate"              TIMESTAMP(3) NOT NULL,
  "monthlyRent"          DOUBLE PRECISION,
  "securityDeposit"      DOUBLE PRECISION,
  "renewalNoticeDays"    INTEGER NOT NULL DEFAULT 30,
  "status"               "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
  "agreementUrl"         TEXT,
  "notes"                TEXT,
  "moveInDate"           TIMESTAMP(3),
  "moveOutDate"          TIMESTAMP(3),
  "expiryReminderSentAt" TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EstateReminderLog
CREATE TABLE IF NOT EXISTS "EstateReminderLog" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "chargeId"       TEXT,
  "leaseId"        TEXT,
  "type"           "ReminderType" NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientPhone" TEXT,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstateReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EstateUtilityMeter
CREATE TABLE IF NOT EXISTS "EstateUtilityMeter" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "estateId"         TEXT,
  "unitId"           TEXT NOT NULL,
  "type"             "UtilityType" NOT NULL,
  "label"            TEXT NOT NULL,
  "meterNumber"      TEXT,
  "status"           "UtilityMeterStatus" NOT NULL DEFAULT 'ACTIVE',
  "unitRate"         DOUBLE PRECISION,
  "fixedCharge"      DOUBLE PRECISION,
  "lastReadingValue" DOUBLE PRECISION,
  "lastReadingAt"    TIMESTAMP(3),
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateUtilityMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EstateUtilityReading
CREATE TABLE IF NOT EXISTS "EstateUtilityReading" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "meterId"       TEXT NOT NULL,
  "chargeId"      TEXT,
  "readingDate"   TIMESTAMP(3) NOT NULL,
  "readingValue"  DOUBLE PRECISION NOT NULL,
  "previousValue" DOUBLE PRECISION,
  "consumption"   DOUBLE PRECISION,
  "unitRate"      DOUBLE PRECISION,
  "fixedCharge"   DOUBLE PRECISION,
  "billedAmount"  DOUBLE PRECISION,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateUtilityReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EstateViolation
CREATE TABLE IF NOT EXISTS "EstateViolation" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "estateId"       TEXT,
  "unitId"         TEXT,
  "residentId"     TEXT,
  "category"       TEXT,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "severity"       TEXT,
  "status"         "ViolationStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate"        TIMESTAMP(3),
  "resolvedAt"     TIMESTAMP(3),
  "fineAmount"     DOUBLE PRECISION,
  "evidencePhotos" JSONB,
  "resolutionNote" TEXT,
  "createdByName"  TEXT,
  "closedByName"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EstateApprovalRequest
CREATE TABLE IF NOT EXISTS "EstateApprovalRequest" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "estateId"         TEXT,
  "unitId"           TEXT,
  "residentId"       TEXT,
  "type"             TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "attachmentUrls"   JSONB,
  "requestedStartAt" TIMESTAMP(3),
  "requestedEndAt"   TIMESTAMP(3),
  "status"           "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"       TIMESTAMP(3),
  "reviewedByName"   TEXT,
  "decisionNote"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "EstateLease_workspaceId_idx"        ON "EstateLease"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateLease_estateId_idx"           ON "EstateLease"("estateId");
CREATE INDEX IF NOT EXISTS "EstateLease_unitId_idx"             ON "EstateLease"("unitId");
CREATE INDEX IF NOT EXISTS "EstateLease_residentId_idx"         ON "EstateLease"("residentId");
CREATE INDEX IF NOT EXISTS "EstateLease_workspaceId_status_idx" ON "EstateLease"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EstateLease_workspaceId_endDate_idx" ON "EstateLease"("workspaceId", "endDate");

CREATE INDEX IF NOT EXISTS "EstateReminderLog_workspaceId_idx"  ON "EstateReminderLog"("workspaceId");

CREATE INDEX IF NOT EXISTS "EstateUtilityMeter_workspaceId_idx"        ON "EstateUtilityMeter"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateUtilityMeter_estateId_idx"           ON "EstateUtilityMeter"("estateId");
CREATE INDEX IF NOT EXISTS "EstateUtilityMeter_unitId_idx"             ON "EstateUtilityMeter"("unitId");
CREATE INDEX IF NOT EXISTS "EstateUtilityMeter_workspaceId_type_idx"   ON "EstateUtilityMeter"("workspaceId", "type");
CREATE INDEX IF NOT EXISTS "EstateUtilityMeter_workspaceId_status_idx" ON "EstateUtilityMeter"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "EstateUtilityReading_workspaceId_idx" ON "EstateUtilityReading"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateUtilityReading_meterId_idx"     ON "EstateUtilityReading"("meterId");

CREATE INDEX IF NOT EXISTS "EstateViolation_workspaceId_idx"  ON "EstateViolation"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateViolation_estateId_idx"     ON "EstateViolation"("estateId");
CREATE INDEX IF NOT EXISTS "EstateViolation_unitId_idx"       ON "EstateViolation"("unitId");
CREATE INDEX IF NOT EXISTS "EstateViolation_residentId_idx"   ON "EstateViolation"("residentId");

CREATE INDEX IF NOT EXISTS "EstateApprovalRequest_workspaceId_idx" ON "EstateApprovalRequest"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateApprovalRequest_estateId_idx"    ON "EstateApprovalRequest"("estateId");
CREATE INDEX IF NOT EXISTS "EstateApprovalRequest_unitId_idx"      ON "EstateApprovalRequest"("unitId");
CREATE INDEX IF NOT EXISTS "EstateApprovalRequest_residentId_idx"  ON "EstateApprovalRequest"("residentId");

-- Foreign Keys
ALTER TABLE "EstateLease"
  ADD CONSTRAINT "EstateLease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateLease_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateLease_unitId_fkey"      FOREIGN KEY ("unitId")      REFERENCES "EstateUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateLease_residentId_fkey"  FOREIGN KEY ("residentId")  REFERENCES "EstateResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstateReminderLog"
  ADD CONSTRAINT "EstateReminderLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateReminderLog_chargeId_fkey"    FOREIGN KEY ("chargeId")    REFERENCES "EstateCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateReminderLog_leaseId_fkey"     FOREIGN KEY ("leaseId")     REFERENCES "EstateLease"("id")  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstateUtilityMeter"
  ADD CONSTRAINT "EstateUtilityMeter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")   ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateUtilityMeter_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")       ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateUtilityMeter_unitId_fkey"      FOREIGN KEY ("unitId")      REFERENCES "EstateUnit"("id")   ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstateUtilityReading"
  ADD CONSTRAINT "EstateUtilityReading_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")          ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateUtilityReading_meterId_fkey"     FOREIGN KEY ("meterId")     REFERENCES "EstateUtilityMeter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateUtilityReading_chargeId_fkey"    FOREIGN KEY ("chargeId")    REFERENCES "EstateCharge"("id")       ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstateViolation"
  ADD CONSTRAINT "EstateViolation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateViolation_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")          ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateViolation_unitId_fkey"      FOREIGN KEY ("unitId")      REFERENCES "EstateUnit"("id")      ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateViolation_residentId_fkey"  FOREIGN KEY ("residentId")  REFERENCES "EstateResident"("id")  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstateApprovalRequest"
  ADD CONSTRAINT "EstateApprovalRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")     ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateApprovalRequest_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")         ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateApprovalRequest_unitId_fkey"      FOREIGN KEY ("unitId")      REFERENCES "EstateUnit"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateApprovalRequest_residentId_fkey"  FOREIGN KEY ("residentId")  REFERENCES "EstateResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
