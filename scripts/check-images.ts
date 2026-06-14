import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const allSealed = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { imageUrl: true, title: true },
    distinct: ["imageUrl"],
  });
  console.log("Total unique sealed images:", allSealed.length);
  let broken = 0;
  for (const p of allSealed) {
    if (!p.imageUrl) { console.log("NULL image:", p.title.slice(0, 50)); continue; }
    try {
      const res = await fetch(p.imageUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (res.status !== 200) {
        broken++;
        console.log("BROKEN " + res.status + ": " + p.imageUrl + " (" + p.title.slice(0, 40) + ")");
      }
    } catch {
      broken++;
      console.log("ERR: " + p.imageUrl + " (" + p.title.slice(0, 40) + ")");
    }
  }
  console.log("Total broken:", broken);
}

main().catch(console.error).finally(() => prisma.$disconnect());
