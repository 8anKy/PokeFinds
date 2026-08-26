import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const titles = [
    "Prismatic Evolutions Super-Premium Collection",
    "Pitch Black Booster Bundle",
    "Mega Greninja ex Premium Collection",
  ];
  for (const t of titles) {
    const p = await prisma.product.findFirst({
      where: { title: t },
      select: {
        id: true, title: true, slug: true, category: true,
        lowestPriceOre: true,
        offers: {
          select: {
            id: true, price: true, currency: true, stockStatus: true, url: true,
            condition: true, language: true, lastSeenAt: true, updatedAt: true,
            retailer: { select: { name: true } },
          },
          orderBy: { price: "asc" },
        },
      },
    });
    if (!p) { console.log(`SAKNAS: ${t}`); continue; }
    console.log(`\n===== ${p.title} (${p.slug}) lowestPriceOre=${p.lowestPriceOre} (${p.lowestPriceOre != null ? (p.lowestPriceOre/100).toFixed(2) : "-"}) =====`);
    for (const o of p.offers) {
      console.log(
        `${(o.price != null ? (o.price/100).toFixed(2) : "-").padStart(10)} ${String(o.currency).padEnd(4)} ${String(o.stockStatus).padEnd(13)} ${o.retailer.name.padEnd(22)} cond=${o.condition ?? "-"} lang=${o.language ?? "-"} seen=${o.lastSeenAt?.toISOString().slice(0,16) ?? "-"} ${o.url.slice(0, 110)}`
      );
    }
  }
}
main().finally(() => prisma.$disconnect());
