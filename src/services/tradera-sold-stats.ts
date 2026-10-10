/**
 * Tradera SÅLT per produkt senaste `TRADERA_SOLD_WINDOW_DAYS`: median + antal.
 *
 * Delas av Discord-ruttabellen (scripts/lib/restock-routes.ts) och katalogsnapshotens
 * sökindex (services/catalog-snapshot.ts → /pris). EN fråga, en definition — två kopior
 * hade gett två olika "Tradera sålt" för samma vara i samma server.
 *
 * MEDIAN (percentile_cont), samma storhet som prisgrafens sålt-serie. Graderade affärer
 * ligger aldrig här — de bor i `GradedSale` — så talet är det ograderade/förseglade.
 * Okänd källa (ny databas) ⇒ tom karta, aldrig ett fel som fäller anroparen.
 * ⛔ Anropas bara där Neon redan är vaken (nattjobben).
 */
import { prisma } from "@/lib/db";
import { TRADERA_SOLD_MIN_COUNT, TRADERA_SOLD_WINDOW_DAYS } from "@/lib/market-compare";
import { TRADERA_SOLD_SOURCE_NAME } from "@/services/products";

export async function loadTraderaSoldStats(): Promise<Map<string, { medianOre: number; count: number }>> {
  const source = await prisma.scrapeSource.findUnique({
    where: { name: TRADERA_SOLD_SOURCE_NAME },
    select: { id: true },
  });
  if (!source) return new Map();
  const since = new Date(Date.now() - TRADERA_SOLD_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<{ productId: string; n: number; median: number }[]>`
    SELECT "productId", COUNT(*)::int AS n,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::float8 AS median
    FROM "PriceObservation"
    WHERE "sourceId" = ${source.id} AND "observedAt" >= ${since} AND price > 0
    GROUP BY "productId"
    HAVING COUNT(*) >= ${TRADERA_SOLD_MIN_COUNT}`;
  return new Map(rows.map((r) => [r.productId, { medianOre: Math.round(r.median), count: r.n }]));
}
