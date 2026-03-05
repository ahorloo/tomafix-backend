-- DropForeignKey
ALTER TABLE "Inspection" DROP CONSTRAINT "Inspection_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Request" DROP CONSTRAINT "Request_residentId_fkey";

-- DropForeignKey
ALTER TABLE "Request" DROP CONSTRAINT "Request_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Request" DROP CONSTRAINT "Request_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Resident" DROP CONSTRAINT "Resident_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Resident" DROP CONSTRAINT "Resident_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Unit" DROP CONSTRAINT "Unit_estateId_fkey";

-- DropForeignKey
ALTER TABLE "Unit" DROP CONSTRAINT "Unit_workspaceId_fkey";

-- DropTable
DROP TABLE "Request";

-- DropTable
DROP TABLE "Resident";

-- DropTable
DROP TABLE "Unit";

