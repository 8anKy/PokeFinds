/**
 * /sets som rutor (ägarbeslut 2026-10-16): logga, släppdatum, framsteg (kort) och värde.
 *
 * TVÅ LÄSNINGAR, AV OLIKA SLAG:
 *  · `loadSetsGallery` — publik, samma för alla, renderas i sidans ISR-HTML (1 h).
 *    Setvärdet = summan av nattens frysta samlingsvärde (`Product.settledValueOre`) för
 *    ETT ex av varje kort i setet (ordinarie tryckning, synliga produkter). Kort utan
 *    värde räknas inte — talet är "minst", och antalet prissatta följer med.
 *  · `getOwnedBySet` — personlig, hämtas av klienten BARA när någon är inloggad (samma
 *    mönster som setsidans komplettering: en utloggad besökare väcker aldrig Neon).
 *
 * ⛔ Nämnaren är kompletteringens (`resolveSetTotals().full`): hela setet inkl. secret
 * rares, aldrig printedTotal och aldrig tryckningar — samma tal som setsidans stapel.
 */
import { prisma } from "@/lib/db";
import { NOT_HIDDEN } from "@/lib/product-visibility";
import { resolveSetTotals } from "@/lib/set-denominator";
import { isSetListed } from "@/lib/set-listing";
import { setEra, type Era } from "@/lib/set-era";
import { cachedRead } from "@/lib/cache";
import { isRealSetLogo } from "@/lib/set-logo";

export interface SetTile {
  id: string;
  slug: string | null;
  name: string;
  language: "EN" | "JP";
  era: Era;
  logoUrl: string | null;
  /** ISO-datum eller null. */
  releaseDate: string | null;
  /** Kompletteringens nämnare. null = inga kort ännu (osläppt set). */
  total: number | null;
  /** Summan av ett ex av varje prissatt kort, öre. null = inget kort har värde. */
  setValueOre: number | null;
  pricedCards: number;
}

export async function loadSetsGallery(): Promise<SetTile[]> {
  const [sets, values] = await Promise.all([
    prisma.cardSet.findMany({
      // Samma urval som förut: engelska set + japanska set med kort, minst en synlig produkt.
      where: {
        OR: [{ language: "EN" }, { language: "JP", cards: { some: {} } }],
        products: { some: NOT_HIDDEN },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        language: true,
        series: true,
        externalId: true,
        logoUrl: true,
        releaseDate: true,
        totalCards: true,
        totalCardsFull: true,
        _count: { select: { cards: true } },
      },
      orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
    }),
    prisma.$queryRaw<{ setId: string; v: bigint | null; priced: number }[]>`
      SELECT "setId",
             SUM("settledValueOre")::bigint AS v,
             COUNT("settledValueOre")::int  AS priced
        FROM "Product"
       WHERE category = 'SINGLE_CARD' AND "variantLabel" IS NULL AND "hiddenAt" IS NULL
         AND "setId" IS NOT NULL
       GROUP BY "setId"`,
  ]);
  const valueBySet = new Map(values.map((r) => [r.setId, r]));

  return sets.filter(isSetListed).map((s) => {
    const totals = resolveSetTotals({ totalCards: s.totalCards, totalCardsFull: s.totalCardsFull, cardCount: s._count.cards });
    const v = valueBySet.get(s.id);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      language: s.language === "JP" ? "JP" : "EN",
      era: setEra(s),
      // Bara riktiga loggor — kort/produktfoton/ritade brickor ⇒ null ⇒ namnbricka (lib/set-logo.ts).
      logoUrl: isRealSetLogo(s.logoUrl) ? s.logoUrl : null,
      releaseDate: s.releaseDate ? s.releaseDate.toISOString() : null,
      total: totals.full,
      setValueOre: v?.v != null && v.priced > 0 ? Number(v.v) : null,
      pricedCards: v?.priced ?? 0,
    };
  });
}

export interface OwnedInSet {
  /** Antal OLIKA kort ur setet (lots räknas en gång). */
  owned: number;
  /** Värdet av användarens poster ur setet, öre (antal × nattens frysta värde). */
  valueOre: number;
}

/**
 * EN aggregerad fråga för alla set. Värdet: postens egen produkt, annars kortets ordinarie
 * produkt. Graderade poster räknas här som ograderade — rutan är en överblick; samlingen
 * visar slabbens sålda värde.
 */
export async function getOwnedBySet(userId: string): Promise<Record<string, OwnedInSet>> {
  const rows = await prisma.$queryRaw<{ setId: string; owned: number; v: bigint | null }[]>`
    SELECT c."setId" AS "setId",
           COUNT(DISTINCT ci."cardId")::int AS owned,
           SUM(ci.quantity * COALESCE(p."settledValueOre", p."lowestPriceOre", 0))::bigint AS v
      FROM "CollectionItem" ci
      JOIN "Card" c ON c.id = ci."cardId"
      LEFT JOIN LATERAL (
        SELECT pp."settledValueOre", pp."lowestPriceOre"
          FROM "Product" pp
         WHERE pp.id = ci."productId"
            OR (ci."productId" IS NULL AND pp."cardId" = ci."cardId" AND pp."variantLabel" IS NULL)
         ORDER BY (pp.id = ci."productId") DESC NULLS LAST, pp."hiddenAt" NULLS FIRST
         LIMIT 1
      ) p ON TRUE
     WHERE ci."userId" = ${userId}
     GROUP BY c."setId"`;
  const out: Record<string, OwnedInSet> = {};
  for (const r of rows) out[r.setId] = { owned: r.owned, valueOre: Number(r.v ?? 0) };
  return out;
}

export interface SetSummary {
  id: string;
  slug: string | null;
  name: string;
  language: "EN" | "JP";
  era: Era;
  logoUrl: string | null;
  releaseDate: string | null;
  total: number | null;
  setValueOre: number | null;
}

/**
 * Setrubriken i Utforska (`/produkter?set=<id>`, ett set valt). Samma tal som /sets-rutan.
 * Cachad 1 h per set — katalogsidan är dynamisk och får inte fråga Neon per sidvisning.
 * Returnerar ÄVEN set som inte listas på /sets: korten finns i katalogen och nås därifrån.
 */
export const getSetSummary = cachedRead(
  async (setId: string): Promise<SetSummary | null> => {
    const [s, v] = await Promise.all([
      prisma.cardSet.findUnique({
        where: { id: setId },
        select: {
          id: true, slug: true, name: true, language: true, series: true, logoUrl: true, releaseDate: true,
          totalCards: true, totalCardsFull: true, _count: { select: { cards: true } },
        },
      }),
      prisma.$queryRaw<{ v: bigint | null; priced: number }[]>`
        SELECT SUM("settledValueOre")::bigint AS v, COUNT("settledValueOre")::int AS priced
          FROM "Product"
         WHERE "setId" = ${setId} AND category = 'SINGLE_CARD' AND "variantLabel" IS NULL AND "hiddenAt" IS NULL`,
    ]);
    if (!s) return null;
    const totals = resolveSetTotals({ totalCards: s.totalCards, totalCardsFull: s.totalCardsFull, cardCount: s._count.cards });
    const row = v[0];
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      language: s.language === "JP" ? "JP" : "EN",
      era: setEra(s),
      // Bara riktiga loggor — kort/produktfoton/ritade brickor ⇒ null ⇒ namnbricka (lib/set-logo.ts).
      logoUrl: isRealSetLogo(s.logoUrl) ? s.logoUrl : null,
      releaseDate: s.releaseDate ? s.releaseDate.toISOString() : null,
      total: totals.full,
      setValueOre: row?.v != null && row.priced > 0 ? Number(row.v) : null,
    };
  },
  "setSummary",
  3600
);
