/**
 * Skannern → /gradera (2026-10-01): skanningens foto blir graderingens framsida.
 *
 * Bilden bärs i sessionStorage (en JPEG-data-URL på ~100–400 kB, långt under
 * webbläsarens ~5 MB) i stället för i URL:en, och läses EN gång — nyckeln tas
 * bort direkt så en omladdning av /gradera inte fyller i ett gammalt kort.
 */
export const GRADE_PREFILL_KEY = "foilio:grade-prefill:v1";

export interface GradePrefill {
  /** Skanningens utsnitt av kortet (data-URL). */
  front: string;
  /** "Charizard ex 199" — samma form som graderingens kortnamnshint. */
  cardName: string | null;
  /** Katalogens setnamn — avgör e-Reader-läget i centreringsmätaren. */
  setName: string | null;
  /** Katalogkortet skannern identifierade — graderingen kopplas till det (bilden). */
  cardId: string | null;
}

export function writeGradePrefill(p: GradePrefill): boolean {
  try {
    sessionStorage.setItem(GRADE_PREFILL_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function takeGradePrefill(): GradePrefill | null {
  try {
    const raw = sessionStorage.getItem(GRADE_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(GRADE_PREFILL_KEY);
    const p = JSON.parse(raw) as Partial<GradePrefill>;
    if (typeof p.front !== "string" || !p.front.startsWith("data:image/")) return null;
    return {
      front: p.front,
      cardName: typeof p.cardName === "string" ? p.cardName : null,
      setName: typeof p.setName === "string" ? p.setName : null,
      cardId: typeof p.cardId === "string" ? p.cardId : null,
    };
  } catch {
    return null;
  }
}
