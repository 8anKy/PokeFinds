/**
 * FRYS SAMLINGSVÄRDET EN GÅNG PER NATT (ägarbeslut 2026-10-05).
 *
 * Samlingsvärdet räknades live per request ur `Offer`, så portföljen flyttade sig
 * när hot-card-refresh (21:00 UTC), jp-singles-refresh eller ett butikssvep skrev
 * — alltså FÖRE nattens Cardmarket-refresh, som är det ägaren vill att den följer.
 * Det här steget körs SIST i cardmarket-refresh.yml (bara när prissteget lyckats)
 * och skriver `productMarketValue(offers)` till `Product.settledValue*`; läsarna går
 * via `settledMarketValue` (src/lib/market-value.ts). Nattens körning ≈ 04–04:30
 * svensk tid, inte ett klockslag: den följer jobbet, även när GitHub startar sent.
 *
 * KOSTNAD: Neon är redan vaken i CM-fönstret. Bara ÄNDRADE rader skrivs (raw SQL,
 * bumpar inte `updatedAt`).
 *
 * GRAFEN FRYSES SAMTIDIGT (2026-10-12): ägaren såg portföljen röra sig ~02:00 svensk tid,
 * före Cardmarket-jobbet. Värdet var fruset, men grafen var det inte: den fick en ny
 * "idag"-punkt vid UTC-midnatt och skalade historiken mot DAGENS snapshot, som JP-jobbet,
 * butikssvepen och hot-card skriver när som helst. Nu skrivs (1) `settledTrendOre` =
 * produktens senaste snapshot i frysögonblicket — grafens ankare — och (2) markören
 * `JobMarker["collection-settle"]` = grafens sista dag. Se computeCollectionValue.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLLECTION_SETTLE_MARKER, productMarketValue } from "@/lib/market-value";

const PAGE = 2000;
const WRITE_CHUNK = 500;

export async function settleCollectionValues(opts: { dryRun?: boolean } = {}) {
  let cursor: string | undefined;
  let scanned = 0;
  const changed: { id: string; ore: number | null; cm: boolean; trend: number | null }[] = [];

  for (;;) {
    const rows = await prisma.product.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        settledValueOre: true,
        settledValueFromCm: true,
        settledValueAt: true,
        settledTrendOre: true,
        priceSnapshots: { select: { avgPrice: true }, orderBy: { date: "desc" }, take: 1 },
        offers: {
          select: { price: true, stockStatus: true, url: true, retailer: { select: { name: true } } },
        },
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;
    for (const r of rows) {
      const v = productMarketValue(r.offers);
      const trend = r.priceSnapshots[0]?.avgPrice ?? null;
      // Aldrig fryst och fortfarande utan värde: inget att skriva (live ger också null).
      if (r.settledValueAt == null && v.price == null) continue;
      if (
        r.settledValueAt != null &&
        r.settledValueOre === v.price &&
        r.settledValueFromCm === v.fromCardmarket &&
        r.settledTrendOre === trend
      ) {
        continue;
      }
      changed.push({ id: r.id, ore: v.price, cm: v.fromCardmarket, trend });
    }
  }

  if (!opts.dryRun) {
    for (let i = 0; i < changed.length; i += WRITE_CHUNK) {
      const chunk = changed.slice(i, i + WRITE_CHUNK);
      const values = Prisma.join(
        chunk.map((c) => Prisma.sql`(${c.id}, ${c.ore}::int, ${c.cm}::boolean, ${c.trend}::int)`)
      );
      await prisma.$executeRaw`
        UPDATE "Product" AS p
        SET "settledValueOre" = v.ore, "settledValueFromCm" = v.cm, "settledTrendOre" = v.trend, "settledValueAt" = NOW()
        FROM (VALUES ${values}) AS v(id, ore, cm, trend)
        WHERE p.id = v.id`;
    }
    // SIST: grafens sista dag flyttas först när alla värden är skrivna.
    await prisma.jobMarker.upsert({
      where: { key: COLLECTION_SETTLE_MARKER },
      update: { at: new Date() },
      create: { key: COLLECTION_SETTLE_MARKER, at: new Date() },
    });
  }

  return { scanned, changed: changed.length, dryRun: !!opts.dryRun };
}
