/** Engångsrevision: vilka larm har skapats/skickats de senaste dygnen, och varför? */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const rows = await prisma.alert.groupBy({
    by: ["type", "status"],
    where: { triggeredAt: { gte: since } },
    _count: { _all: true },
  });
  console.log("=== Larm per typ/status senaste 7 dygn ===");
  for (const r of rows) console.log(`${r.type.padEnd(14)} ${r.status.padEnd(8)} ${r._count._all}`);

  const recent = await prisma.alert.findMany({
    where: { triggeredAt: { gte: new Date(Date.now() - 3 * 24 * 3600_000) } },
    select: {
      id: true, type: true, status: true, channel: true, triggeredAt: true, message: true,
      userId: true,
      product: { select: { title: true, slug: true, id: true } },
    },
    orderBy: { triggeredAt: "desc" },
    take: 200,
  });
  console.log(`\n=== Senaste 3 dygn (${recent.length}) ===`);
  for (const a of recent) {
    console.log(
      `${a.triggeredAt.toISOString()} ${a.type.padEnd(12)} ${a.status.padEnd(7)} u=${a.userId.slice(0, 8)} ${a.product?.title ?? "-"} :: ${a.message.slice(0, 90)}`
    );
  }

  // PRICE_TARGET-historik per produkt: hur ofta larmar samma produkt?
  const pt = await prisma.alert.groupBy({
    by: ["productId", "userId"],
    where: { type: "PRICE_TARGET", triggeredAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
    _count: { _all: true },
    _max: { triggeredAt: true },
    _min: { triggeredAt: true },
  });
  console.log(`\n=== PRICE_TARGET per produkt/användare, 30 dygn (${pt.length} par) ===`);
  for (const r of pt.sort((a, b) => b._count._all - a._count._all).slice(0, 40)) {
    const p = r.productId
      ? await prisma.product.findUnique({ where: { id: r.productId }, select: { title: true } })
      : null;
    console.log(
      `${String(r._count._all).padStart(3)}x u=${r.userId.slice(0, 8)} ${p?.title ?? r.productId} (${r._min.triggeredAt?.toISOString().slice(0, 10)} → ${r._max.triggeredAt?.toISOString().slice(0, 10)})`
    );
  }

  // Bevakningar med målpris som är UPPFYLLT just nu → framtida spam
  const watches = await prisma.watchlistItem.findMany({
    where: { priceAlert: true, isPaused: false, targetPrice: { not: null } },
    select: {
      userId: true, targetPrice: true,
      product: { select: { id: true, title: true, lowestPriceOre: true } },
    },
  });
  console.log(`\n=== Bevakningar med målpris: ${watches.length} ===`);
  for (const w of watches) {
    const cur = w.product?.lowestPriceOre ?? null;
    const met = cur != null && w.targetPrice != null && cur <= w.targetPrice;
    console.log(
      `${met ? "UPPFYLLT" : "        "} u=${w.userId.slice(0, 8)} mål=${(w.targetPrice! / 100).toFixed(2)} nu=${cur != null ? (cur / 100).toFixed(2) : "-"} ${w.product?.title}`
    );
  }
}

main().finally(() => prisma.$disconnect());
