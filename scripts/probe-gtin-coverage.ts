/**
 * Mäter hur stor andel av butikernas sealed-utbud som faktiskt publicerar en
 * tillverkar-streckkod (GTIN). Detta är siffran som avgör arkitekturen:
 *
 *   hög täckning (>80%)  → GTIN blir PRIMÄR nyckel, titelmatchning blir svansen
 *   låg täckning (~40%)  → GTIN blir en snabbväg, titelmatchning förblir huvudspår
 *
 * Gissa aldrig den här siffran. Mät den.
 *
 * Körs mot PROD (butikslänkarna finns bara där):
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-gtin-coverage.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-gtin-coverage.ts --limit 40 --store "Dragon's Lair"
 *
 * Skriver INGENTING till databasen. Ren mätning.
 */
import { PrismaClient } from "@prisma/client";
import { fetchListingGtin, STORE_GTIN_STRATEGY } from "../src/scrapers/gtin-source";
import { formatGtin } from "../src/lib/gtin";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
/** Antal produkter som samplas per butik. Höj för säkrare siffra, sänk för snabbhet. */
const LIMIT = Number(arg("--limit") ?? 60);
const ONLY_STORE = arg("--store");
const CONCURRENCY = 3; // artigt: politeFetch strypa ändå per värd

/** Sealed-kategorier — singlar har aldrig en egen streckkod. */
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;

type Row = {
  store: string;
  url: string;
  title: string;
  gtin: string | null;
  createdAt: Date;
};

async function main() {
  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const targets = retailers
    .filter((r) => (STORE_GTIN_STRATEGY[r.name] ?? "none") !== "none")
    .filter((r) => !ONLY_STORE || r.name === ONLY_STORE);

  const skipped = retailers.filter((r) => (STORE_GTIN_STRATEGY[r.name] ?? "none") === "none");
  console.log(`Butiker med känd GTIN-väg: ${targets.map((t) => t.name).join(", ")}`);
  console.log(`Hoppar över (publicerar bevisligen ingen kod): ${skipped.map((s) => s.name).join(", ") || "—"}\n`);

  const perStore: Record<string, Row[]> = {};

  for (const retailer of targets) {
    // Sampla senast sedda sealed-offers med en riktig butikslänk. ORDER BY är MEDVETET:
    // `take` utan `orderBy` ger ett slumpurval från Postgres — värdelöst i en mätning.
    const offers = await prisma.offer.findMany({
      where: {
        retailerId: retailer.id,
        product: { category: { in: [...SEALED] } },
      },
      select: { url: true, product: { select: { title: true, createdAt: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: LIMIT,
    });

    if (offers.length === 0) {
      console.log(`${retailer.name}: inga sealed-offers i katalogen — hoppar över.`);
      continue;
    }

    const rows: Row[] = new Array(offers.length);
    await mapPool(offers, CONCURRENCY, async (o, i) => {
      const gtin = await fetchListingGtin(retailer.name, o.url);
      rows[i] = {
        store: retailer.name,
        url: o.url,
        title: o.product.title,
        gtin,
        createdAt: o.product.createdAt,
      };
    });
    perStore[retailer.name] = rows;

    const hit = rows.filter((r) => r.gtin).length;
    const pct = Math.round((hit / rows.length) * 100);
    console.log(
      `${retailer.name.padEnd(15)} sampel=${String(rows.length).padStart(3)}  ` +
        `GTIN=${String(hit).padStart(3)}  täckning=${String(pct).padStart(3)}%`
    );
    const example = rows.find((r) => r.gtin);
    if (example) console.log(`   ex.  ${formatGtin(example.gtin)}  ${example.title.slice(0, 58)}`);
    const miss = rows.find((r) => !r.gtin);
    if (miss) console.log(`   miss ${"—".padEnd(13)}  ${miss.title.slice(0, 58)}`);
  }

  // ---- Totalen + åldersuppdelning (hypotesen: äldre sortiment saknar kod) ----
  const all = Object.values(perStore).flat();
  if (all.length === 0) {
    console.log("\nInga rader att rapportera.");
    await prisma.$disconnect();
    return;
  }
  const total = all.filter((r) => r.gtin).length;
  console.log(`\n=== TOTALT ===`);
  console.log(`${total}/${all.length} = ${Math.round((total / all.length) * 100)}% av sampladе sealed-offers har GTIN`);

  const cutoff = new Date("2024-01-01");
  const recent = all.filter((r) => r.createdAt >= cutoff);
  const legacy = all.filter((r) => r.createdAt < cutoff);
  const rate = (rows: Row[]) =>
    rows.length ? `${Math.round((rows.filter((r) => r.gtin).length / rows.length) * 100)}% (${rows.filter((r) => r.gtin).length}/${rows.length})` : "—";
  console.log(`  katalogförd 2024+ : ${rate(recent)}`);
  console.log(`  äldre            : ${rate(legacy)}`);

  // ---- Cross-store: samma kod i flera butiker = joinen bevisad på RIKTIG data ----
  const byGtin = new Map<string, Set<string>>();
  for (const r of all) {
    if (!r.gtin) continue;
    if (!byGtin.has(r.gtin)) byGtin.set(r.gtin, new Set());
    byGtin.get(r.gtin)!.add(r.store);
  }
  const shared = [...byGtin.entries()].filter(([, s]) => s.size >= 2);
  console.log(`\n=== CROSS-STORE ===`);
  console.log(`distinkta GTIN: ${byGtin.size}   delade av ≥2 butiker: ${shared.length}`);
  for (const [gtin, stores] of shared.slice(0, 10)) {
    const titles = all.filter((r) => r.gtin === gtin);
    console.log(`\n  ${formatGtin(gtin)}  (${[...stores].join(", ")})`);
    for (const t of titles.slice(0, 4)) console.log(`     ${t.store.padEnd(13)} ${t.title.slice(0, 58)}`);
  }

  console.log(`\n--- SLUTSATS ---`);
  const pct = Math.round((total / all.length) * 100);
  if (pct >= 80) console.log(`Täckning ${pct}% → GTIN som PRIMÄR nyckel. Titelmatchning = svansen.`);
  else if (pct >= 40) console.log(`Täckning ${pct}% → GTIN som SNABBVÄG. Titelmatchning förblir huvudspår.`);
  else console.log(`Täckning ${pct}% → för tunt för primärnyckel. Använd som vakt/tiebreaker.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
