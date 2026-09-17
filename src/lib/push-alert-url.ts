import type { AlertType } from "@prisma/client";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { buyLink } from "@/lib/cart-url";

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
 *
 * KORGEN FÖRE PRODUKTSIDAN (ägarbeslut 2026-09-17): har butiken en lägg-i-korgen-
 * länk (`cartUrl`, Shopify/Woo — src/lib/cart-url.ts) går pushen dit, så trycket
 * lämnar användaren med varan i korgen. Ingen korglänk ⇒ butikens produktsida.
 */
export function pushAlertUrl(input: {
  type: AlertType;
  productSlug: string | null;
  listingUrl: string | null;
  /** Den utlösande butikens offer-URL (alert.retailerId), om någon. */
  storeUrl: string | null;
  /** Samma offers lägg-i-korgen-länk, om butiken har en. */
  cartUrl?: string | null;
  /** Förhandsvisningsgrinden (feature-preview.ts). */
  toStore: boolean;
}): string | undefined {
  const { type, productSlug, listingUrl, storeUrl, cartUrl, toStore } = input;
  if (!productSlug) return listingUrl ?? undefined;
  const race = type === "RESTOCK" || type === "NEW_LISTING";
  if (toStore && race && storeUrl && isDirectOfferUrl(storeUrl)) return buyLink(cartUrl, storeUrl);
  return `/produkter/${productSlug}`;
}
