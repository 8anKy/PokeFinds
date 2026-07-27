/**
 * Katalogkortets namnrad ska visa produktens NAMN — inte den lagrade titeln, som
 * bakar in både set och kortnummer ("Umbreon · Obsidian Flames 130/197 ·
 * Specialversion", se scripts/import-tcg-data.ts). Set och nummer visas i stället
 * som egna rader i kortet, där setet är klickbart och slår på katalogfiltret.
 *
 * Product.title lämnas ORÖRD i databasen: den är sök-/matchningsnyckel
 * (normalizedTitle), rubrik på produktsidan och fallback här när ett kort saknar
 * Card-relation. Det här är alltså ren presentation, inte en datamigrering.
 */
export interface ProductDisplayParts {
  title: string;
  cardName?: string | null;
  cardNumber?: string | null;
  cardRarity?: string | null;
  setTotalCards?: number | null;
  variantLabel?: string | null;
}

/** Kortets egna namn när vi har det, annars den lagrade titeln (sealed m.fl.). */
export function productDisplayName(p: ProductDisplayParts): string {
  return p.cardName?.trim() || p.title;
}

/** "130/197" — totalen bara när setet har en (0 = okänt antal, t.ex. promoset). */
export function cardNumberLabel(p: ProductDisplayParts): string | null {
  const number = p.cardNumber?.trim();
  if (!number) return null;
  return p.setTotalCards && p.setTotalCards > 0 ? `${number}/${p.setTotalCards}` : number;
}

/**
 * Metaraden under setet: "Rare · 130/197 · Specialversion". null = inget att visa
 * (sealed har varken kort, nummer eller sällsynthet). Sällsyntheten först — det är
 * den grövsta sorteringen ögat gör; numret är identiteten och står näst intill.
 */
export function productMetaLabel(p: ProductDisplayParts): string | null {
  const parts = [p.cardRarity?.trim() || null, cardNumberLabel(p), p.variantLabel?.trim() || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
