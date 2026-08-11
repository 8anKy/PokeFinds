/**
 * READ-ONLY mätning inför Discord-larm: hur ser restock-flödet ut om det ska routas
 * till KANALER? Svarar på hur många DISTINKTA set som larmar per dygn, hur skevt det
 * är (kan få kanaler täcka det mesta?) och hur stor andel som saknar setId och alltså
 * måste till en catch-all.
 *
 * Skriver ingenting. Kör: node scripts/with-prod-db.mjs npx tsx scripts/discord-channel-shape.ts
 */
import { prisma } from "@/lib/db";

const DAYS = Number(process.env.DAYS ?? 14);

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  // Bara ÄKTA restocks (OUT → IN) — samma händelse som skulle bli ett Discord-inlägg.
  const events = await prisma.restockEvent.findMany({
    where: { detectedAt: { gte: since }, oldStatus: "OUT_OF_STOCK", newStatus: "IN_STOCK" },
    select: {
      detectedAt: true,
      retailer: { select: { name: true } },
      product: {
        select: { setId: true, set: { select: { name: true, series: true } } },
      },
    },
  });

  if (!events.length) {
    console.log("Inga restocks i fönstret.");
    return;
  }

  // Jämförbarhet med den gamla "flippar/dygn"-mätningen, som räknade BÅDA riktningarna.
  const allTransitions = await prisma.restockEvent.count({ where: { detectedAt: { gte: since } } });
  console.log(
    `\n[jämförelse] ALLA lagerövergångar (båda riktningar): ${allTransitions} = ${(allTransitions / DAYS).toFixed(1)}/dygn`
  );

  console.log(
    `\n=== ${events.length} restocks (OUT→IN) senaste ${DAYS} dygn = ${(events.length / DAYS).toFixed(1)}/dygn ===\n`
  );

  const bySet = new Map<string, number>();
  const bySeries = new Map<string, number>();
  const byStore = new Map<string, number>();
  let noSet = 0;

  for (const e of events) {
    const setName = e.product.set?.name ?? null;
    if (!setName) noSet++;
    const setKey = setName ?? "(utan set)";
    bySet.set(setKey, (bySet.get(setKey) ?? 0) + 1);
    const seriesKey = e.product.set?.series ?? "(utan serie)";
    bySeries.set(seriesKey, (bySeries.get(seriesKey) ?? 0) + 1);
    byStore.set(e.retailer.name, (byStore.get(e.retailer.name) ?? 0) + 1);
  }

  const sorted = [...bySet.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`DISTINKTA SET som larmat: ${sorted.length}`);
  console.log(`Utan setId (catch-all): ${noSet} (${((noSet / events.length) * 100).toFixed(1)}%)\n`);

  console.log("--- Per set (topp 25) ---");
  for (const [name, n] of sorted.slice(0, 25)) {
    console.log(`${String(n).padStart(4)}  ${(n / DAYS).toFixed(2).padStart(5)}/dygn  ${name}`);
  }
  const tail = sorted.slice(25).reduce((s, [, n]) => s + n, 0);
  if (tail) {
    console.log(
      `${String(tail).padStart(4)}  ${(tail / DAYS).toFixed(2).padStart(5)}/dygn  (${sorted.length - 25} övriga set tillsammans)`
    );
  }

  console.log("\n--- Per serie ---");
  for (const [name, n] of [...bySeries.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${(n / DAYS).toFixed(2).padStart(5)}/dygn  ${name}`);
  }

  console.log("\n--- Per butik ---");
  for (const [name, n] of [...byStore.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${(n / DAYS).toFixed(2).padStart(5)}/dygn  ${name}`);
  }

  // Hur få kanaler täcker det mesta?
  let acc = 0;
  let k = 0;
  for (const [, n] of sorted) {
    acc += n;
    k++;
    if (acc >= events.length * 0.8) break;
  }
  console.log(`\n80 % av alla restocks ryms i ${k} set (av ${sorted.length}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
