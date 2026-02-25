-- CreateEnum
CREATE TYPE "NoticeAudience" AS ENUM ('ALL', 'RESIDENTS', 'STAFF');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
    "seenBy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "checklist" JSONB,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notice_workspaceId_idx" ON "Notice"("workspaceId");

-- CreateIndex
CREATE INDEX "Notice_createdAt_idx" ON "Notice"("createdAt");

-- CreateIndex
CREATE INDEX "Inspection_workspaceId_idx" ON "Inspection"("workspaceId");

-- CreateIndex
CREATE INDEX "Inspection_unitId_idx" ON "Inspection"("unitId");

-- CreateIndex
CREATE INDEX "Inspection_dueDate_idx" ON "Inspection"("dueDate");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
