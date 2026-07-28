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
