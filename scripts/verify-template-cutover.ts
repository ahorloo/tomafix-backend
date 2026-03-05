import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [aptWs, estWs] = await Promise.all([
    prisma.workspace.count({ where: { templateType: 'APARTMENT' } }),
    prisma.workspace.count({ where: { templateType: 'ESTATE' } }),
  ]);

  const [aptUnits, aptResidents, aptRequests, estUnits, estResidents, estRequests] = await Promise.all([
    prisma.apartmentUnit.count(),
    prisma.apartmentResident.count(),
    prisma.apartmentRequest.count(),
    prisma.estateUnit.count(),
    prisma.estateResident.count(),
    prisma.estateRequest.count(),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        templates: { apartmentWorkspaces: aptWs, estateWorkspaces: estWs },
        counts: {
          apartment: { units: aptUnits, residents: aptResidents, requests: aptRequests },
          estate: { units: estUnits, residents: estResidents, requests: estRequests },
        },
      },
      null,
      2,
    ),
  );
}

main().finally(async () => prisma.$disconnect());
