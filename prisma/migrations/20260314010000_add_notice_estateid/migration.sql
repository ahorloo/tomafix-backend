-- Migration: add_notice_estateid
-- Adds estateId column to Notice table which was missing in production DB

ALTER TABLE "Notice"
  ADD COLUMN IF NOT EXISTS "estateId" TEXT;

ALTER TABLE "Notice"
  ADD CONSTRAINT "Notice_estateId_fkey"
  FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Notice_estateId_idx" ON "Notice"("estateId");
CREATE INDEX IF NOT EXISTS "Notice_workspaceId_createdAt_idx" ON "Notice"("workspaceId", "createdAt");
