/**
 * GRADERINGSTUREN (2026-10-04, ägarönskan: "folk hittar inte hur centreringen
 * används"). Fem INFO-steg över /gradera som markerar riktiga delar av sidan —
 * ingen data skapas, "Nästa" går vidare. Visas en gång per enhet, första gången
 * sidan öppnas; "?" i sidhuvudet startar den igen.
 *
 * ⛔ Målen är `data-tour`-attribut (se lib/app-tour.ts). Flyttas en del av sidan:
 *    flytta attributet med. Ett mål som saknas hoppas över (spotlight.tsx).
 * ⛔ INGEN DB: tillståndet är en localStorage-nyckel.
 */

export interface GradingTourStep {
  /** `data-tour`-värdet. */
  target: string;
  /** Nyckel i `GradingTour`-namnrymden (`<key>Title` + `<key>Body`). */
  copy: string;
}

export const GRADING_TOUR_STEPS: GradingTourStep[] = [
  { target: "grading-front", copy: "front" },
  { target: "grading-back", copy: "back" },
  { target: "grading-centering", copy: "centering" },
  { target: "grading-grade", copy: "grade" },
  { target: "grading-history", copy: "history" },
];

const SEEN_KEY = "foilio:grading-tour:v1";

/** Fel-säkert: kastar lagringen ⇒ "sett" (ingen tur som dyker upp varje gång). */
export function gradingTourSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markGradingTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Privat läge — turen kan visas igen, vilket är ofarligt.
  }
}
