-- Add templateId as nullable first
ALTER TABLE "Plan" ADD COLUMN "templateId" TEXT;

-- Ensure template rows exist
INSERT INTO "Template" ("id", "key", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'APARTMENT'), 'APARTMENT', 'Apartment Building', 'Owners + tenants, requests, notices, inspections', true, NOW(), NOW()),
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'OFFICE'), 'OFFICE', 'Office / Company Facility', 'Facilities workflow, assets, inspections', true, NOW(), NOW()),
  ('tpl_' || md5(random()::text || clock_timestamp()::text || 'ESTATE'), 'ESTATE', 'Estate / Multi-property', 'Multi-property admin workflow in one workspace', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Backfill existing legacy plans to APARTMENT template
UPDATE "Plan" p
SET "templateId" = t."id"
FROM "Template" t
WHERE t."key" = 'APARTMENT'
  AND p."templateId" IS NULL;

-- Remove legacy duplicates for clean unique (templateId,name,interval)
DELETE FROM "Plan" a
USING "Plan" b
WHERE a."id" < b."id"
  AND a."templateId" = b."templateId"
  AND a."name" = b."name"
  AND a."interval" = b."interval";

-- Enforce not-null now that data is backfilled
ALTER TABLE "Plan" ALTER COLUMN "templateId" SET NOT NULL;

-- Replace old index strategy
DROP INDEX IF EXISTS "Plan_isActive_idx";
CREATE INDEX "Plan_templateId_isActive_idx" ON "Plan"("templateId", "isActive");
CREATE UNIQUE INDEX "Plan_templateId_name_interval_key" ON "Plan"("templateId", "name", "interval");

-- Foreign key
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
