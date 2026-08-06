/**
 * Läsning av `User.preferences` — en fri JSON-kolumn som onboardingen skriver.
 *
 * ⛔ KOLUMNEN ÄR OTYPAD OCH GAMMAL DATA HAR ANDRA FORMER. Den har skrivits av
 * olika versioner av onboardingen och av seeden, så `favoriteSets` kan vara en
 * array av id:n, saknas helt, eller (i en tillräckligt gammal rad) vara något
 * annat än strängar. Rankningen får ALDRIG kasta på det: en trasig
 * preferences-rad skulle annars sänka HELA katalogfeeden för just den
 * användaren, och bara för inloggade, och bara i produktion.
 *
 * Därför: ren funktion, ingen kastning, allt som inte är en icke-tom sträng
 * sållas bort. Ett id som pekar på ett borttaget set är ofarligt — det matchar
 * bara aldrig.
 */

/** Favoritseten från onboardingen. Returnerar alltid en (möjligen tom) lista. */
export function favoriteSetIds(preferences: unknown): string[] {
  if (!preferences || typeof preferences !== "object") return [];
  const raw = (preferences as Record<string, unknown>).favoriteSets;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v);
  }
  return out;
}
