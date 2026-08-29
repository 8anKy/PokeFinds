/**
 * DOMENS STYRKA — vilken användarsignal som får skriva över vilken.
 *
 * Egen ren modul av samma skäl som `scan-alternatives.ts`: regeln avgör vad som
 * hamnar i facit, den har redan haft ETT specialfall som visade sig otillräckligt,
 * och konsekvenserna syns först i en rapport veckor senare.
 *
 * ⛔ **VARFÖR EN ORDNING OCH INTE ETT SPECIALFALL.** Förut fanns en enda regel:
 * "en bekräftelse får inte degradera en korrigering". Den räckte när det fanns två
 * `kind`. Med fyra `kind` och tre `via` är den vanliga sekvensen att användaren
 * rättar ett kort och sedan trycker "Lägg till alla" — och utan en fullständig
 * ordning hade masstrycket nollat rättelsen varje gång. Mätt 2026-08-29 var
 * korrigeringarna 2 av 649 domar; att tappa dem till ett masstryck är inte en
 * kantfall-risk, det är hela mätningen.
 *
 * ⛔ **`via` ÄR EN DEL AV STYRKAN, INTE METADATA.** En bekräftelse ur "Lägg till
 * alla" betyder "användaren invände inte" — hen har aldrig sett det enskilda
 * kortet. Mätt 2026-08-29: sådana rader var 83,4 % av allt facit och innehöll
 * NOLL korrigeringar (0 av 454, mot 2 av 50 aktiva val). ⚠️ Recallen skiljer sig
 * däremot bara 6,6 p.e. inom samma stratum — argumentet är uppmärksamhet, inte
 * träffsäkerhet. En senare aktiv bekräftelse på samma rad är STARKARE och vinner.
 */

/** ⛔ Ordningen är innebörd, inte smak. Ändra den inte utan att läsa filhuvudet. */
export const VERDICT_KIND_RANK: Record<string, number> = {
  /** Användaren pekade ut ett ANNAT kort — starkast facit vi kan få. */
  corrected: 40,
  /** Användaren raderade skanningen — vi hade fel, eller fångsten var oduglig. */
  rejected: 30,
  /** Användaren gick till manuell sökning — vårt svar dög inte. */
  searched: 20,
  /** Användaren tog vårt förslag. Styrkan avgörs i praktiken av `via`. */
  confirmed: 10,
};

/**
 * Ett aktivt val väger mer än ett masstryck. Stegen är 0–2 med flit: de ska
 * skilja INOM en `kind`, aldrig lyfta en svagare `kind` förbi en starkare
 * (avståndet mellan två `kind` är 10).
 */
export const VERDICT_VIA_RANK: Record<string, number> = {
  pick: 2,
  bulk: 1,
  auto: 0,
};

/**
 * @returns Jämförbart tal. Okänd/utelämnad `kind` ger 0 — en rad från en äldre
 *   klient ska aldrig kunna blockera en riktig dom.
 */
export function verdictStrength(kind?: string | null, via?: string | null): number {
  return (VERDICT_KIND_RANK[kind ?? ""] ?? 0) + (VERDICT_VIA_RANK[via ?? ""] ?? 0);
}
