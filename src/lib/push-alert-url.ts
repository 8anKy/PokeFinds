import type { AlertType } from "@prisma/client";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";

/**
 * VART EN PUSH-NOTIS SKA LEDA.
 *
 * Restock är ett lopp: den som trycker på notisen vill stå i butikens kassa,
 * inte på vår produktsida. Därför går RESTOCK/NEW_LISTING på en katalogprodukt
 * DIREKT till den butik som fick lager igen — samma butik mejlet redan länkar
 * (alert.retailerId) — när länken är en riktig produktlänk. Prislarm går
 * fortfarande till produktsidan: där är poängen att JÄMFÖRA, och "Lägst"-taggen
 * + de andra butikerna finns bara hos oss.
 *
 * ⛔ Bara direkta länkar (`isDirectOfferUrl`) — en sök-/kategorilänk i en push
 * är värre än vår egen sida. Saknas länk ⇒ produktsidan, som förut.
 * Feed-först-larm (ingen produkt) gick redan till annonsen.
 */
export function pushAlertUrl(input: {
  type: AlertType;
  productSlug: string | null;
  listingUrl: string | null;
  /** Den utlösande butikens offer-URL (alert.retailerId), om någon. */
  storeUrl: string | null;
  /** Förhandsvisningsgrinden (feature-preview.ts). */
  toStore: boolean;
}): string | undefined {
  const { type, productSlug, listingUrl, storeUrl, toStore } = input;
  if (!productSlug) return listingUrl ?? undefined;
  const race = type === "RESTOCK" || type === "NEW_LISTING";
  if (toStore && race && storeUrl && isDirectOfferUrl(storeUrl)) return storeUrl;
  return `/produkter/${productSlug}`;
}
