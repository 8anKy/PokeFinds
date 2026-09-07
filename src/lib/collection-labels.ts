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

export const LANGUAGE_LABELS: Record<string, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övrigt",
};
