import { PrismaClient, TemplateType, UnitStatus, ResidentRole, ResidentStatus, RequestPriority, RequestStatus } from '@prisma/client';

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error('Usage: ts-node scripts/seed-apartment.ts <workspaceId>');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error('Workspace not found');
  if (ws.templateType !== TemplateType.APARTMENT) {
    throw new Error(`Workspace template is ${ws.templateType}, expected APARTMENT`);
  }

  // Units
  const units = [
    { label: 'A-101', block: 'A', floor: '1', status: UnitStatus.OCCUPIED },
    { label: 'A-102', block: 'A', floor: '1', status: UnitStatus.VACANT },
    { label: 'B-201', block: 'B', floor: '2', status: UnitStatus.MAINTENANCE },
  ];

  const createdUnits: { id: string; label: string }[] = [];
  for (const u of units) {
    const existing = await prisma.unit.findFirst({
      where: { workspaceId, label: u.label, block: u.block ?? null, floor: u.floor ?? null },
    });
    const unit = existing
      ? await prisma.unit.update({ where: { id: existing.id }, data: { status: u.status } })
      : await prisma.unit.create({ data: { workspaceId, ...u } });
    createdUnits.push({ id: unit.id, label: unit.label });
  }

  // Residents
  const residents = [
    {
      fullName: 'Ama Mensah',
      email: 'ama.mensah@example.com',
      phone: '+233201234567',
      unitLabel: 'A-101',
      role: ResidentRole.TENANT,
      status: ResidentStatus.ACTIVE,
    },
    {
      fullName: 'Kojo Owusu',
      email: 'kojo.owusu@example.com',
      phone: '+233549876543',
      unitLabel: 'B-201',
      role: ResidentRole.MANAGER,
      status: ResidentStatus.ACTIVE,
    },
  ];

  const createdResidents: { id: string; fullName: string; unitId: string | null }[] = [];
  for (const r of residents) {
    const unitId = createdUnits.find((u) => u.label === r.unitLabel)?.id ?? null;
    const existing = await prisma.resident.findFirst({ where: { workspaceId, fullName: r.fullName } });
    const resident = existing
      ? await prisma.resident.update({ where: { id: existing.id }, data: { unitId, phone: r.phone, email: r.email } })
      : await prisma.resident.create({
          data: {
            workspaceId,
            unitId,
            fullName: r.fullName,
            phone: r.phone,
            email: r.email,
            role: r.role,
            status: r.status,
          },
        });
    createdResidents.push({ id: resident.id, fullName: resident.fullName, unitId });
  }

  // Requests
  const requests = [
    {
      title: 'Leaky faucet in kitchen',
      description: 'Tap dripping continuously',
      priority: RequestPriority.NORMAL,
      status: RequestStatus.PENDING,
      unitLabel: 'A-101',
      residentName: 'Ama Mensah',
    },
    {
      title: 'AC not cooling',
      description: 'Unit B-201 AC blowing warm air',
      priority: RequestPriority.HIGH,
      status: RequestStatus.IN_PROGRESS,
      unitLabel: 'B-201',
      residentName: 'Kojo Owusu',
    },
  ];

  for (const req of requests) {
    const unitId = createdUnits.find((u) => u.label === req.unitLabel)?.id;
    if (!unitId) continue;
    const residentId = createdResidents.find((r) => r.fullName === req.residentName)?.id ?? null;
    await prisma.request.create({
      data: {
        workspaceId,
        unitId,
        residentId,
        title: req.title,
        description: req.description,
        priority: req.priority,
        status: req.status,
      },
    });
  }

  console.log('Seeded apartment data for workspace', workspaceId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
