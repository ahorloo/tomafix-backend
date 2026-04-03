DO $$
BEGIN
  CREATE TYPE "EstateChargeStatus" AS ENUM ('POSTED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "EstateCharge" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId" TEXT,
  "unitId" TEXT,
  "residentId" TEXT,
  "title" TEXT NOT NULL,
  "category" TEXT,
  "notes" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" "EstateChargeStatus" NOT NULL DEFAULT 'POSTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EstateChargePayment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateChargePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EstateCharge_workspaceId_idx" ON "EstateCharge"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateCharge_estateId_idx" ON "EstateCharge"("estateId");
CREATE INDEX IF NOT EXISTS "EstateCharge_unitId_idx" ON "EstateCharge"("unitId");
CREATE INDEX IF NOT EXISTS "EstateCharge_residentId_idx" ON "EstateCharge"("residentId");
CREATE INDEX IF NOT EXISTS "EstateCharge_workspaceId_status_idx" ON "EstateCharge"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "EstateCharge_workspaceId_dueDate_idx" ON "EstateCharge"("workspaceId", "dueDate");
CREATE INDEX IF NOT EXISTS "EstateCharge_workspaceId_category_idx" ON "EstateCharge"("workspaceId", "category");

CREATE INDEX IF NOT EXISTS "EstateChargePayment_workspaceId_idx" ON "EstateChargePayment"("workspaceId");
CREATE INDEX IF NOT EXISTS "EstateChargePayment_chargeId_idx" ON "EstateChargePayment"("chargeId");
CREATE INDEX IF NOT EXISTS "EstateChargePayment_workspaceId_paidAt_idx" ON "EstateChargePayment"("workspaceId", "paidAt");

DO $$
BEGIN
  ALTER TABLE "EstateCharge"
    ADD CONSTRAINT "EstateCharge_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EstateCharge"
    ADD CONSTRAINT "EstateCharge_estateId_fkey"
    FOREIGN KEY ("estateId") REFERENCES "Estate"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EstateCharge"
    ADD CONSTRAINT "EstateCharge_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EstateCharge"
    ADD CONSTRAINT "EstateCharge_residentId_fkey"
    FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EstateChargePayment"
    ADD CONSTRAINT "EstateChargePayment_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EstateChargePayment"
    ADD CONSTRAINT "EstateChargePayment_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "EstateCharge"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
