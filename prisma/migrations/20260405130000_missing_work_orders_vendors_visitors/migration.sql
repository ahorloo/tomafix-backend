-- Missing enums and tables: work orders, vendors, visitors, recurring charges, inspection templates, emergency alerts

DO $$ BEGIN
  CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitorStatus" AS ENUM ('EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RecurringFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InspectionTemplateKind" AS ENUM ('MOVE_IN', 'MOVE_OUT', 'ROUTINE', 'SAFETY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmergencyAlertStatus" AS ENUM ('DRAFT', 'SENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable: ApartmentVisitor
CREATE TABLE IF NOT EXISTS "ApartmentVisitor" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "invitedByUserId"  TEXT,
  "invitedByName"    TEXT,
  "unitId"           TEXT,
  "unitLabel"        TEXT,
  "name"             TEXT NOT NULL,
  "phone"            TEXT,
  "email"            TEXT,
  "purpose"          TEXT,
  "qrToken"          TEXT NOT NULL,
  "status"           "VisitorStatus" NOT NULL DEFAULT 'EXPECTED',
  "validFrom"        TIMESTAMP(3),
  "validUntil"       TIMESTAMP(3),
  "checkedInAt"      TIMESTAMP(3),
  "checkedOutAt"     TIMESTAMP(3),
  "checkedInByName"  TEXT,
  "checkedOutByName" TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentVisitor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApartmentVisitor_qrToken_key" ON "ApartmentVisitor"("qrToken");
CREATE INDEX IF NOT EXISTS "ApartmentVisitor_workspaceId_idx"        ON "ApartmentVisitor"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentVisitor_workspaceId_status_idx" ON "ApartmentVisitor"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ApartmentVisitor_workspaceId_createdAt_idx" ON "ApartmentVisitor"("workspaceId", "createdAt");

-- CreateTable: EstateVisitor
CREATE TABLE IF NOT EXISTS "EstateVisitor" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "invitedByUserId"  TEXT,
  "invitedByName"    TEXT,
  "unitId"           TEXT,
  "unitLabel"        TEXT,
  "name"             TEXT NOT NULL,
  "phone"            TEXT,
  "email"            TEXT,
  "purpose"          TEXT,
  "qrToken"          TEXT NOT NULL,
  "status"           "VisitorStatus" NOT NULL DEFAULT 'EXPECTED',
  "validFrom"        TIMESTAMP(3),
  "validUntil"       TIMESTAMP(3),
  "checkedInAt"      TIMESTAMP(3),
  "checkedOutAt"     TIMESTAMP(3),
  "checkedInByName"  TEXT,
  "checkedOutByName" TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateVisitor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EstateVisitor_qrToken_key" ON "EstateVisitor"("qrToken");
CREATE INDEX IF NOT EXISTS "EstateVisitor_workspaceId_idx"        ON "EstateVisitor"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateVisitor_workspaceId_status_idx" ON "EstateVisitor"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EstateVisitor_workspaceId_createdAt_idx" ON "EstateVisitor"("workspaceId", "createdAt");

-- CreateTable: OfficeVisitor
CREATE TABLE IF NOT EXISTS "OfficeVisitor" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "invitedByUserId"  TEXT,
  "invitedByName"    TEXT,
  "areaId"           TEXT,
  "areaName"         TEXT,
  "name"             TEXT NOT NULL,
  "phone"            TEXT,
  "email"            TEXT,
  "purpose"          TEXT,
  "qrToken"          TEXT NOT NULL,
  "status"           "VisitorStatus" NOT NULL DEFAULT 'EXPECTED',
  "validFrom"        TIMESTAMP(3),
  "validUntil"       TIMESTAMP(3),
  "checkedInAt"      TIMESTAMP(3),
  "checkedOutAt"     TIMESTAMP(3),
  "checkedInByName"  TEXT,
  "checkedOutByName" TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfficeVisitor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfficeVisitor_qrToken_key" ON "OfficeVisitor"("qrToken");
CREATE INDEX IF NOT EXISTS "OfficeVisitor_workspaceId_idx"        ON "OfficeVisitor"("workspaceId");
CREATE INDEX IF NOT EXISTS "OfficeVisitor_workspaceId_status_idx" ON "OfficeVisitor"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "OfficeVisitor_workspaceId_createdAt_idx" ON "OfficeVisitor"("workspaceId", "createdAt");

-- CreateTable: ApartmentRecurringCharge
CREATE TABLE IF NOT EXISTS "ApartmentRecurringCharge" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "category"    TEXT,
  "amount"      DOUBLE PRECISION NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'GHS',
  "frequency"   "RecurringFrequency" NOT NULL DEFAULT 'MONTHLY',
  "dayOfMonth"  INTEGER,
  "notes"       TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"   TIMESTAMP(3),
  "nextRunAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentRecurringCharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApartmentRecurringCharge_workspaceId_idx"          ON "ApartmentRecurringCharge"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentRecurringCharge_workspaceId_isActive_idx" ON "ApartmentRecurringCharge"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "ApartmentRecurringCharge_nextRunAt_idx"             ON "ApartmentRecurringCharge"("nextRunAt");

-- CreateTable: EstateRecurringCharge
CREATE TABLE IF NOT EXISTS "EstateRecurringCharge" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId"    TEXT,
  "title"       TEXT NOT NULL,
  "category"    TEXT,
  "amount"      DOUBLE PRECISION NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'GHS',
  "frequency"   "RecurringFrequency" NOT NULL DEFAULT 'MONTHLY',
  "dayOfMonth"  INTEGER,
  "notes"       TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"   TIMESTAMP(3),
  "nextRunAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateRecurringCharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateRecurringCharge_workspaceId_idx"          ON "EstateRecurringCharge"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateRecurringCharge_estateId_idx"             ON "EstateRecurringCharge"("estateId");
CREATE INDEX IF NOT EXISTS "EstateRecurringCharge_workspaceId_isActive_idx" ON "EstateRecurringCharge"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "EstateRecurringCharge_nextRunAt_idx"             ON "EstateRecurringCharge"("nextRunAt");

-- CreateTable: ApartmentVendor
CREATE TABLE IF NOT EXISTS "ApartmentVendor" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "address"     TEXT,
  "notes"       TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "rating"      DOUBLE PRECISION,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentVendor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApartmentVendor_workspaceId_idx"          ON "ApartmentVendor"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentVendor_workspaceId_isActive_idx" ON "ApartmentVendor"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "ApartmentVendor_workspaceId_category_idx" ON "ApartmentVendor"("workspaceId", "category");

-- CreateTable: EstateVendor
CREATE TABLE IF NOT EXISTS "EstateVendor" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "address"     TEXT,
  "notes"       TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "rating"      DOUBLE PRECISION,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateVendor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateVendor_workspaceId_idx"          ON "EstateVendor"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateVendor_workspaceId_isActive_idx" ON "EstateVendor"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "EstateVendor_workspaceId_category_idx" ON "EstateVendor"("workspaceId", "category");

-- CreateTable: ApartmentWorkOrder
CREATE TABLE IF NOT EXISTS "ApartmentWorkOrder" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "unitId"           TEXT,
  "unitLabel"        TEXT,
  "residentId"       TEXT,
  "vendorId"         TEXT,
  "assignedToUserId" TEXT,
  "assignedToName"   TEXT,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "category"         TEXT,
  "priority"         "RequestPriority" NOT NULL DEFAULT 'NORMAL',
  "status"           "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
  "estimatedCost"    DOUBLE PRECISION,
  "actualCost"       DOUBLE PRECISION,
  "slaDeadline"      TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "completionNote"   TEXT,
  "proofPhotoUrl"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentWorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_workspaceId_idx"             ON "ApartmentWorkOrder"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_workspaceId_status_idx"      ON "ApartmentWorkOrder"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_workspaceId_unitId_idx"      ON "ApartmentWorkOrder"("workspaceId", "unitId");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_workspaceId_vendorId_idx"    ON "ApartmentWorkOrder"("workspaceId", "vendorId");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrder_workspaceId_assignedTo_idx"  ON "ApartmentWorkOrder"("workspaceId", "assignedToUserId");

-- CreateTable: ApartmentWorkOrderMessage
CREATE TABLE IF NOT EXISTS "ApartmentWorkOrderMessage" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "workOrderId"  TEXT NOT NULL,
  "senderUserId" TEXT,
  "senderName"   TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApartmentWorkOrderMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApartmentWorkOrderMessage_workspaceId_idx"        ON "ApartmentWorkOrderMessage"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrderMessage_workOrderId_idx"        ON "ApartmentWorkOrderMessage"("workOrderId");
CREATE INDEX IF NOT EXISTS "ApartmentWorkOrderMessage_workOrderId_createdAt_idx" ON "ApartmentWorkOrderMessage"("workOrderId", "createdAt");

-- CreateTable: EstateWorkOrder
CREATE TABLE IF NOT EXISTS "EstateWorkOrder" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "estateId"         TEXT,
  "unitId"           TEXT,
  "unitLabel"        TEXT,
  "residentId"       TEXT,
  "vendorId"         TEXT,
  "assignedToUserId" TEXT,
  "assignedToName"   TEXT,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "category"         TEXT,
  "priority"         "RequestPriority" NOT NULL DEFAULT 'NORMAL',
  "status"           "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
  "estimatedCost"    DOUBLE PRECISION,
  "actualCost"       DOUBLE PRECISION,
  "slaDeadline"      TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "completionNote"   TEXT,
  "proofPhotoUrl"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateWorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateWorkOrder_workspaceId_idx"            ON "EstateWorkOrder"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrder_estateId_idx"               ON "EstateWorkOrder"("estateId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrder_workspaceId_status_idx"     ON "EstateWorkOrder"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EstateWorkOrder_workspaceId_unitId_idx"     ON "EstateWorkOrder"("workspaceId", "unitId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrder_workspaceId_vendorId_idx"   ON "EstateWorkOrder"("workspaceId", "vendorId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrder_workspaceId_assignedTo_idx" ON "EstateWorkOrder"("workspaceId", "assignedToUserId");

-- CreateTable: EstateWorkOrderMessage
CREATE TABLE IF NOT EXISTS "EstateWorkOrderMessage" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "workOrderId"  TEXT NOT NULL,
  "senderUserId" TEXT,
  "senderName"   TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstateWorkOrderMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateWorkOrderMessage_workspaceId_idx"           ON "EstateWorkOrderMessage"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrderMessage_workOrderId_idx"           ON "EstateWorkOrderMessage"("workOrderId");
CREATE INDEX IF NOT EXISTS "EstateWorkOrderMessage_workOrderId_createdAt_idx" ON "EstateWorkOrderMessage"("workOrderId", "createdAt");

-- CreateTable: EstateInspectionTemplate
CREATE TABLE IF NOT EXISTS "EstateInspectionTemplate" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId"    TEXT,
  "name"        TEXT NOT NULL,
  "kind"        "InspectionTemplateKind" NOT NULL DEFAULT 'CUSTOM',
  "description" TEXT,
  "checklist"   JSONB NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateInspectionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateInspectionTemplate_workspaceId_idx"          ON "EstateInspectionTemplate"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateInspectionTemplate_estateId_idx"             ON "EstateInspectionTemplate"("estateId");
CREATE INDEX IF NOT EXISTS "EstateInspectionTemplate_workspaceId_isActive_idx" ON "EstateInspectionTemplate"("workspaceId", "isActive");

-- CreateTable: EstateEmergencyAlert
CREATE TABLE IF NOT EXISTS "EstateEmergencyAlert" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId"    TEXT,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "audience"    "NoticeAudience" NOT NULL DEFAULT 'ALL',
  "channels"    JSONB,
  "status"      "EmergencyAlertStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt"      TIMESTAMP(3),
  "sentByName"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateEmergencyAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateEmergencyAlert_workspaceId_idx"           ON "EstateEmergencyAlert"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateEmergencyAlert_estateId_idx"              ON "EstateEmergencyAlert"("estateId");
CREATE INDEX IF NOT EXISTS "EstateEmergencyAlert_workspaceId_status_idx"    ON "EstateEmergencyAlert"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EstateEmergencyAlert_workspaceId_createdAt_idx" ON "EstateEmergencyAlert"("workspaceId", "createdAt");

-- Foreign Keys: ApartmentVisitor
ALTER TABLE "ApartmentVisitor"
  ADD CONSTRAINT "ApartmentVisitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: EstateVisitor
ALTER TABLE "EstateVisitor"
  ADD CONSTRAINT "EstateVisitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: OfficeVisitor
ALTER TABLE "OfficeVisitor"
  ADD CONSTRAINT "OfficeVisitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: ApartmentRecurringCharge
ALTER TABLE "ApartmentRecurringCharge"
  ADD CONSTRAINT "ApartmentRecurringCharge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: EstateRecurringCharge
ALTER TABLE "EstateRecurringCharge"
  ADD CONSTRAINT "EstateRecurringCharge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateRecurringCharge_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: ApartmentVendor
ALTER TABLE "ApartmentVendor"
  ADD CONSTRAINT "ApartmentVendor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: EstateVendor
ALTER TABLE "EstateVendor"
  ADD CONSTRAINT "EstateVendor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: ApartmentWorkOrder
ALTER TABLE "ApartmentWorkOrder"
  ADD CONSTRAINT "ApartmentWorkOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApartmentWorkOrder_vendorId_fkey"    FOREIGN KEY ("vendorId")    REFERENCES "ApartmentVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: ApartmentWorkOrderMessage
ALTER TABLE "ApartmentWorkOrderMessage"
  ADD CONSTRAINT "ApartmentWorkOrderMessage_workspaceId_fkey"  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")          ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApartmentWorkOrderMessage_workOrderId_fkey"  FOREIGN KEY ("workOrderId") REFERENCES "ApartmentWorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: EstateWorkOrder
ALTER TABLE "EstateWorkOrder"
  ADD CONSTRAINT "EstateWorkOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")   ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateWorkOrder_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")       ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateWorkOrder_vendorId_fkey"    FOREIGN KEY ("vendorId")    REFERENCES "EstateVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: EstateWorkOrderMessage
ALTER TABLE "EstateWorkOrderMessage"
  ADD CONSTRAINT "EstateWorkOrderMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")       ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateWorkOrderMessage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "EstateWorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys: EstateInspectionTemplate
ALTER TABLE "EstateInspectionTemplate"
  ADD CONSTRAINT "EstateInspectionTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateInspectionTemplate_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: EstateEmergencyAlert
ALTER TABLE "EstateEmergencyAlert"
  ADD CONSTRAINT "EstateEmergencyAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EstateEmergencyAlert_estateId_fkey"    FOREIGN KEY ("estateId")    REFERENCES "Estate"("id")     ON DELETE SET NULL ON UPDATE CASCADE;
