-- CreateEnum
CREATE TYPE "PropertyCommunityChannelKey" AS ENUM ('GENERAL', 'MARKETPLACE', 'UPDATES', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('RECEIVED', 'NOTIFIED', 'PICKED_UP', 'RETURNED');

-- CreateTable
CREATE TABLE "ApartmentHouseholdMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentHouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateHouseholdMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateHouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentVehicle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateVehicle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentParcel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "residentId" TEXT,
    "unitId" TEXT,
    "recipientName" TEXT NOT NULL,
    "courierName" TEXT,
    "description" TEXT,
    "trackingCode" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "receivedByName" TEXT,
    "pickupByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateParcel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "estateId" TEXT,
    "residentId" TEXT,
    "unitId" TEXT,
    "recipientName" TEXT NOT NULL,
    "courierName" TEXT,
    "description" TEXT,
    "trackingCode" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "receivedByName" TEXT,
    "pickupByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentCommunityChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" "PropertyCommunityChannelKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentCommunityChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentCommunityMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApartmentCommunityMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateCommunityChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" "PropertyCommunityChannelKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateCommunityChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateCommunityMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstateCommunityMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApartmentHouseholdMember_workspaceId_idx" ON "ApartmentHouseholdMember"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentHouseholdMember_residentId_idx" ON "ApartmentHouseholdMember"("residentId");

-- CreateIndex
CREATE INDEX "ApartmentHouseholdMember_workspaceId_residentId_idx" ON "ApartmentHouseholdMember"("workspaceId", "residentId");

-- CreateIndex
CREATE INDEX "EstateHouseholdMember_workspaceId_idx" ON "EstateHouseholdMember"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateHouseholdMember_residentId_idx" ON "EstateHouseholdMember"("residentId");

-- CreateIndex
CREATE INDEX "EstateHouseholdMember_workspaceId_residentId_idx" ON "EstateHouseholdMember"("workspaceId", "residentId");

-- CreateIndex
CREATE INDEX "ApartmentVehicle_workspaceId_idx" ON "ApartmentVehicle"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentVehicle_residentId_idx" ON "ApartmentVehicle"("residentId");

-- CreateIndex
CREATE INDEX "ApartmentVehicle_workspaceId_residentId_idx" ON "ApartmentVehicle"("workspaceId", "residentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApartmentVehicle_workspaceId_plateNumber_key" ON "ApartmentVehicle"("workspaceId", "plateNumber");

-- CreateIndex
CREATE INDEX "EstateVehicle_workspaceId_idx" ON "EstateVehicle"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateVehicle_residentId_idx" ON "EstateVehicle"("residentId");

-- CreateIndex
CREATE INDEX "EstateVehicle_workspaceId_residentId_idx" ON "EstateVehicle"("workspaceId", "residentId");

-- CreateIndex
CREATE UNIQUE INDEX "EstateVehicle_workspaceId_plateNumber_key" ON "EstateVehicle"("workspaceId", "plateNumber");

-- CreateIndex
CREATE INDEX "ApartmentParcel_workspaceId_idx" ON "ApartmentParcel"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentParcel_residentId_idx" ON "ApartmentParcel"("residentId");

-- CreateIndex
CREATE INDEX "ApartmentParcel_unitId_idx" ON "ApartmentParcel"("unitId");

-- CreateIndex
CREATE INDEX "ApartmentParcel_workspaceId_status_idx" ON "ApartmentParcel"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ApartmentParcel_workspaceId_createdAt_idx" ON "ApartmentParcel"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "EstateParcel_workspaceId_idx" ON "EstateParcel"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateParcel_estateId_idx" ON "EstateParcel"("estateId");

-- CreateIndex
CREATE INDEX "EstateParcel_residentId_idx" ON "EstateParcel"("residentId");

-- CreateIndex
CREATE INDEX "EstateParcel_unitId_idx" ON "EstateParcel"("unitId");

-- CreateIndex
CREATE INDEX "EstateParcel_workspaceId_status_idx" ON "EstateParcel"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "EstateParcel_workspaceId_createdAt_idx" ON "EstateParcel"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ApartmentCommunityChannel_workspaceId_idx" ON "ApartmentCommunityChannel"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ApartmentCommunityChannel_workspaceId_key_key" ON "ApartmentCommunityChannel"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "ApartmentCommunityMessage_workspaceId_idx" ON "ApartmentCommunityMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentCommunityMessage_channelId_idx" ON "ApartmentCommunityMessage"("channelId");

-- CreateIndex
CREATE INDEX "ApartmentCommunityMessage_workspaceId_channelId_createdAt_idx" ON "ApartmentCommunityMessage"("workspaceId", "channelId", "createdAt");

-- CreateIndex
CREATE INDEX "EstateCommunityChannel_workspaceId_idx" ON "EstateCommunityChannel"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EstateCommunityChannel_workspaceId_key_key" ON "EstateCommunityChannel"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "EstateCommunityMessage_workspaceId_idx" ON "EstateCommunityMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateCommunityMessage_channelId_idx" ON "EstateCommunityMessage"("channelId");

-- CreateIndex
CREATE INDEX "EstateCommunityMessage_workspaceId_channelId_createdAt_idx" ON "EstateCommunityMessage"("workspaceId", "channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApartmentHouseholdMember" ADD CONSTRAINT "ApartmentHouseholdMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentHouseholdMember" ADD CONSTRAINT "ApartmentHouseholdMember_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ApartmentResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateHouseholdMember" ADD CONSTRAINT "EstateHouseholdMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateHouseholdMember" ADD CONSTRAINT "EstateHouseholdMember_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentVehicle" ADD CONSTRAINT "ApartmentVehicle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentVehicle" ADD CONSTRAINT "ApartmentVehicle_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ApartmentResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateVehicle" ADD CONSTRAINT "EstateVehicle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateVehicle" ADD CONSTRAINT "EstateVehicle_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentParcel" ADD CONSTRAINT "ApartmentParcel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentParcel" ADD CONSTRAINT "ApartmentParcel_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ApartmentResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentParcel" ADD CONSTRAINT "ApartmentParcel_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ApartmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateParcel" ADD CONSTRAINT "EstateParcel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateParcel" ADD CONSTRAINT "EstateParcel_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateParcel" ADD CONSTRAINT "EstateParcel_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateParcel" ADD CONSTRAINT "EstateParcel_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentCommunityChannel" ADD CONSTRAINT "ApartmentCommunityChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentCommunityMessage" ADD CONSTRAINT "ApartmentCommunityMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentCommunityMessage" ADD CONSTRAINT "ApartmentCommunityMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ApartmentCommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateCommunityChannel" ADD CONSTRAINT "EstateCommunityChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateCommunityMessage" ADD CONSTRAINT "EstateCommunityMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateCommunityMessage" ADD CONSTRAINT "EstateCommunityMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "EstateCommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
