const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const steps = await prisma.approvalStep.findMany({
    where: { approverId: 4, stepStatus: 'PENDING' },
    include: { document: true }
  });
  console.log(JSON.stringify(steps, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
