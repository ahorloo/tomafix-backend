-- CreateEnum
CREATE TYPE "TechnicianApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TechnicianApplication" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "businessAddress" TEXT NOT NULL,
    "serviceAreas" TEXT NOT NULL,
    "categories" TEXT[],
    "yearsInOperation" TEXT,
    "teamSize" TEXT,
    "bio" TEXT,
    "website" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "TechnicianApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianApplication_status_idx" ON "TechnicianApplication"("status");

-- CreateIndex
CREATE INDEX "TechnicianApplication_createdAt_idx" ON "TechnicianApplication"("createdAt");
