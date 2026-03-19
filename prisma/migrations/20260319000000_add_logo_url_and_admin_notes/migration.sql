-- Add logoUrl to TechnicianApplication
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- Add adminNotes to Workspace
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;
