/**
 * MOTORLÄGETS TVÅ DOMAR UTÖVER MOTORNS EGEN ORDNING (2026-10-14) — rena, testade.
 * Används av identifyFromEngine (src/services/scanner/index.ts).
 */

/**
 * Konstavtryckets etta under detta + noll geometri = inget kort. SAMMA tal som den gamla vägens
 * NO_CARD_ART_MAX (0,62: alla 31 uppmätta skanningar utan kort låg 0,41–0,60). Mätt 30 d (0 inliers):
 * 0,62 ⇒ 26 riktiga kort (motorn hade 8 rätt) mot 28 raderade skanningar.
 * ⛔ 0,55 provades först (10-14) och släppte igenom ägarens bord på 0,569 — gå inte ner igen utan en
 * andra signal (`embScore`, bokförs sedan 10-14 i result.shadow).
 */
export const ENGINE_NO_CARD_FP_MAX = 0.62;

/** Inget kort i bilden: motorn hittade INGEN geometri och konstavtrycket liknar inget kort. */
export function engineNoCard(bestInliers: number, fingerprintTop: number | null): boolean {
  return bestInliers <= 0 && (fingerprintTop === null || fingerprintTop < ENGINE_NO_CARD_FP_MAX);
}

/** Antal av motorns kort före konstavtryckets i valsteget, och valstegets platser (CHOOSE_OPTIONS_MAX). */
export const ENGINE_CHOICE_HEAD = 3;
export const CHOICE_SLOTS = 6;

/**
 * Valstegets ordning när motorn är osäker: motorns tre bästa, sedan konstavtryckets bästa tills sex
 * platser är fyllda, sist resten av motorns lista. Mätt 30 d (< 25 inliers, n=321): rätt kort bland
 * de sex 220 gånger, mot 211 med motorns fem + ett avtryck och 218 med två + fyra.
 */
export function engineChoiceOrder(engineIds: string[], fingerprintIds: string[]): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  engineIds.slice(0, ENGINE_CHOICE_HEAD).forEach(add);
  for (const id of fingerprintIds) {
    if (out.length >= CHOICE_SLOTS) break;
    add(id);
  }
  engineIds.slice(ENGINE_CHOICE_HEAD).forEach(add);
  return out;
}
