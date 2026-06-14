/**
 * Bygger riktig prishistorik för singelkort från redan sparade Cardmarket-
 * aggregat i PriceObservation.rawData:
 *
 * - Källa "Pokémon TCG API": rawData.cardmarket.prices.{avg1,avg7,avg30} (EUR)
 * - Källa "TCGdex API":      rawData.pricing.cardmarket.{avg1,avg7,avg30} (EUR)
 *
 * För varje bas-observation skapas historikpunkter: avg1 → −1 dag,
 * avg7 → −7 dagar, avg30 → −30 dagar (relativt bas-observationens tidpunkt).
 * Detta är Cardmarkets EGNA glidande medel — inga fabricerade priser.
 *
 * Idempotent: raderar först alla aggregate-markerade observationer för dessa
 * källor och återskapar dem. Skapar även PriceSnapshot för datum som saknas.
 *
 * Kör: npx tsx scripts/backfill-singles-history.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
// Live SEK/EUR — sätts i main() via getRatesOre (EUR_SEK-env pinnar fortfarande).
let EUR_SEK = 0;
const DAY = 86_400_000;

const eurToOre = (eur: number) => Math.round(eur * EUR_SEK * 100);

interface AggregateValues {
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

function extractAggregates(sourceName: string, raw: unknown): AggregateValues | null {
  const r = raw as {
    cardmarket?: { prices?: { avg1?: number; avg7?: number; avg30?: number } } | null;
    pricing?: { cardmarket?: { avg1?: number; avg7?: number; avg30?: number } | null } | null;
  } | null;
  const prices =
    sourceName === "Pokémon TCG API" ? r?.cardmarket?.prices : r?.pricing?.cardmarket;
  if (!prices) return null;
  const pick = (v: number | undefined) => (typeof v === "number" && v > 0 ? v : null);
  return { avg1: pick(prices.avg1), avg7: pick(prices.avg7), avg30: pick(prices.avg30) };
}

async function main() {
  EUR_SEK = (await getRatesOre()).eurToOre / 100;
  console.log(`Växelkurs: 1 EUR = ${EUR_SEK.toFixed(4)} SEK`);

  const sources = await prisma.scrapeSource.findMany({
    where: { name: { in: ["Pokémon TCG API", "TCGdex API"] } },
    select: { id: true, name: true },
  });
  if (sources.length === 0) throw new Error("Inga källor hittades");
  const sourceIds = sources.map((s) => s.id);
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));

  // 2 äldre observationer saknar källa men har pokemontcg.io-rådata — koppla dem
  const tcgApi = sources.find((s) => s.name === "Pokémon TCG API");
  if (tcgApi) {
    const fixed = await prisma.priceObservation.updateMany({
      where: { sourceId: null },
      data: { sourceId: tcgApi.id },
    });
    if (fixed.count > 0) console.log(`${fixed.count} observationer utan källa kopplade till Pokémon TCG API`);
  }

  // Idempotens: ta bort tidigare backfillade aggregatpunkter
  const removed = await prisma.$executeRaw`
    DELETE FROM "PriceObservation"
    WHERE "sourceId" IN (${Prisma.join(sourceIds)})
      AND "rawData"->>'aggregate' IS NOT NULL`;
  if (removed > 0) console.log(`Raderade ${removed} tidigare aggregatpunkter`);

  const base = await prisma.priceObservation.findMany({
    where: { sourceId: { in: sourceIds } },
    select: { productId: true, sourceId: true, observedAt: true, condition: true, rawData: true },
  });
  console.log(`${base.length} bas-observationer att gå igenom`);

  const obsRows: Prisma.PriceObservationCreateManyInput[] = [];
  const snapRows: Prisma.PriceSnapshotCreateManyInput[] = [];
  let withHistory = 0;

  for (const o of base) {
    const sourceName = nameOf.get(o.sourceId!)!;
    const agg = extractAggregates(sourceName, o.rawData);
    if (!agg) continue;
    const points: { eur: number; aggregate: string; offsetDays: number }[] = [];
    if (agg.avg1 != null) points.push({ eur: agg.avg1, aggregate: "avg1", offsetDays: 1 });
    if (agg.avg7 != null) points.push({ eur: agg.avg7, aggregate: "avg7", offsetDays: 7 });
    if (agg.avg30 != null) points.push({ eur: agg.avg30, aggregate: "avg30", offsetDays: 30 });
    if (points.length === 0) continue;
    withHistory++;

    for (const pt of points) {
      const price = eurToOre(pt.eur);
      const observedAt = new Date(o.observedAt.getTime() - pt.offsetDays * DAY);
      obsRows.push({
        productId: o.productId,
        sourceId: o.sourceId,
        price,
        currency: "SEK",
        condition: o.condition, // NEAR_MINT — raw, ej graderat
        observedAt,
        rawData: { aggregate: pt.aggregate, eur: pt.eur, eurSek: EUR_SEK } as Prisma.InputJsonValue,
      });
      snapRows.push({
        productId: o.productId,
        date: new Date(observedAt.toISOString().slice(0, 10)),
        minPrice: price,
        maxPrice: price,
        avgPrice: price,
        volume: 0,
      });
    }
  }

  console.log(`${withHistory} singlar med CM-aggregat → ${obsRows.length} historikpunkter`);

  const BATCH = 2000;
  for (let i = 0; i < obsRows.length; i += BATCH) {
    await prisma.priceObservation.createMany({ data: obsRows.slice(i, i + BATCH) });
    process.stdout.write(`\r  observationer: ${Math.min(i + BATCH, obsRows.length)}/${obsRows.length}`);
  }
  console.log();
  let snapCreated = 0;
  for (let i = 0; i < snapRows.length; i += BATCH) {
    const res = await prisma.priceSnapshot.createMany({
      data: snapRows.slice(i, i + BATCH),
      skipDuplicates: true, // befintliga dagssnapshots skrivs inte över
    });
    snapCreated += res.count;
  }
  console.log(`PriceSnapshots skapade (saknade datum): ${snapCreated}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
