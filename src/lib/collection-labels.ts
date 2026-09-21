/**
 * Fallback-etiketter för skick och språk — nycklarna är `CardCondition` och
 * `CardLanguage` i schemat, och det är NYCKELN som lagras, aldrig etiketten.
 *
 * Texterna här är bara en säkerhet för nycklar som saknar översättning: i UI:t
 * går de via `useTranslations("Condition"/"Language")`. Modulen är ren (ingen
 * React, ingen Prisma) så att både portföljen och skannern kan läsa den utan
 * att dra in varandras klientkomponenter.
 */
export const CONDITION_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Sealed",
};

/**
 * EN FÖRSEGLAD PRODUKT HAR TVÅ SKICK: förseglad eller öppnad (ägarbeslut
 * 2026-09-22). Mint/Played/gradering är kortvokabulär och visas inte för en
 * ETB. Nycklarna återanvänds ur enumen (ingen migration): SEALED = förseglad,
 * NEAR_MINT = öppnad — samma tolkning som Tradera-säljarkets `SEALED_LABELS`.
 * "Förseglad" = posten saknar kort-id men har produkt-id, precis som
 * `toSellItem` dömer. Etiketten för NEAR_MINT på en sealed-post kommer ur
 * `Collection.conditionOpened`, aldrig ur `Condition.NEAR_MINT`.
 */
export const SEALED_ITEM_CONDITIONS = ["SEALED", "NEAR_MINT"] as const;
export const SEALED_CONDITION_OPENED = "NEAR_MINT";

export function isSealedCollectionItem(item: { cardId: string | null; productId: string | null }): boolean {
  return item.cardId == null && item.productId != null;
}

export const LANGUAGE_LABELS: Record<string, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övrigt",
};
