import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const ps = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD","GRADED_CARD"] }, offers: { none: {} } },
    select: { title: true, category: true },
  });
  ps.forEach(p => console.log(p.category + ": " + p.title));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
