import { PrismaClient, PlanInterval } from '@prisma/client';

const prisma = new PrismaClient();

// Apartment template pricing (GHS, monthly)
const plans = [
  {
    name: 'Starter',
    interval: PlanInterval.MONTHLY,
    amountPesewas: 7900, // GH₵ 79
    currency: 'GHS',
  },
  {
    name: 'Growth',
    interval: PlanInterval.MONTHLY,
    amountPesewas: 14900, // GH₵ 149
    currency: 'GHS',
  },
  {
    name: 'Toma Prime',
    interval: PlanInterval.MONTHLY,
    amountPesewas: 29900, // GH₵ 299
    currency: 'GHS',
  },
];

async function main() {
  const keepIds: string[] = [];

  for (const plan of plans) {
    const existing = await prisma.plan.findFirst({ where: { name: plan.name, interval: plan.interval } });
    if (existing) {
      const updated = await prisma.plan.update({
        where: { id: existing.id },
        data: {
          amountPesewas: plan.amountPesewas,
          currency: plan.currency,
          isActive: true,
        },
      });
      keepIds.push(updated.id);
    } else {
      const created = await prisma.plan.create({ data: { ...plan, isActive: true } });
      keepIds.push(created.id);
    }
  }

  // Deactivate any other plans not in this balanced set
  await prisma.plan.updateMany({ where: { NOT: { id: { in: keepIds } } }, data: { isActive: false } });

  console.log('Seeded balanced apartment plans:', keepIds.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
