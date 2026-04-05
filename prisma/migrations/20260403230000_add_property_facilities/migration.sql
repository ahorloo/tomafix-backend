-- CreateEnum
CREATE TYPE "AmenityBookingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "ApartmentAmenity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "capacity" INTEGER,
    "feeAmount" DOUBLE PRECISION,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentAmenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentAmenityBooking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AmenityBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "feeAmount" DOUBLE PRECISION,
    "responseNote" TEXT,
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentAmenityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateAmenity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "estateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "capacity" INTEGER,
    "feeAmount" DOUBLE PRECISION,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateAmenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateAmenityBooking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "estateId" TEXT,
    "amenityId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AmenityBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "feeAmount" DOUBLE PRECISION,
    "responseNote" TEXT,
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateAmenityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApartmentAmenity_workspaceId_idx" ON "ApartmentAmenity"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentAmenity_workspaceId_isActive_idx" ON "ApartmentAmenity"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApartmentAmenity_workspaceId_name_key" ON "ApartmentAmenity"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_workspaceId_idx" ON "ApartmentAmenityBooking"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_amenityId_idx" ON "ApartmentAmenityBooking"("amenityId");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_residentId_idx" ON "ApartmentAmenityBooking"("residentId");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_unitId_idx" ON "ApartmentAmenityBooking"("unitId");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_workspaceId_status_idx" ON "ApartmentAmenityBooking"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_workspaceId_startAt_idx" ON "ApartmentAmenityBooking"("workspaceId", "startAt");

-- CreateIndex
CREATE INDEX "ApartmentAmenityBooking_workspaceId_amenityId_startAt_idx" ON "ApartmentAmenityBooking"("workspaceId", "amenityId", "startAt");

-- CreateIndex
CREATE INDEX "EstateAmenity_workspaceId_idx" ON "EstateAmenity"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateAmenity_estateId_idx" ON "EstateAmenity"("estateId");

-- CreateIndex
CREATE INDEX "EstateAmenity_workspaceId_isActive_idx" ON "EstateAmenity"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EstateAmenity_workspaceId_estateId_name_key" ON "EstateAmenity"("workspaceId", "estateId", "name");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_workspaceId_idx" ON "EstateAmenityBooking"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_estateId_idx" ON "EstateAmenityBooking"("estateId");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_amenityId_idx" ON "EstateAmenityBooking"("amenityId");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_residentId_idx" ON "EstateAmenityBooking"("residentId");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_unitId_idx" ON "EstateAmenityBooking"("unitId");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_workspaceId_status_idx" ON "EstateAmenityBooking"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_workspaceId_startAt_idx" ON "EstateAmenityBooking"("workspaceId", "startAt");

-- CreateIndex
CREATE INDEX "EstateAmenityBooking_workspaceId_amenityId_startAt_idx" ON "EstateAmenityBooking"("workspaceId", "amenityId", "startAt");

-- AddForeignKey
ALTER TABLE "ApartmentAmenity" ADD CONSTRAINT "ApartmentAmenity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentAmenityBooking" ADD CONSTRAINT "ApartmentAmenityBooking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentAmenityBooking" ADD CONSTRAINT "ApartmentAmenityBooking_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "ApartmentAmenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentAmenityBooking" ADD CONSTRAINT "ApartmentAmenityBooking_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ApartmentResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentAmenityBooking" ADD CONSTRAINT "ApartmentAmenityBooking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ApartmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenity" ADD CONSTRAINT "EstateAmenity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenity" ADD CONSTRAINT "EstateAmenity_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenityBooking" ADD CONSTRAINT "EstateAmenityBooking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenityBooking" ADD CONSTRAINT "EstateAmenityBooking_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenityBooking" ADD CONSTRAINT "EstateAmenityBooking_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "EstateAmenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenityBooking" ADD CONSTRAINT "EstateAmenityBooking_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateAmenityBooking" ADD CONSTRAINT "EstateAmenityBooking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
