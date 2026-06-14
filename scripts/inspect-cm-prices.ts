/**
 * Diagnostik: visar vilka Cardmarket-prisfält vi faktiskt har lagrade per kort
 * (från pokemontcg.io i PriceObservation.rawData) och jämför dem.
 *
 * Syfte: utreda om något fält ligger närmare engelska "From" än trend/lowPrice.
 * Kör: npx tsx --env-file=.env scripts/inspect-cm-prices.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const src = await prisma.scrapeSource.findFirst({
    where: { name: "Pokémon TCG API" },
  });
  if (!src) throw new Error("Källan 'Pokémon TCG API' hittades inte.");

  // Hämta senaste observationer med rawData för ett urval singlar.
  const obs = await prisma.priceObservation.findMany({
    where: { sourceId: src.id, product: { category: "SINGLE_CARD" } },
    orderBy: { observedAt: "desc" },
    take: 400,
    select: {
      price: true,
      rawData: true,
      product: { select: { title: true } },
    },
  });

  // Visa de fält som finns i cardmarket.prices + några exempel.
  const fieldSet = new Set<string>();
  const rows: {
    name: string;
    low: number | null;
    lowEx: number | null;
    trend: number | null;
    avgSell: number | null;
    avg30: number | null;
  }[] = [];

  for (const o of obs) {
    const raw = o.rawData as
      | { cardmarket?: { prices?: Record<string, number | null> } }
      | null;
    const p = raw?.cardmarket?.prices;
    if (!p) continue;
    for (const k of Object.keys(p)) fieldSet.add(k);
    rows.push({
      name: o.product?.title ?? "?",
      low: p.lowPrice ?? null,
      lowEx: p.lowPriceExPlus ?? null,
      trend: p.trendPrice ?? null,
      avgSell: p.averageSellPrice ?? null,
      avg30: p.avg30 ?? null,
    });
  }

  console.log("\n=== Tillgängliga cardmarket.prices-fält (från pokemontcg.io) ===");
  console.log([...fieldSet].sort().join(", "));

  // Hur ofta saknas lowPriceExPlus?
  const withLowEx = rows.filter((r) => r.lowEx != null && r.lowEx > 0).length;
  console.log(
    `\n=== Täckning (av ${rows.length} singlar med CM-data) ===\n` +
      `lowPriceExPlus satt: ${withLowEx} (${Math.round((withLowEx / rows.length) * 100)}%)`
  );

  // Visa kort där low << trend (där "absurt lågt" uppstår) + vad lowEx säger.
  const gappy = rows
    .filter((r) => r.low != null && r.trend != null && r.trend > 0)
    .map((r) => ({ ...r, ratio: (r.low as number) / (r.trend as number) }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 12);

  console.log("\n=== 12 kort med störst gap low≪trend (EUR) ===");
  console.log("namn | low | lowEx | trend | avgSell | avg30");
  for (const r of gappy) {
    console.log(
      `${r.name.slice(0, 34).padEnd(34)} | ${fmt(r.low)} | ${fmt(r.lowEx)} | ${fmt(
        r.trend
      )} | ${fmt(r.avgSell)} | ${fmt(r.avg30)}`
    );
  }
}

function fmt(n: number | null): string {
  return n == null ? "  –  " : `€${n.toFixed(2)}`.padStart(7);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
