CREATE TABLE IF NOT EXISTS "StaffBlockAssignment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StaffBlockAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffBlockAssignment_workspaceId_staffUserId_block_key"
  ON "StaffBlockAssignment"("workspaceId", "staffUserId", "block");

CREATE INDEX IF NOT EXISTS "StaffBlockAssignment_workspaceId_staffUserId_idx"
  ON "StaffBlockAssignment"("workspaceId", "staffUserId");

CREATE INDEX IF NOT EXISTS "StaffBlockAssignment_workspaceId_block_idx"
  ON "StaffBlockAssignment"("workspaceId", "block");

DO $$ BEGIN
  ALTER TABLE "StaffBlockAssignment"
  ADD CONSTRAINT "StaffBlockAssignment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "StaffBlockAssignment"
  ADD CONSTRAINT "StaffBlockAssignment_staffUserId_fkey"
  FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
