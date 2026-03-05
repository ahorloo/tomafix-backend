import { PrismaClient, PlanInterval, TemplateType } from '@prisma/client';

const prisma = new PrismaClient();

const planMatrix: Record<TemplateType, Array<{ name: string; amountPesewas: number }>> = {
  APARTMENT: [
    { name: 'Starter', amountPesewas: 7900 },
    { name: 'Growth', amountPesewas: 14900 },
    { name: 'Toma Prime', amountPesewas: 29900 },
  ],
  ESTATE: [
    { name: 'Starter', amountPesewas: 12900 },
    { name: 'Growth', amountPesewas: 24900 },
    { name: 'Toma Prime', amountPesewas: 49900 },
  ],
  OFFICE: [
    { name: 'Starter', amountPesewas: 9900 },
    { name: 'Growth', amountPesewas: 19900 },
    { name: 'Toma Prime', amountPesewas: 39900 },
  ],
};

async function main() {
  const keepIds: string[] = [];

  for (const key of Object.keys(planMatrix) as TemplateType[]) {
    const template = await prisma.template.upsert({
      where: { key },
      update: { isActive: true },
      create: {
        key,
        name: key === 'APARTMENT' ? 'Apartment Building' : key === 'ESTATE' ? 'Estate / Multi-property' : 'Office / Company Facility',
      },
    });

    for (const plan of planMatrix[key]) {
      const upserted = await prisma.plan.upsert({
        where: {
          templateId_name_interval: {
            templateId: template.id,
            name: plan.name,
            interval: PlanInterval.MONTHLY,
          },
        },
        update: {
          amountPesewas: plan.amountPesewas,
          currency: 'GHS',
          isActive: true,
        },
        create: {
          templateId: template.id,
          name: plan.name,
          interval: PlanInterval.MONTHLY,
          amountPesewas: plan.amountPesewas,
          currency: 'GHS',
          isActive: true,
        },
      });
      keepIds.push(upserted.id);
    }
  }

  await prisma.plan.updateMany({ where: { NOT: { id: { in: keepIds } } }, data: { isActive: false } });

  console.log('Seeded template-separated plans:', keepIds.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
