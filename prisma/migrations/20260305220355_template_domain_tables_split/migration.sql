-- CreateTable
CREATE TABLE "ApartmentUnit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "block" TEXT,
    "floor" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'VACANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentResident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" "ResidentRole" NOT NULL DEFAULT 'TENANT',
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoUrl" TEXT,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateUnit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "estateId" TEXT,
    "label" TEXT NOT NULL,
    "block" TEXT,
    "floor" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'VACANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateResident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" "ResidentRole" NOT NULL DEFAULT 'TENANT',
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoUrl" TEXT,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serialNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeWorkOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeWorkOrder_pkey" PRIMARY KEY ("id")
);

-- Backfill APARTMENT domain tables from shared tables
INSERT INTO "ApartmentUnit" ("id", "workspaceId", "label", "block", "floor", "status", "createdAt", "updatedAt")
SELECT u."id", u."workspaceId", u."label", u."block", u."floor", u."status", u."createdAt", u."updatedAt"
FROM "Unit" u
JOIN "Workspace" w ON w."id" = u."workspaceId"
WHERE w."templateType" = 'APARTMENT'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ApartmentResident" ("id", "workspaceId", "unitId", "fullName", "phone", "email", "role", "status", "createdAt", "updatedAt")
SELECT r."id", r."workspaceId", r."unitId", r."fullName", r."phone", r."email", r."role", r."status", r."createdAt", r."updatedAt"
FROM "Resident" r
JOIN "Workspace" w ON w."id" = r."workspaceId"
WHERE w."templateType" = 'APARTMENT'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ApartmentRequest" ("id", "workspaceId", "unitId", "residentId", "title", "description", "photoUrl", "priority", "status", "createdAt", "updatedAt")
SELECT q."id", q."workspaceId", q."unitId", q."residentId", q."title", q."description", q."photoUrl", q."priority", q."status", q."createdAt", q."updatedAt"
FROM "Request" q
JOIN "Workspace" w ON w."id" = q."workspaceId"
WHERE w."templateType" = 'APARTMENT'
ON CONFLICT ("id") DO NOTHING;

-- Backfill ESTATE domain tables from shared tables
INSERT INTO "EstateUnit" ("id", "workspaceId", "estateId", "label", "block", "floor", "status", "createdAt", "updatedAt")
SELECT u."id", u."workspaceId", u."estateId", u."label", u."block", u."floor", u."status", u."createdAt", u."updatedAt"
FROM "Unit" u
JOIN "Workspace" w ON w."id" = u."workspaceId"
WHERE w."templateType" = 'ESTATE'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EstateResident" ("id", "workspaceId", "unitId", "fullName", "phone", "email", "role", "status", "createdAt", "updatedAt")
SELECT r."id", r."workspaceId", r."unitId", r."fullName", r."phone", r."email", r."role", r."status", r."createdAt", r."updatedAt"
FROM "Resident" r
JOIN "Workspace" w ON w."id" = r."workspaceId"
WHERE w."templateType" = 'ESTATE'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EstateRequest" ("id", "workspaceId", "unitId", "residentId", "title", "description", "photoUrl", "priority", "status", "createdAt", "updatedAt")
SELECT q."id", q."workspaceId", q."unitId", q."residentId", q."title", q."description", q."photoUrl", q."priority", q."status", q."createdAt", q."updatedAt"
FROM "Request" q
JOIN "Workspace" w ON w."id" = q."workspaceId"
WHERE w."templateType" = 'ESTATE'
ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE INDEX "ApartmentUnit_workspaceId_idx" ON "ApartmentUnit"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentUnit_workspaceId_status_idx" ON "ApartmentUnit"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApartmentUnit_workspaceId_label_key" ON "ApartmentUnit"("workspaceId", "label");

-- CreateIndex
CREATE INDEX "ApartmentResident_workspaceId_idx" ON "ApartmentResident"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentResident_unitId_idx" ON "ApartmentResident"("unitId");

-- CreateIndex
CREATE INDEX "ApartmentRequest_workspaceId_idx" ON "ApartmentRequest"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentRequest_unitId_idx" ON "ApartmentRequest"("unitId");

-- CreateIndex
CREATE INDEX "ApartmentRequest_residentId_idx" ON "ApartmentRequest"("residentId");

-- CreateIndex
CREATE INDEX "ApartmentRequest_workspaceId_status_idx" ON "ApartmentRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "EstateUnit_workspaceId_idx" ON "EstateUnit"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateUnit_estateId_idx" ON "EstateUnit"("estateId");

-- CreateIndex
CREATE UNIQUE INDEX "EstateUnit_workspaceId_label_key" ON "EstateUnit"("workspaceId", "label");

-- CreateIndex
CREATE INDEX "EstateResident_workspaceId_idx" ON "EstateResident"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateResident_unitId_idx" ON "EstateResident"("unitId");

-- CreateIndex
CREATE INDEX "EstateRequest_workspaceId_idx" ON "EstateRequest"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateRequest_unitId_idx" ON "EstateRequest"("unitId");

-- CreateIndex
CREATE INDEX "EstateRequest_residentId_idx" ON "EstateRequest"("residentId");

-- CreateIndex
CREATE INDEX "EstateRequest_workspaceId_status_idx" ON "EstateRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OfficeAsset_workspaceId_idx" ON "OfficeAsset"("workspaceId");

-- CreateIndex
CREATE INDEX "OfficeAsset_workspaceId_status_idx" ON "OfficeAsset"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OfficeWorkOrder_workspaceId_idx" ON "OfficeWorkOrder"("workspaceId");

-- CreateIndex
CREATE INDEX "OfficeWorkOrder_assetId_idx" ON "OfficeWorkOrder"("assetId");

-- CreateIndex
CREATE INDEX "OfficeWorkOrder_workspaceId_status_idx" ON "OfficeWorkOrder"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "ApartmentUnit" ADD CONSTRAINT "ApartmentUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentResident" ADD CONSTRAINT "ApartmentResident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentResident" ADD CONSTRAINT "ApartmentResident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ApartmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentRequest" ADD CONSTRAINT "ApartmentRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentRequest" ADD CONSTRAINT "ApartmentRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ApartmentUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentRequest" ADD CONSTRAINT "ApartmentRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ApartmentResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateUnit" ADD CONSTRAINT "EstateUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateUnit" ADD CONSTRAINT "EstateUnit_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateResident" ADD CONSTRAINT "EstateResident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateResident" ADD CONSTRAINT "EstateResident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateRequest" ADD CONSTRAINT "EstateRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateRequest" ADD CONSTRAINT "EstateRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateRequest" ADD CONSTRAINT "EstateRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "EstateResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeAsset" ADD CONSTRAINT "OfficeAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeWorkOrder" ADD CONSTRAINT "OfficeWorkOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeWorkOrder" ADD CONSTRAINT "OfficeWorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "OfficeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

