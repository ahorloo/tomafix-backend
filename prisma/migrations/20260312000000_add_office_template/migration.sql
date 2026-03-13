-- CreateEnum
CREATE TYPE "OfficeAreaType" AS ENUM ('FLOOR', 'OFFICE', 'MEETING_ROOM', 'SERVER_ROOM', 'RECEPTION', 'RESTROOM', 'CAFETERIA', 'OTHER');

-- CreateEnum
CREATE TYPE "OfficeRequestCategory" AS ENUM ('FACILITY', 'IT');

-- CreateTable
CREATE TABLE "OfficeArea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OfficeAreaType" NOT NULL DEFAULT 'OTHER',
    "floor" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "submitterUserId" TEXT,
    "submitterName" TEXT NOT NULL,
    "category" "OfficeRequestCategory" NOT NULL DEFAULT 'FACILITY',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoUrl" TEXT,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "workOrderId" TEXT,
    "slaDeadline" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeRequestMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeRequestMessage_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add new columns to OfficeAsset
ALTER TABLE "OfficeAsset"
    ADD COLUMN "location" TEXT,
    ADD COLUMN "lastServicedAt" TIMESTAMP(3),
    ADD COLUMN "nextServiceAt" TIMESTAMP(3),
    ADD COLUMN "notes" TEXT;

-- AlterTable: add new columns to OfficeWorkOrder
ALTER TABLE "OfficeWorkOrder"
    ADD COLUMN "areaId" TEXT,
    ADD COLUMN "assignedToUserId" TEXT,
    ADD COLUMN "category" "OfficeRequestCategory" NOT NULL DEFAULT 'FACILITY',
    ADD COLUMN "slaDeadline" TIMESTAMP(3),
    ADD COLUMN "completionNote" TEXT,
    ADD COLUMN "proofPhotoUrl" TEXT,
    ADD COLUMN "closedAt" TIMESTAMP(3);

-- AlterTable: update priority column type on OfficeWorkOrder (was TEXT, now enum)
ALTER TABLE "OfficeWorkOrder"
    ALTER COLUMN "priority" DROP DEFAULT;

ALTER TABLE "OfficeWorkOrder"
    ALTER COLUMN "priority" TYPE "RequestPriority" USING "priority"::"RequestPriority";

ALTER TABLE "OfficeWorkOrder"
    ALTER COLUMN "priority" SET DEFAULT 'NORMAL';

-- CreateIndex
CREATE UNIQUE INDEX "OfficeArea_workspaceId_name_key" ON "OfficeArea"("workspaceId", "name");
CREATE INDEX "OfficeArea_workspaceId_idx" ON "OfficeArea"("workspaceId");
CREATE INDEX "OfficeArea_workspaceId_type_idx" ON "OfficeArea"("workspaceId", "type");

CREATE INDEX "OfficeRequest_workspaceId_idx" ON "OfficeRequest"("workspaceId");
CREATE INDEX "OfficeRequest_areaId_idx" ON "OfficeRequest"("areaId");
CREATE INDEX "OfficeRequest_workspaceId_status_idx" ON "OfficeRequest"("workspaceId", "status");
CREATE INDEX "OfficeRequest_workspaceId_category_idx" ON "OfficeRequest"("workspaceId", "category");
CREATE INDEX "OfficeRequest_workspaceId_status_createdAt_idx" ON "OfficeRequest"("workspaceId", "status", "createdAt");

CREATE INDEX "OfficeRequestMessage_workspaceId_idx" ON "OfficeRequestMessage"("workspaceId");
CREATE INDEX "OfficeRequestMessage_requestId_idx" ON "OfficeRequestMessage"("requestId");
CREATE INDEX "OfficeRequestMessage_workspaceId_requestId_createdAt_idx" ON "OfficeRequestMessage"("workspaceId", "requestId", "createdAt");

CREATE INDEX "OfficeWorkOrder_areaId_idx" ON "OfficeWorkOrder"("areaId");
CREATE INDEX "OfficeWorkOrder_workspaceId_assignedToUserId_idx" ON "OfficeWorkOrder"("workspaceId", "assignedToUserId");

-- AddForeignKey
ALTER TABLE "OfficeArea" ADD CONSTRAINT "OfficeArea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeRequest" ADD CONSTRAINT "OfficeRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeRequest" ADD CONSTRAINT "OfficeRequest_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "OfficeArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeRequestMessage" ADD CONSTRAINT "OfficeRequestMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeRequestMessage" ADD CONSTRAINT "OfficeRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OfficeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeWorkOrder" ADD CONSTRAINT "OfficeWorkOrder_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "OfficeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
