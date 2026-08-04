/**
 * FOLIE-INSTRUMENTERING, serversidan — avkodar klientens sonder, hämtar kortets
 * referensavtryck och räknar de tre måtten. Den VÄLJER INGENTING och påverkar
 * varken kandidater, poäng eller pris; utfallet hamnar bara i ADMIN-
 * diagnostiken (`ScannerJob.result.foil`) så frågan "kan skannern välja variant
 * själv?" kan besvaras med mätdata. Se src/lib/foil-probe.ts för varför.
 *
 * Kostnad: noll AI-anrop, ingen ny tjänst, inga extra DB-rader. Referensen
 * plockas ur konstindexet som redan ligger i processminnet.
 */
import { FINGERPRINT_BYTES } from "@/lib/art-fingerprint";
import { PROBE_BYTES, foilMetrics, type FoilMetrics } from "@/lib/foil-probe";
import { getCardColorFingerprint } from "./art-index";

function decode(b64: string | undefined, expected: number): Buffer | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    // Fel längd = annan rutnätsversion eller trasig klient. Hellre ingen signal
    // än en jämförelse mellan vektorer av olika längd (som "fungerar" men inte
    // betyder något) — samma regel som decodeFingerprint.
    return buf.length === expected ? buf : null;
  } catch {
    return null;
  }
}

export type FoilDiagnostics = FoilMetrics & {
  /** Rå sond för den fångade rutan (base64) — så måtten kan räknas om senare
   *  utan att ägaren behöver skanna om samma kort. */
  probe: string | null;
  /** Live-pollens sonder, äldst först. */
  history: string[];
  /** Kortet måtten räknades mot; null = ingen träff eller inget referensavtryck. */
  cardId: string | null;
}

/**
 * Bygger folie-diagnostiken för en skanning.
 *
 * `queryFingerprint` ska vara FÖRSTA rutans FÖRSTA avtryck (inset 0), dvs exakt
 * den yta sonden räknades på — annars jämförs olika beskärningar och kvoten
 * mäter beskärningen i stället för folien.
 */
export async function buildFoilDiagnostics(input: {
  probe?: string;
  history?: string[];
  queryFingerprint?: string;
  cardId?: string | null;
}): Promise<FoilDiagnostics | null> {
  const probeBuf = decode(input.probe, PROBE_BYTES);
  const history = (input.history ?? []).slice(0, 5);
  const historyBufs = history
    .map((h) => decode(h, PROBE_BYTES))
    .filter((b): b is Buffer => b !== null)
    .map((b) => new Uint8Array(b));
  if (!probeBuf && historyBufs.length === 0) return null;

  const queryBuf = decode(input.queryFingerprint, FINGERPRINT_BYTES);
  const cardId = input.cardId ?? null;
  const reference = cardId ? await getCardColorFingerprint(cardId) : null;

  return {
    ...foilMetrics({
      probe: probeBuf ? new Uint8Array(probeBuf) : null,
      history: historyBufs,
      queryFingerprint: queryBuf
        ? new Int8Array(queryBuf.buffer, queryBuf.byteOffset, queryBuf.length)
        : null,
      referenceFingerprint: reference,
    }),
    probe: input.probe ?? null,
    history,
    cardId: reference ? cardId : null,
  };
}
