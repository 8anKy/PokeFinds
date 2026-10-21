/**
 * Vad en enkelskanning BLEV för användaren — en regel för både skannersidan
 * (vilken rad som ritas) och servern (vad som räknas mot kvoten).
 *
 * ⛔ KVOTEN RÄKNAR BARA "matched" (ägarbeslut 2026-10-21): skannern går på egen
 * motor utan AI, så en misslyckad skanning kostar oss ingenting. Förut räknade
 * servern varje svar med minst en kandidat, medan sidan visade "Ingen träff"
 * (konfidens < MIN_MATCH_CONF) eller valsteget (oavgjort mellan olika kort) —
 * kunden betalade kvot för en skanning som misslyckades. Glider de två isär
 * igen är felet tyst, därför bor regeln här och ingen annanstans.
 */

/** Under den här konfidensen visas "Ingen träff" i stället för ett förslag. */
export const MIN_MATCH_CONF = 0.2;

export type ScanOutcome = "matched" | "choose" | "nomatch";

export function scanOutcome(r: {
  candidates: ReadonlyArray<{ cardId: string | null }>;
  confidence: number;
  tied?: boolean;
}): ScanOutcome {
  if (!r.candidates[0] || r.confidence < MIN_MATCH_CONF) return "nomatch";
  // ⚠️ Kräver ≥2 olika KORT: tryckningar av samma kort är inget val mellan kort.
  if (r.tied && new Set(r.candidates.map((c) => c.cardId)).size >= 2) return "choose";
  return "matched";
}

/** Räknas skanningen mot månadskvoten / enhetens tak? Bara en levererad träff. */
export function scanCountsAgainstQuota(r: Parameters<typeof scanOutcome>[0]): boolean {
  return scanOutcome(r) === "matched";
}
