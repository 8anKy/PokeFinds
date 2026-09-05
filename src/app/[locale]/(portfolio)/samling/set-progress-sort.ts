/**
 * Sorteringarna för Set-fliken. Rena komparatorer — ingen React, ingen databas.
 *
 * ⛔ VALET BOR I KLIENT-STATE, ALDRIG I `searchParams`. Samma regel som resten av
 * `/samling` (se `collection-filter.ts`): en URL-parameter hade gjort sidan
 * dynamisk på ett annat sätt och delat en länk som ser trasig ut för mottagaren.
 *
 * ⛔ OKÄNT SORTERAS ALLTID SIST, i alla lägen. Ett set utan nämnare (de 95
 * japanska) eller utan känt värde ska inte kunna hamna överst genom att räknas
 * som 0 — då hade "närmast klart" toppats av det vi vet minst om.
 */
import type { SetPortfolioRow } from "@/services/set-portfolio";

export const SET_SORTS = ["closest", "value", "remaining", "name"] as const;
export type SetSort = (typeof SET_SORTS)[number];

/** null sist, oavsett riktning. Returnerar null när ingen av dem är null. */
function nullsLast(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return null;
}

export function sortSetRows(rows: SetPortfolioRow[], sort: SetSort): SetPortfolioRow[] {
  const out = [...rows];
  switch (sort) {
    case "closest":
      out.sort((a, b) => {
        const n = nullsLast(a.percent, b.percent);
        if (n != null) return n;
        // Oavgjord procent bryts på ANTAL ägda kort: 59 av 190 är en större
        // bedrift än 3 av 10, och den som är nära ett stort set vill se det.
        return b.percent! - a.percent! || b.ownedCards - a.ownedCards;
      });
      break;
    case "value":
      out.sort((a, b) => {
        const n = nullsLast(a.valueOre, b.valueOre);
        if (n != null) return n;
        return b.valueOre! - a.valueOre!;
      });
      break;
    case "remaining":
      out.sort((a, b) => {
        const ra = a.total != null ? a.total - a.ownedCards : null;
        const rb = b.total != null ? b.total - b.ownedCards : null;
        const n = nullsLast(ra, rb);
        if (n != null) return n;
        // Färrest kvar först — det är listan "vad kan jag bli klar med nu?".
        return ra! - rb!;
      });
      break;
    case "name":
      // ⛔ `localeCompare("sv")`: å/ä/ö sorteras SIST i svenskan, inte som a/o.
      out.sort((a, b) => a.setName.localeCompare(b.setName, "sv"));
      break;
  }
  return out;
}
