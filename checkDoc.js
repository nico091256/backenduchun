const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const doc = await prisma.document.findUnique({
    where: { docNumber: 'BPM-2026-0007' },
    include: { approvalSteps: true }
  });
  console.log(doc.approvalSteps);
}

main().catch(console.error).finally(() => prisma.$disconnect());
