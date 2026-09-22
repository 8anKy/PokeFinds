/**
 * SKANNINGSSESSIONENS SPRÅK (2026-09-22).
 *
 * Samma kort på engelska och japanska har samma konst — bilden kan inte skilja
 * dem, så servern behöver en ledtråd. MÄTT (508 domar där rätt kort hade en
 * språktvilling i bildens topp-5): "samma språk som användarens förra val
 * (< 30 min)" gav rätt språk i 92,3 % mot 79,5 % för "EN vinner". En session
 * är nästan alltid ett språk — man går igenom EN pärm i taget.
 *
 * Ledtråden är användarens EGNA val (ett val ur listan eller ett tillägg till
 * samlingen), aldrig skannerns gissning — annars förstärker en EN-gissning sig
 * själv. Lagras i sessionStorage så den överlever en omladdning men inte dagen;
 * ⛔ varje läsning/skrivning i try/catch (privat läge, blockerad lagring).
 */

export type ScanLanguageHint = "EN" | "JP";

export const LANG_HINT_TTL_MS = 30 * 60_000;
const KEY = "foilio:scan-lang:v1";

/** Ren tolkning av det lagrade värdet — testad utan webbläsare. */
export function parseLangHint(raw: string | null, now: number): ScanLanguageHint | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { lang?: unknown; at?: unknown };
    if ((v.lang !== "EN" && v.lang !== "JP") || typeof v.at !== "number") return undefined;
    if (now - v.at > LANG_HINT_TTL_MS || v.at > now + 60_000) return undefined;
    return v.lang;
  } catch {
    return undefined;
  }
}

export function readLangHint(now = Date.now()): ScanLanguageHint | undefined {
  try {
    return parseLangHint(window.sessionStorage.getItem(KEY), now);
  } catch {
    return undefined;
  }
}

/** Bara EN/JP bär en tvillingfråga; andra språk lämnar ledtråden orörd. */
export function rememberLangHint(language: string | null | undefined, now = Date.now()): void {
  if (language !== "EN" && language !== "JP") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ lang: language, at: now }));
  } catch {
    // Lagringen är blockerad — skannern fungerar som förut, utan ledtråd.
  }
}
