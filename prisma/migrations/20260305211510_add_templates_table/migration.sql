-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "key" "TemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Template_key_key" ON "Template"("key");

-- Seed default template rows
INSERT INTO "Template" ("id", "key", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'APARTMENT'), 'APARTMENT', 'Apartment Building', 'Owners + tenants, requests, notices, inspections', true, NOW(), NOW()),
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'OFFICE'), 'OFFICE', 'Office / Company Facility', 'Facilities workflow, assets, inspections', true, NOW(), NOW()),
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'ESTATE'), 'ESTATE', 'Estate / Multi-property', 'Multi-property admin workflow in one workspace', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Backfill existing workspaces to the new template relation
UPDATE "Workspace" w
SET "templateId" = t."id"
FROM "Template" t
WHERE t."key" = w."templateType"
  AND w."templateId" IS NULL;

-- CreateIndex
CREATE INDEX "Workspace_templateId_idx" ON "Workspace"("templateId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

