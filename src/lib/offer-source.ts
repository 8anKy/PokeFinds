import { isDirectOfferUrl } from "./marketplace-urls";

/**
 * Källor som INTE är butiker (ägarbeslut 2026-08-13).
 *
 * En BUTIKS-offer är ett faktum förankrat i en URL: butiken säljer den här varan på
 * den här sidan. En MARKNADSPLATS-offer är ett PÅSTÅENDE OM IDENTITET som våra egna
 * jobb räknat fram — Cardmarket-länken kommer ur en fuzzy-match, Tradera-länken ur en
 * titelsökning, CardTrader ur en blueprint-join.
 *
 * ⛔ DÄRFÖR FÖLJER DE ALDRIG MED I EN MERGE. Kanonprodukten har redan sin egen,
 *    verifierade marknadsplatslänk; stubbens är en gissning som ingen granskat. Att
 *    flytta över den kan tysta ersätta ett granskat `idProduct` med ett fuzzy-matchat,
 *    och det felet är osynligt — priset ser rimligt ut, det är bara fel produkt.
 *    Tappar kanonprodukten en länk den borde ha återställer de dagliga jobben
 *    (cardmarket-refresh, tradera-sweep, cardtrader-refresh) den; en felaktig länk
 *    städas däremot bara för hand.
 *
 * ⛔ Listan är NAMN, inte en flagga på Retailer — samma form som `.audit/`-skripten
 *    använt sedan katalogrevisionen, och namnen är stabila (de sätts i prisma/seed.ts
 *    och av prisjobben). "Tradera sålt" är TRADERA_SOLD_SOURCE_NAME i
 *    services/products.ts; den bär genomförda affärer och är ren historik.
 */
export const NON_STORE_RETAILERS = [
  "Cardmarket",
  "Tradera",
  "Tradera sålt",
  "CardTrader",
  "Pokémon TCG API",
  "TCGdex API",
  "Mock-datakälla",
] as const;

/** Är källan en riktig butik (dvs en URL man kan handla på)? */
export function isStoreRetailer(name: string): boolean {
  return !(NON_STORE_RETAILERS as readonly string[]).includes(name);
}

export interface OfferSourceLike {
  /** öre — null/0 = länk-offer utan känt pris */
  price: number | null;
  stockStatus: string;
  url: string;
  retailer: { name: string };
}

/**
 * Vilken offer gav det visade lägsta priset?
 *
 * Rubriken på produktsidan påstod tidigare ALLTID "Cardmarket" på singlar, oavsett
 * var siffran kom ifrån. På 2 751 singlar var vinnaren i själva verket en Tradera-
 * annons, och på tre helt nya set (Pitch Black m.fl.) fanns ingen CM-offer alls —
 * sidan namngav alltså en källa som varken hade pris eller länk. Rubriken måste
 * kunna säga vad den faktiskt visar.
 *
 * Samma urvalsregel som servern (`loadProductDetailRaw` + offers-API:t): bara
 * direkta produktlänkar, i lager före slutsålt, därefter lägst pris.
 *
 * Källan namnges BARA om den bevisligen producerade `shownLowestOre`. Skulle
 * urvalen någon gång glida ifrån varandra blir svaret null (neutral rubrik) i
 * stället för ett självsäkert fel namn.
 *
 * `live` = vann en offer som faktiskt är I LAGER. Prisjobben märker en offer
 * OUT_OF_STOCK precis när siffran är en UPPSKATTNING och inte en känd köpbar annons
 * (`lowest_near_mint` saknades → median av CM:s referenser). Rubriken "Lägsta pris ·
 * NM engelska" får inte stå över ett sådant värde — det finns per definition ingen
 * NM-engelsk annons att vara lägst bland. Gäller 469 singlar och 258 sealed (2026-07-27).
 */
export function lowestOfferSource(
  offers: OfferSourceLike[],
  shownLowestOre: number | null
): { name: string; live: boolean } | null {
  if (shownLowestOre == null) return null;
  const priced = offers.filter(
    (o): o is OfferSourceLike & { price: number } =>
      o.price != null && o.price > 0 && isDirectOfferUrl(o.url)
  );
  const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : priced;
  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  if (best.price !== shownLowestOre) return null;
  return { name: best.retailer.name, live: best.stockStatus === "IN_STOCK" };
}
