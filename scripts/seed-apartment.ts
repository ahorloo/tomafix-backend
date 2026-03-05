import 'dotenv/config';
import { PrismaClient, RequestPriority, RequestStatus, ResidentRole, ResidentStatus, UnitStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.env.SEED_WORKSPACE_ID;
  if (!workspaceId) {
    console.log('SEED_WORKSPACE_ID not set; skipping seed-apartment');
    return;
  }

  const unit = await prisma.apartmentUnit.create({
    data: {
      id: randomUUID(),
      workspaceId,
      label: 'A-101',
      block: 'A',
      floor: '1',
      status: UnitStatus.OCCUPIED,
    },
  });

  const resident = await prisma.apartmentResident.create({
    data: {
      id: randomUUID(),
      workspaceId,
      unitId: unit.id,
      fullName: 'Sample Tenant',
      role: ResidentRole.TENANT,
      status: ResidentStatus.ACTIVE,
      email: 'sample.tenant@example.com',
    },
  });

  await prisma.apartmentRequest.create({
    data: {
      id: randomUUID(),
      workspaceId,
      unitId: unit.id,
      residentId: resident.id,
      title: 'Sample request',
      description: 'Seeded request',
      priority: RequestPriority.NORMAL,
      status: RequestStatus.PENDING,
    },
  });

  console.log('Seeded apartment template sample data');
}

main().finally(async () => prisma.$disconnect());
