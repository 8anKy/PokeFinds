/**
 * EN BORTTAGEN FELMATCH FÅR INTE LÄMNA PRODUKTEN UTAN MARKNADSPLATS-RAD.
 *
 * Tradera-annonserna lever i TVÅ tabeller: `Offer` (pristabellen "Priser hos
 * butiker", en rad per produkt) och `TraderaListing` (produktsidans karusell,
 * upp till 20 vettiga annonser per produkt). Svepet skriver båda ur samma
 * kandidatlista — men städverktygen tog bara offern.
 *
 * Följden, mätt på prod 2026-07-27: 274 produkter visade en KARUSELL FULL AV
 * TRADERA-ANNONSER utan en enda Tradera-rad i pristabellen. Det ser ut som en
 * bugg och är det: annonserna finns, vi hade bara raderat den vi råkade ha valt.
 * (Ekans · Team Rocket 56/82 tappade sin offer i nummer-städningen 2026-07-25 —
 * annonsen var "Team Rocket's Ekans #112 - Destined Rivals", alltså ett annat
 * kort — medan tre riktiga Ekans-annonser låg kvar i karusellen. Nästa gång
 * produkten namn-söks återskapas offern, men rotationen tar dagar.)
 *
 * Kandidaterna här är INTE nya: de har redan passerat svepets kategori-, språk-,
 * titel- och prisvakt när de skrevs som skena-rader. Det enda som görs är att
 * välja nästa i samma lista — samma regel som svepet självt använder (billigast
 * som klarar facit vinner).
 */
import { prisma } from "@/lib/db";
import { listingCardLanguage } from "@/lib/listing-language";
import { listingPriceIsPlausible } from "@/lib/listing-plausibility";
import { matchListingToProduct } from "@/scrapers/matching";

/** Annons vald som ersättare (null = ingen kvalificerad kandidat). */
export interface PromotedListing {
  itemId: string;
  title: string;
  price: number;
  url: string;
}

/**
 * Billigaste kvarvarande skena-annons för produkten som (a) inte är dömd som
 * felmatch, (b) fortfarande matchar produkten enligt DAGENS matchare och
 * (c) håller mot produktens Cardmarket-pris. `excludeItemId` = annonsen som just
 * städats bort.
 *
 * (b) ÄR INTE ÖVERFLÖDIG, den är hela skillnaden mellan reparation och återfall.
 * En skena-rad vaktades av den matchare som fanns när den SKREVS. Ekans · Team
 * Rocket 56/82 hade "Team Rocket's Ekans #112 - Destined Rivals" liggande sedan
 * 2026-07-25 06:36 — skriven timmar innan nummervakten deployades, och det var
 * just den annonsen städningen samma dag tog bort som offer. Att bara välja
 * "billigaste kvarvarande" lyfte alltså tillbaka precis det som nyss städats
 * bort (verifierat: repareringen skrev den till offer innan vakten fanns här).
 *
 * Prisvakten är med FLIT hårdare här än i karusellen: den här annonsen sätter
 * produktens rubrikpris, och ett pris vi inte kan försvara får inte bli rubrik
 * bara för att annonsen finns.
 */
export async function findReplacementListing(
  productId: string,
  excludeItemId?: string | null
): Promise<PromotedListing | null> {
  const [product, rails, rejected, cmOffer] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      // variantLabel: utan den kan matchListingToProduct inte hålla isär tryckningarna,
      // och ersättaren kunde bli en ordinarie annons på 1st Edition-produkten.
      select: { normalizedTitle: true, language: true, variantLabel: true, card: { select: { name: true, number: true } } },
    }),
    prisma.traderaListing.findMany({
      where: { productId },
      orderBy: { price: "asc" },
      select: { itemId: true, title: true, price: true, url: true },
    }),
    prisma.traderaMatch.findMany({ where: { productId, ok: false }, select: { itemId: true } }),
    prisma.offer.findFirst({
      where: { productId, retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { price: true },
    }),
  ]);
  if (!product) return null;
  const blocked = new Set(rejected.map((r) => r.itemId));
  return (
    rails.find(
      (r) =>
        r.itemId !== excludeItemId &&
        !blocked.has(r.itemId) &&
        listingCardLanguage(r.title, r.url) === product.language &&
        matchListingToProduct(r.title, product) != null &&
        listingPriceIsPlausible(r.price, cmOffer?.price ?? null)
    ) ?? null
  );
}

/** Tradera-annonsens itemId ur en annons-URL (null = inte en annons-länk). */
export function listingItemIdFromUrl(url: string): string | null {
  return url.match(/\/item\/\d+\/(\d+)/)?.[1] ?? null;
}

/** Vad purgen faktiskt gjorde — för loggning/kvittens. */
export interface MarketplacePurge {
  productId: string;
  itemId: string;
  poisonedObservations: number;
  replacement: PromotedListing | null;
}

/**
 * RIOLU-RECEPTET: ta bort en marknadsplats-offer som bevisligen är ett ANNAT
 * föremål, och se till att svepet inte återskapar den. Fem steg, alla behövs:
 *
 *   1. radera Offer:n (på offer-ID — aldrig på pris/URL-mönster)
 *   2. TraderaMatch.ok = false för (itemId, productId) → svepet slår upp domen
 *      och återskapar ALDRIG en känd felmatch (raden överlever offer-raderingen)
 *   3. radera de förgiftade PriceObservation-raderna (samma produkt, samma källa,
 *      exakt det priset) → annonsens pris försvinner även ur grafen
 *   4. radera TraderaListing-raden (produktsidans karusell "Fler annonser")
 *   5. lyft fram nästa vettiga annons som offer. Utan det står produktsidan med
 *      en karusell full av Tradera-annonser men ingen Tradera-rad i pristabellen.
 *
 * ⛔ Steg 1 ENSAMT är inte en borttagning, det är en fördröjning: annonsen ligger
 * kvar i Traderas sökresultat, matchar fortfarande, och nästa svep skriver
 * tillbaka den. Därför bor receptet HÄR och inte i anropsstället — både
 * admin-knappen och `scripts/purge-mismatched-offer.ts` kallar samma kod.
 *
 * Anroparen ansvarar för `recomputeProductPriceCache()` (en gång, efter batchen).
 * Returnerar null när offern saknar itemId (= inte en marknadsplats-annons).
 */
export async function purgeMismatchedMarketplaceOffer(
  offer: {
    id: string;
    productId: string;
    price: number | null;
    url: string;
    retailerId: string;
    retailerName: string;
    productCategory: string;
  },
  reason: string
): Promise<MarketplacePurge | null> {
  const itemId = listingItemIdFromUrl(offer.url);
  if (!itemId) return null;

  const source = await prisma.scrapeSource.findFirst({
    where: { name: offer.retailerName },
    select: { id: true },
  });
  const replacement = await findReplacementListing(offer.productId, itemId);

  await prisma.offer.delete({ where: { id: offer.id } });
  await prisma.traderaMatch.upsert({
    where: { itemId_productId: { itemId, productId: offer.productId } },
    update: { ok: false, reason },
    create: { itemId, productId: offer.productId, ok: false, reason },
  });
  await prisma.traderaListing.deleteMany({ where: { productId: offer.productId, itemId } });

  let poisonedObservations = 0;
  if (offer.price != null && source) {
    const res = await prisma.priceObservation.deleteMany({
      where: { productId: offer.productId, sourceId: source.id, price: offer.price },
    });
    poisonedObservations = res.count;
  }

  if (replacement) {
    await writeMarketplaceOffer(
      offer.productId,
      offer.retailerId,
      offer.productCategory,
      replacement
    );
  }

  return { productId: offer.productId, itemId, poisonedObservations, replacement };
}

/**
 * Sätt (eller uppdatera) produktens Tradera-offer till `listing`. Samma
 * unika nyckel och samma skick-/språkhärledning som svepet använder — annars
 * hade en ersättare kunnat hamna som en ANDRA rad bredvid den gamla.
 */
export async function writeMarketplaceOffer(
  productId: string,
  retailerId: string,
  category: string,
  listing: PromotedListing
): Promise<void> {
  const condition =
    category === "SINGLE_CARD" || category === "GRADED_CARD" ? "NEAR_MINT" : "SEALED";
  const language = listingCardLanguage(listing.title, listing.url);
  const data = {
    price: listing.price,
    currency: "SEK",
    stockStatus: "IN_STOCK" as const,
    url: listing.url,
    lastSeenAt: new Date(),
  };
  await prisma.offer.upsert({
    where: {
      productId_retailerId_condition_language: { productId, retailerId, condition, language },
    },
    update: data,
    create: { productId, retailerId, condition, language, ...data },
  });
}
