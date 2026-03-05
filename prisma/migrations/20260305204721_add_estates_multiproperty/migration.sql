-- DropIndex
DROP INDEX "Notice_workspaceId_audience_createdAt_idx";

-- DropIndex
DROP INDEX "Request_workspaceId_residentId_createdAt_idx";

-- DropIndex
DROP INDEX "Request_workspaceId_status_createdAt_idx";

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "estateId" TEXT;

-- CreateTable
CREATE TABLE "Estate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Estate_workspaceId_idx" ON "Estate"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Estate_workspaceId_name_key" ON "Estate"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Estate_workspaceId_code_key" ON "Estate"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "Notice_workspaceId_audience_createdAt_idx" ON "Notice"("workspaceId", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "Request_workspaceId_status_createdAt_idx" ON "Request"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Request_workspaceId_residentId_createdAt_idx" ON "Request"("workspaceId", "residentId", "createdAt");

-- CreateIndex
CREATE INDEX "Unit_estateId_idx" ON "Unit"("estateId");

-- AddForeignKey
ALTER TABLE "Estate" ADD CONSTRAINT "Estate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

