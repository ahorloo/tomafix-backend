import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [
    aptWs,
    estWs,
    aptUnits,
    estUnits,
    aptResidents,
    estResidents,
    aptRequests,
    estRequests,
    aptInspections,
    estInspections,
    officeInspections,
  ] = await Promise.all([
    prisma.workspace.count({ where: { templateType: 'APARTMENT' } }),
    prisma.workspace.count({ where: { templateType: 'ESTATE' } }),
    prisma.apartmentUnit.count(),
    prisma.estateUnit.count(),
    prisma.apartmentResident.count(),
    prisma.estateResident.count(),
    prisma.apartmentRequest.count(),
    prisma.estateRequest.count(),
    prisma.apartmentInspection.count(),
    prisma.estateInspection.count(),
    prisma.officeInspection.count(),
  ]);

  const archiveRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM "RequestMessage_Archive"`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        templates: { apartmentWorkspaces: aptWs, estateWorkspaces: estWs },
        counts: {
          apartment: { units: aptUnits, residents: aptResidents, requests: aptRequests },
          estate: { units: estUnits, residents: estResidents, requests: estRequests },
        },
        blockers: {
          requestMessagesArchivedRows: Number(archiveRows?.[0]?.c || 0),
          inspectionsRemaining: aptInspections + estInspections + officeInspections,
        },
      },
      null,
      2,
    ),
  );
}

main().finally(async () => prisma.$disconnect());
