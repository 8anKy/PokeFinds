/**
 * REVERSE HOLO UR VÅR PRISLEVERANTÖR (TCGGO `include_variants=1`, 2026-10-23).
 *
 * Leverantören bär sedan 2026-10-21 `variants[]` per kort med Cardmarkets lägsta
 * NM-annons för Reverse Holo. VERIFIERAT mot Cardmarkets EGNA sidor filtrerade
 * engelska + NM + reverse holo samma dag: Charizard · Secret Wonders 3 = 200,00 €
 * (feed 200), Eevee · Unseen Forces 55 = 174,90 € (feed 174,90). Talet är alltså
 * samma sorts tal som `lowest_near_mint` på det ordinarie kortet — CM:s engelska
 * NM-golv, rakt av — och INTE guidens `-holo`-fält (alla språk/skick: 8,99 resp.
 * 5,79 € på samma kort). Parametern kostar ingen extra kvot.
 *
 * Följden (ägarbeslut, plan 2026-10-22): TCGGO prissätter reverse holo där den har
 * ett värde, CardTrader är reserven där den saknar (mätt 2026-10-21: null på 4 av 7
 * vintagekort — just där CT prissätter dyrt).
 */

type VariantRow = {
  type?: string | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null } | null } | null;
};

/** Reverse holo-golvet i EUR, eller null när leverantören inte har något (0 är inget pris). */
export function tcggoReverseEur(row: { variants?: VariantRow[] | null } | null | undefined): number | null {
  const v = row?.variants?.find((x) => x?.type === "reverse_holo");
  const eur = v?.prices?.cardmarket?.lowest_near_mint;
  return typeof eur === "number" && Number.isFinite(eur) && eur > 0 ? eur : null;
}

/**
 * Länken till samma CM-produkt, filtrerad på reverse holo. CM har ingen egen produkt
 * för varianten — den är en flagga på annonsen. Idempotent. Filtret är INTE klistrigt
 * i sessionen (kontrollerat 2026-10-23: nästa ofiltrerade kortsida visade "Only
 * Reverse? No"), till skillnad från `isFirstEd`.
 */
export function reverseHoloCmUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set("isReverseHolo", "Y");
  return u.toString();
}

/**
 * Får en reverse holo-produkt SKAPAS ur leverantörens tal? Ett pris bevisar att det
 * finns en annons märkt reverse — men en felmärkt annons på ett kort som aldrig
 * trycktes som reverse (ex, full art, SIR …) hade gett en fantomvara. Därför två
 * krav: kortets sällsynthet är en av dem som trycks som reverse holo, och setet har
 * redan reverse holo-produkter (setet är ur en era med reverse-tryckningar).
 * Befintliga produkter prissätts alltid; grinden gäller bara att skapa nya.
 */
const REVERSE_RARITIES = new Set(["common", "uncommon", "rare", "rare holo"]);
export function mayCreateReverseProduct(input: { rarity: string | null | undefined; setHasReverse: boolean }): boolean {
  if (!input.setHasReverse) return false;
  return REVERSE_RARITIES.has((input.rarity ?? "").trim().toLowerCase());
}
