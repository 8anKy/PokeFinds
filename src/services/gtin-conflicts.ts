import { prisma } from "@/lib/db";
import { formatGtin, isPokemonManufacturerGtin } from "@/lib/gtin";

/**
 * Streckkods-KONFLIKTER för admin-länkfel-vyn, med SMARTA FILTER + KVITTERING.
 *
 * Den råa signalen "en produkt vars offers bär olika streckkoder" är brusig: samma
 * vara får legitimt olika koder mellan butiker (reprints/v2, svenska distributör-EAN,
 * och koder en butik råkar dela mellan flera SKU:er). Vi räknar därför BARA koder som
 * kan vara tillverkarens identitet OCH som inte redan avslöjats som opålitliga:
 *
 *   1. TILLVERKARPREFIX  — bara Pokémon-GS1-prefix (isPokemonManufacturerGtin). En
 *      svensk distributör-EAN (7340136…) är inte produktidentitet → räknas inte.
 *   2. INTE DELAD KOD    — en kod som samma-eller-olika butik hänger på ≥2 OLIKA
 *      produkter är en sortiments-/kopieringskod (Manatörsk satte 196214…139053 på
 *      BÅDE Clefable- och Gengar-tinen) → opålitlig identitet → räknas inte.
 *
 * Kvarstår ≥2 distinkta "räknande" koder är det en äkta granskningskandidat. Admin
 * kan KVITTERA den (markera OK) → `Product.gtinConflictAckKey` sätts till de räknande
 * kodernas nyckel. Vyn döljer den tills nyckeln ÄNDRAS (en ny avvikande kod dyker upp)
 * → då återuppstår konflikten automatiskt. Så en felmatch som ändras aldrig tystas för gott.
 */

export interface ConflictOffer {
  id: string;
  url: string;
  gtin: string | null; // formaterad för visning
  price: number | null;
  retailer: string;
  /** Räknas denna kod som identitet? false = distributör/delad → visas gråad, ignoreras. */
  counts: boolean;
}
export interface GtinConflict {
  productId: string;
  productTitle: string;
  productSlug: string;
  /** De räknande kodernas nyckel — skickas till kvitterings-API:t. */
  conflictKey: string;
  offers: ConflictOffer[];
}

/** Nyckel = sorterade distinkta räknande koder. Oförändrad kod → oförändrad nyckel. */
function keyOf(countingGtins: string[]): string {
  return [...new Set(countingGtins)].sort().join(",");
}

type RawOffer = {
  id: string; url: string; gtin: string | null; price: number | null; productId: string;
  retailer: { name: string };
  product: { title: string; slug: string; gtinConflictAckKey: string | null };
};

/** Koder som hänger på ≥2 olika produkter = opålitlig identitet (sortiment/dubblett). */
async function loadSharedGtins(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ gtin: string }[]>`
    SELECT o.gtin FROM "Offer" o
    WHERE o.gtin IS NOT NULL
    GROUP BY o.gtin HAVING COUNT(DISTINCT o."productId") > 1
  `;
  return new Set(rows.map((r) => r.gtin));
}

function counts(gtin: string | null, shared: Set<string>): boolean {
  return isPokemonManufacturerGtin(gtin) && !!gtin && !shared.has(gtin);
}

/** Grupp­era offers per produkt. */
function groupByProduct(offers: RawOffer[]): Map<string, RawOffer[]> {
  const m = new Map<string, RawOffer[]>();
  for (const o of offers) {
    const a = m.get(o.productId) ?? [];
    a.push(o);
    m.set(o.productId, a);
  }
  return m;
}

/**
 * Alla ännu-okvitterade streckkods-konflikter efter smarta filter.
 * Sorterade på produkttitel.
 */
export async function getGtinConflicts(): Promise<GtinConflict[]> {
  const shared = await loadSharedGtins();
  const offers = (await prisma.offer.findMany({
    where: { gtin: { not: null } },
    select: {
      id: true, url: true, gtin: true, price: true, productId: true,
      retailer: { select: { name: true } },
      product: { select: { title: true, slug: true, gtinConflictAckKey: true } },
    },
  })) as RawOffer[];

  const result: GtinConflict[] = [];
  for (const [productId, list] of groupByProduct(offers)) {
    const countingGtins = list.filter((o) => counts(o.gtin, shared)).map((o) => o.gtin as string);
    if (new Set(countingGtins).size < 2) continue; // inget kvar efter filtren
    const key = keyOf(countingGtins);
    if (list[0].product.gtinConflictAckKey === key) continue; // kvitterad + oförändrad
    result.push({
      productId,
      productTitle: list[0].product.title,
      productSlug: list[0].product.slug,
      conflictKey: key,
      offers: list.map((o) => ({
        id: o.id, url: o.url, gtin: formatGtin(o.gtin), price: o.price,
        retailer: o.retailer.name, counts: counts(o.gtin, shared),
      })),
    });
  }
  result.sort((a, b) => a.productTitle.localeCompare(b.productTitle, "sv"));
  return result;
}

/**
 * Aktuell konfliktnyckel för EN produkt (samma filter som getGtinConflicts).
 * null = ingen konflikt (inget att kvittera). Används av kvitterings-API:t så att
 * kvitteringen alltid speglar serverns nuvarande tillstånd, inte klientens.
 */
export async function currentConflictKeyForProduct(productId: string): Promise<string | null> {
  const shared = await loadSharedGtins();
  const offers = await prisma.offer.findMany({
    where: { productId, gtin: { not: null } },
    select: { gtin: true },
  });
  const countingGtins = offers.filter((o) => counts(o.gtin, shared)).map((o) => o.gtin as string);
  if (new Set(countingGtins).size < 2) return null;
  return keyOf(countingGtins);
}
