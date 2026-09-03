/**
 * Köpförfrågningar på profilens samling ("Är den till salu?") — rena regler.
 *
 * Knappen på en annan persons Portfölj-flik öppnar parets chatt och skickar
 * EN automatisk fråga om objektet. Foilio är aldrig part: frågan är ett
 * meddelande, svaret och affären sker i chatten (samma princip som Köp/Sälj/Byt).
 *
 * Opt-outen bor i `User.preferences.allowPurchaseRequests` (fri JSON-kolumn som
 * /api/users/me PATCH mergar) — ingen migration, och en saknad nyckel betyder
 * PÅ: den som gjort sin samling offentlig får frågor tills hen säger nej.
 */

/** Samma fråga om samma objekt inom det här fönstret skickas inte igen — chatten öppnas bara. */
export const ASK_DEDUPE_MS = 24 * 60 * 60 * 1000;
/** Tak per frågande och timme, utöver chattens egna gränser (30 sändningar/min, 20 nya samtal/dygn). */
export const ASKS_PER_HOUR = 10;

export function allowsPurchaseRequests(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== "object") return true;
  return (preferences as Record<string, unknown>).allowPurchaseRequests !== false;
}

/**
 * Den automatiska frågan. Svensk med flit, som push-texterna: meddelandet är
 * inte locale-medvetet, och mottagaren är en svensk samlare. Namnet kommer ur
 * databasen (kort/produkt), aldrig ur klienten — annars vore knappen ett sätt
 * att skicka valfri text under sken av en systemfråga.
 */
export function purchaseAskText(name: string, setName: string | null): string {
  const what = setName ? `${name} (${setName})` : name;
  return `Hej! Är ditt ${what} till salu?`;
}
