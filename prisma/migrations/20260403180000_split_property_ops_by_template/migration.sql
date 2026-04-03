CREATE TABLE "ApartmentNotice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
  "seenBy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EstateNotice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
  "seenBy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficeNotice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" "NoticeAudience" NOT NULL DEFAULT 'ALL',
  "seenBy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfficeNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApartmentInspection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "unitId" TEXT,
  "scope" "InspectionScope" NOT NULL DEFAULT 'UNIT',
  "block" TEXT,
  "floor" TEXT,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "checklist" JSONB,
  "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApartmentInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EstateInspection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "estateId" TEXT,
  "unitId" TEXT,
  "scope" "InspectionScope" NOT NULL DEFAULT 'UNIT',
  "block" TEXT,
  "floor" TEXT,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "checklist" JSONB,
  "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstateInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficeInspection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "areaId" TEXT,
  "scope" "InspectionScope" NOT NULL DEFAULT 'UNIT',
  "block" TEXT,
  "floor" TEXT,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "checklist" JSONB,
  "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfficeInspection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApartmentNotice_workspaceId_idx" ON "ApartmentNotice"("workspaceId");
CREATE INDEX "ApartmentNotice_createdAt_idx" ON "ApartmentNotice"("createdAt");
CREATE INDEX "ApartmentNotice_workspaceId_audience_createdAt_idx" ON "ApartmentNotice"("workspaceId", "audience", "createdAt");

CREATE INDEX "EstateNotice_workspaceId_idx" ON "EstateNotice"("workspaceId");
CREATE INDEX "EstateNotice_estateId_idx" ON "EstateNotice"("estateId");
CREATE INDEX "EstateNotice_workspaceId_estateId_audience_createdAt_idx" ON "EstateNotice"("workspaceId", "estateId", "audience", "createdAt");
CREATE INDEX "EstateNotice_createdAt_idx" ON "EstateNotice"("createdAt");

CREATE INDEX "OfficeNotice_workspaceId_idx" ON "OfficeNotice"("workspaceId");
CREATE INDEX "OfficeNotice_createdAt_idx" ON "OfficeNotice"("createdAt");
CREATE INDEX "OfficeNotice_workspaceId_audience_createdAt_idx" ON "OfficeNotice"("workspaceId", "audience", "createdAt");

CREATE INDEX "ApartmentInspection_workspaceId_idx" ON "ApartmentInspection"("workspaceId");
CREATE INDEX "ApartmentInspection_unitId_idx" ON "ApartmentInspection"("unitId");
CREATE INDEX "ApartmentInspection_workspaceId_scope_block_floor_idx" ON "ApartmentInspection"("workspaceId", "scope", "block", "floor");
CREATE INDEX "ApartmentInspection_workspaceId_dueDate_idx" ON "ApartmentInspection"("workspaceId", "dueDate");

CREATE INDEX "EstateInspection_workspaceId_idx" ON "EstateInspection"("workspaceId");
CREATE INDEX "EstateInspection_estateId_idx" ON "EstateInspection"("estateId");
CREATE INDEX "EstateInspection_unitId_idx" ON "EstateInspection"("unitId");
CREATE INDEX "EstateInspection_workspaceId_estateId_scope_block_floor_idx" ON "EstateInspection"("workspaceId", "estateId", "scope", "block", "floor");
CREATE INDEX "EstateInspection_workspaceId_estateId_dueDate_idx" ON "EstateInspection"("workspaceId", "estateId", "dueDate");

CREATE INDEX "OfficeInspection_workspaceId_idx" ON "OfficeInspection"("workspaceId");
CREATE INDEX "OfficeInspection_areaId_idx" ON "OfficeInspection"("areaId");
CREATE INDEX "OfficeInspection_workspaceId_scope_block_floor_idx" ON "OfficeInspection"("workspaceId", "scope", "block", "floor");
CREATE INDEX "OfficeInspection_workspaceId_dueDate_idx" ON "OfficeInspection"("workspaceId", "dueDate");

ALTER TABLE "ApartmentNotice"
  ADD CONSTRAINT "ApartmentNotice_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstateNotice"
  ADD CONSTRAINT "EstateNotice_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstateNotice"
  ADD CONSTRAINT "EstateNotice_estateId_fkey"
  FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfficeNotice"
  ADD CONSTRAINT "OfficeNotice_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApartmentInspection"
  ADD CONSTRAINT "ApartmentInspection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApartmentInspection"
  ADD CONSTRAINT "ApartmentInspection_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "ApartmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstateInspection"
  ADD CONSTRAINT "EstateInspection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstateInspection"
  ADD CONSTRAINT "EstateInspection_estateId_fkey"
  FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstateInspection"
  ADD CONSTRAINT "EstateInspection_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "EstateUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfficeInspection"
  ADD CONSTRAINT "OfficeInspection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeInspection"
  ADD CONSTRAINT "OfficeInspection_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "OfficeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ApartmentNotice" ("id", "workspaceId", "title", "body", "audience", "seenBy", "createdAt", "updatedAt")
SELECT n."id", n."workspaceId", n."title", n."body", n."audience", n."seenBy", n."createdAt", n."updatedAt"
FROM "Notice" n
JOIN "Workspace" w ON w."id" = n."workspaceId"
WHERE w."templateType" = 'APARTMENT';

INSERT INTO "EstateNotice" ("id", "workspaceId", "estateId", "title", "body", "audience", "seenBy", "createdAt", "updatedAt")
SELECT n."id", n."workspaceId", e."id", n."title", n."body", n."audience", n."seenBy", n."createdAt", n."updatedAt"
FROM "Notice" n
JOIN "Workspace" w ON w."id" = n."workspaceId"
LEFT JOIN "Estate" e ON e."id" = n."estateId" AND e."workspaceId" = n."workspaceId"
WHERE w."templateType" = 'ESTATE';

INSERT INTO "OfficeNotice" ("id", "workspaceId", "title", "body", "audience", "seenBy", "createdAt", "updatedAt")
SELECT n."id", n."workspaceId", n."title", n."body", n."audience", n."seenBy", n."createdAt", n."updatedAt"
FROM "Notice" n
JOIN "Workspace" w ON w."id" = n."workspaceId"
WHERE w."templateType" = 'OFFICE';

INSERT INTO "ApartmentInspection" ("id", "workspaceId", "unitId", "scope", "block", "floor", "title", "dueDate", "checklist", "status", "result", "createdAt", "updatedAt")
SELECT i."id", i."workspaceId", au."id", i."scope", i."block", i."floor", i."title", i."dueDate", i."checklist", i."status", i."result", i."createdAt", i."updatedAt"
FROM "Inspection" i
JOIN "Workspace" w ON w."id" = i."workspaceId"
LEFT JOIN "ApartmentUnit" au ON au."id" = i."unitId" AND au."workspaceId" = i."workspaceId"
WHERE w."templateType" = 'APARTMENT';

INSERT INTO "EstateInspection" ("id", "workspaceId", "estateId", "unitId", "scope", "block", "floor", "title", "dueDate", "checklist", "status", "result", "createdAt", "updatedAt")
SELECT
  i."id",
  i."workspaceId",
  COALESCE(e."id", eu."estateId"),
  eu."id",
  i."scope",
  i."block",
  i."floor",
  i."title",
  i."dueDate",
  i."checklist",
  i."status",
  i."result",
  i."createdAt",
  i."updatedAt"
FROM "Inspection" i
JOIN "Workspace" w ON w."id" = i."workspaceId"
LEFT JOIN "EstateUnit" eu ON eu."id" = i."unitId" AND eu."workspaceId" = i."workspaceId"
LEFT JOIN "Estate" e ON e."id" = i."estateId" AND e."workspaceId" = i."workspaceId"
WHERE w."templateType" = 'ESTATE';

INSERT INTO "OfficeInspection" ("id", "workspaceId", "areaId", "scope", "block", "floor", "title", "dueDate", "checklist", "status", "result", "createdAt", "updatedAt")
SELECT i."id", i."workspaceId", NULL, i."scope", i."block", i."floor", i."title", i."dueDate", i."checklist", i."status", i."result", i."createdAt", i."updatedAt"
FROM "Inspection" i
JOIN "Workspace" w ON w."id" = i."workspaceId"
WHERE w."templateType" = 'OFFICE';

DROP TABLE "Notice";
DROP TABLE "Inspection";
DROP TABLE IF EXISTS "Property";
