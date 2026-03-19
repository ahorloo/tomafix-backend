-- Add logoUrl to TechnicianApplication
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- Add adminNotes to Workspace
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;

-- Add adminNotes to TechnicianApplication
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;

-- Add serviceAreaLocations to TechnicianApplication
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "serviceAreaLocations" JSONB;

-- Add businessLocationUrl and serviceAreaLinks to TechnicianApplication
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "businessLocationUrl" TEXT;
ALTER TABLE "TechnicianApplication" ADD COLUMN IF NOT EXISTS "serviceAreaLinks" TEXT[] DEFAULT ARRAY[]::TEXT[];
