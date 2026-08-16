/**
 * Vilka lagerövergångar skriver DB-lanen — och vilka av dem kan Discord-lanens
 * diff över huvud taget SE?
 *
 * `actionableChanges` (feed-state-diff.ts) räknar bara övergångar där BÅDA statusarna
 * är IN_STOCK/OUT_OF_STOCK. Allt som går via PREORDER, LIMITED eller UNKNOWN är
 * osynligt för Discord även när DB-lanen mejlar om det. Skriptet mäter hur stor den
 * klassen är i verkligheten.
 *
 * Rapport-only. Kör: node scripts/with-prod-db.mjs npx tsx scripts/audit-restock-transitions.ts [dagar]
 */
import "./load-env";
import { prisma } from "../src/lib/db";

const days = Math.max(1, Number(process.argv[2] ?? 14));

async function main() {
  const since = new Date(Date.now() - days * 86_400_000);
  const events = await prisma.restockEvent.findMany({
    where: { detectedAt: { gte: since } },
    select: { oldStatus: true, newStatus: true, retailer: { select: { name: true } } },
  });

  const pairs = new Map<string, number>();
  for (const e of events) {
    const k = `${e.oldStatus} → ${e.newStatus}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  const real = new Set(["IN_STOCK", "OUT_OF_STOCK"]);
  let visible = 0;
  let invisible = 0;
  console.log(`\n=== ÖVERGÅNGAR (${events.length} st, ${days} dygn) ===`);
  for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) {
    const [from, to] = k.split(" → ");
    const seen = real.has(from) && real.has(to);
    if (seen) visible += n;
    else invisible += n;
    console.log(`  ${k.padEnd(32)} ${String(n).padStart(5)}   ${seen ? "syns för Discord" : "⛔ OSYNLIG för Discord"}`);
  }
  console.log(
    `\n  Syns i Discord-diffen : ${visible}\n  Osynliga              : ${invisible} ` +
      `(${((100 * invisible) / Math.max(1, events.length)).toFixed(1)} %)`
  );

  // Roterande källor: en URL som DYKER UPP i lager hos dem ger ALDRIG ett
  // Discord-inlägg (rotationen är brus, inte signal).
  const sources = await prisma.scrapeSource.findMany({
    where: { isActive: true },
    select: { name: true, config: true },
  });
  const rotating = sources
    .filter((s) => (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true)
    .map((s) => s.name);
  const watched = sources.filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  );
  console.log(`\n=== ROTERANDE FEEDAR (${rotating.length} av ${watched.length} bevakade) ===`);
  console.log(`  ${rotating.join(", ") || "(inga)"}`);

  // Hur många av händelserna kommer från roterande butiker?
  const rotSet = new Set(rotating);
  const fromRotating = events.filter((e) => rotSet.has(e.retailer.name)).length;
  console.log(`  Händelser från roterande butiker: ${fromRotating}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
