/**
 * UNDERSERIENS EGET NUMMER (2026-09-22).
 *
 * Vissa kort bär TVÅ tryckta nummer: setets ("051/128") och en underseries
 * ("29/30"). Vision-modellen läser ofta underseriens, och den pekar då på ett
 * HELT ANNAT katalogkort — i 30th Celebration är #29 också en Pikachu, så felet
 * såg ut som ett säkert nummerbevis.
 *
 * MÄTT i fält (alla domar där Gemini läste "N/30"): användarens kort var
 * 30th Celebration #(N+22) i 51 fall (15 aktiva val) mot #N i 3 (alla ur
 * "Lägg till alla", dvs ett uteblivet klick). Korrigeringarna "samma namn,
 * annat nummer" dominerades av just detta. Telefonens egen OCR läste i samma
 * fall setets nummer (51, 50, 46 …) — båda numren står alltså på kortet.
 *
 * ⛔ En tabell med VERIFIERADE underserier, aldrig en heuristik: en regel som
 * "lägg till ett offset när totalen inte stämmer" hade gjort varje felläst
 * total till ett bevis för ett tredje kort. Ny rad ⇒ mät först (samma fråga som
 * ovan), och bara när underserien är tryckt 1..subsetTotal i en sammanhängande
 * följd i katalogen.
 */

export interface SubsetNumberAlias {
  /** Katalogkortens `tcgExternalId`-prefix ("me55" ⇒ "me55-51"). */
  tcgPrefix: string;
  /** Underseriens tryckta total ("/30"). */
  subsetTotal: number;
  /** Katalognummer = underseriens nummer + offset. */
  offset: number;
}

export const SUBSET_NUMBER_ALIASES: readonly SubsetNumberAlias[] = [
  // 30th Celebration (EN): "Pikachu Rare" #23–#52 trycks också "1/30"–"30/30".
  { tcgPrefix: "me55", subsetTotal: 30, offset: 22 },
];

/** `tcgExternalId` för de kort en läsning "N/total" kan syfta på via en underserie. */
export function subsetAliasExternalIds(
  guessed: { num: number | null; total: number | null } | null | undefined,
  aliases: readonly SubsetNumberAlias[] = SUBSET_NUMBER_ALIASES
): string[] {
  if (!guessed || guessed.num == null || guessed.total == null) return [];
  const { num, total } = guessed;
  return aliases
    .filter((a) => a.subsetTotal === total && num >= 1 && num <= a.subsetTotal)
    .map((a) => `${a.tcgPrefix}-${num + a.offset}`);
}
