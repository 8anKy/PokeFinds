import { isDirectOfferUrl } from "./marketplace-urls";

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
