import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true, templateType: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  console.table(workspaces);
}
main().catch((e)=>{console.error(e); process.exit(1);}).finally(()=>prisma.$disconnect());
