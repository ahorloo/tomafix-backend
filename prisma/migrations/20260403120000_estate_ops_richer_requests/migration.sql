ALTER TYPE "ResidentRole" ADD VALUE IF NOT EXISTS 'OWNER';

ALTER TABLE "EstateRequest"
ADD COLUMN "category" TEXT,
ADD COLUMN "assignedToUserId" TEXT,
ADD COLUMN "assignedToName" TEXT,
ADD COLUMN "vendorName" TEXT,
ADD COLUMN "dueAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "estimatedCost" DOUBLE PRECISION;

CREATE INDEX "EstateRequest_workspaceId_category_idx" ON "EstateRequest"("workspaceId", "category");
CREATE INDEX "EstateRequest_workspaceId_assignedToUserId_idx" ON "EstateRequest"("workspaceId", "assignedToUserId");
CREATE INDEX "EstateRequest_workspaceId_dueAt_idx" ON "EstateRequest"("workspaceId", "dueAt");
