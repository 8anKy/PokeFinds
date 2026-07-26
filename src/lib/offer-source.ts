import { isDirectOfferUrl } from "./marketplace-urls";

export interface OfferSourceLike {
  /** öre — null/0 = länk-offer utan känt pris */
  price: number | null;
  stockStatus: string;
  url: string;
  retailer: { name: string };
}

/**
 * Vilken källa gav det visade lägsta priset?
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
 */
export function lowestOfferSource(
  offers: OfferSourceLike[],
  shownLowestOre: number | null
): string | null {
  if (shownLowestOre == null) return null;
  const priced = offers.filter(
    (o): o is OfferSourceLike & { price: number } =>
      o.price != null && o.price > 0 && isDirectOfferUrl(o.url)
  );
  const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : priced;
  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return best.price === shownLowestOre ? best.retailer.name : null;
}
