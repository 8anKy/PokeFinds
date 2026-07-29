/**
 * Skriver om `Product.rankScore` — kvalitetshalvan av "bäst matchning".
 *
 * Körs en gång per dygn av scrape-all, EFTER refreshPopularityScores() (den fyller
 * `viewCount`, som är en av ingredienserna). Signalerna aggregeras i EN fråga och
 * poängen räknas av samma rena funktion som sökvägen använder i minnet
 * (src/services/ranking.ts) — en enda formel, ett enda ställe att ändra på.
 *
 * SKRIVER BARA RADER SOM ÄNDRATS: efter första passet är dygnsdeltat litet, och
 * en updateMany per distinkt poäng (mönstret i refreshPopularityScores) hade blivit
 * ~1000 rundresor när HELA katalogen har en poäng. Här går det i klumpar om 1000
 * rader med ett UPDATE … FROM (VALUES …).
 */
import { prisma } from "@/lib/db";
import { DIRECT_URL_SQL } from "@/services/products";
import { qualityScoreInt } from "@/services/ranking";

interface SignalRow {
  id: string;
  engagement: number;
  watchers: number;
  offer_count: number;
  in_stock_count: number;
  has_image: boolean;
  has_price: boolean;
  release_date: Date | null;
  current: number;
}

const CHUNK = 1000;

export async function refreshRankScores(): Promise<{ scanned: number; updated: number }> {
  const rows = await prisma.$queryRawUnsafe<SignalRow[]>(`
    SELECT p.id,
           p."viewCount"::int                                   AS engagement,
           COALESCE(w.n, 0)::int                                AS watchers,
           COALESCE(o.total, 0)::int                            AS offer_count,
           COALESCE(o.in_stock, 0)::int                         AS in_stock_count,
           (p."imageUrl" IS NOT NULL)                           AS has_image,
           (p."lowestPriceOre" IS NOT NULL)                     AS has_price,
           -- Singelns set bor på KORTET, sealed-produktens på produkten.
           COALESCE(p."releaseDate", cs."releaseDate")          AS release_date,
           p."rankScore"::int                                   AS current
    FROM "Product" p
    LEFT JOIN "Card" c    ON c.id = p."cardId"
    LEFT JOIN "CardSet" cs ON cs.id = COALESCE(p."setId", c."setId")
    LEFT JOIN (
      SELECT "productId", COUNT(*)::int AS n FROM "WatchlistItem" GROUP BY 1
    ) w ON w."productId" = p.id
    LEFT JOIN (
      SELECT "productId",
             COUNT(*)::int AS total,
             -- Samma vakt som katalogen i övrigt: en söklänk är ingen vara i lager.
             COUNT(*) FILTER (WHERE "stockStatus" = 'IN_STOCK' AND ${DIRECT_URL_SQL})::int AS in_stock
      FROM "Offer" GROUP BY 1
    ) o ON o."productId" = p.id
  `);

  const now = new Date();
  const changed: { id: string; score: number }[] = [];
  for (const r of rows) {
    const score = qualityScoreInt({
      engagement30d: r.engagement,
      watchers: r.watchers,
      inStockCount: r.in_stock_count,
      offerCount: r.offer_count,
      hasImage: r.has_image,
      hasPrice: r.has_price,
      setReleaseDate: r.release_date ? new Date(r.release_date) : null,
      now,
    });
    if (score !== r.current) changed.push({ id: r.id, score });
  }

  for (let i = 0; i < changed.length; i += CHUNK) {
    const slice = changed.slice(i, i + CHUNK);
    const values = slice.map((_, n) => `($${n * 2 + 1}::text, $${n * 2 + 2}::int)`).join(",");
    const args = slice.flatMap((c) => [c.id, c.score]);
    await prisma.$executeRawUnsafe(
      `UPDATE "Product" AS p SET "rankScore" = v.score
       FROM (VALUES ${values}) AS v(id, score)
       WHERE p.id = v.id`,
      ...args
    );
  }

  return { scanned: rows.length, updated: changed.length };
}
