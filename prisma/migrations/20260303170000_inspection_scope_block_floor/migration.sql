-- Add inspection scope targeting (unit/block/floor)
DO $$ BEGIN
  CREATE TYPE "InspectionScope" AS ENUM ('UNIT', 'BLOCK', 'FLOOR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Inspection"
  ADD COLUMN IF NOT EXISTS "scope" "InspectionScope" NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS "block" TEXT,
  ADD COLUMN IF NOT EXISTS "floor" TEXT;

-- Backfill scope metadata for existing unit inspections
UPDATE "Inspection" i
SET "block" = u."block",
    "floor" = u."floor"
FROM "Unit" u
WHERE i."unitId" = u.id
  AND i."workspaceId" = u."workspaceId"
  AND i."scope" = 'UNIT'
  AND (i."block" IS NULL OR i."floor" IS NULL);

CREATE INDEX IF NOT EXISTS "Inspection_workspaceId_scope_block_floor_idx"
  ON "Inspection"("workspaceId", "scope", "block", "floor");