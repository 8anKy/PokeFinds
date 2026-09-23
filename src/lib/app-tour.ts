/**
 * APPENS GUIDADE TUR (ägarbeslut 2026-09-23): markerar riktiga knappar en i taget
 * och ANVÄNDAREN TRYCKER själv för att gå vidare — ett bildspel lär inte ut vägen
 * genom appen, att själv ha tryckt på den gör det. "Hoppa över" finns i varje steg.
 *
 * Ren data + rena funktioner här; `components/features/app-tour.tsx` ritar.
 *
 * ⛔ MÅLEN ÄR `data-tour`-ATTRIBUT, ALDRIG KLASSER. En Tailwind-klasskedja byts vid
 *    nästa designändring och turen pekar då på ingenting, tyst. Ett attribut som
 *    heter vad det är står kvar. Byter ett mål komponent: flytta attributet med.
 * ⛔ BARA MOBIL (bottenflikarna). Desktop har en annan meny och skulle behöva egna mål.
 * ⛔ SKANNA ÄR SISTA STEGET MED FLIT: sidan startar kameran och ber om tillstånd.
 *    Mitt i turen hade det avbrutit den; som sista tryck ÄR det turens slut.
 * ⛔ Bevaka-steget kräver aldrig ett tryck — knappen skapar en RIKTIG bevakning
 *    (och öppnar arket för gratiskontot). Man får trycka, men "Nästa" räcker.
 */

export type TourAdvance =
  /** Bara "Nästa" — trycket på målet är frivilligt (och gör sin vanliga sak). */
  | { kind: "next" }
  /** Användaren trycker på målet: produktvyn öppnas (overlay på mobil, sida annars). */
  | { kind: "product-open" }
  /** Användaren trycker på målet: rutten byts till `path`. */
  | { kind: "route"; path: string };

export interface TourStep {
  id: string;
  /** `data-tour`-värdet. Första SYNLIGA träffen används (mobil och desktop renderar båda). */
  target: string;
  /** Nyckel i `Tour`-namnrymden (`<key>Title` + `<key>Body`). */
  copy: string;
  advance: TourAdvance;
  /**
   * Gäster kan inte gå dit (skyddad rutt ⇒ inloggningen): för dem blir steget
   * "Nästa" och målet går inte att trycka på, så turen inte slutar på en inloggningssida.
   */
  guestInfoOnly?: boolean;
  /** Gästens egen text, när steget lovar något kontot krävs för. */
  guestCopy?: string;
  /**
   * Hur länge målet får dröja innan steget hoppas över (ms). Default 4 s. Bevaka-knappen
   * finns först när produktvyn HÄMTAT produkten — på ett långsamt mobilnät tar det tid.
   */
  waitMs?: number;
}

export const TOUR_STEPS: TourStep[] = [
  { id: "search", target: "explore-search", copy: "search", advance: { kind: "next" } },
  { id: "product", target: "product-card", copy: "product", advance: { kind: "product-open" } },
  {
    id: "watch",
    target: "watch-button",
    copy: "watch",
    guestCopy: "watchGuest",
    advance: { kind: "next" },
    waitMs: 10_000,
  },
  {
    id: "portfolio",
    target: "tab-portfolio",
    copy: "portfolio",
    advance: { kind: "route", path: "/samling" },
    guestInfoOnly: true,
  },
  { id: "scan", target: "tab-scan", copy: "scan", advance: { kind: "route", path: "/skanna" } },
];

/** Sidan turen startar på (första besöket). */
export const TOUR_START_PATH = "/produkter";
/** `/produkter?guide=1` startar om turen — länken i Mer. */
export const TOUR_RESTART_PARAM = "guide";

const SEEN_KEY = "foilio:app-tour:v1";

/** Har enheten sett (eller hoppat över) turen? Fel-säkert: kastar lagringen ⇒ "sett". */
export function appTourSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markAppTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Privat läge — turen kan visas igen nästa gång, vilket är ofarligt.
  }
}

/** Är `pathname` (utan språkprefix) den väg steget väntar på? */
export function routeReached(advance: TourAdvance, pathname: string | null | undefined): boolean {
  if (advance.kind !== "route" || !pathname) return false;
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return p === advance.path || p.startsWith(`${advance.path}/`);
}

/** Är `pathname` en egen produktsida (desktopvägen — mobilen öppnar en overlay)? */
export function isProductPage(pathname: string | null | undefined): boolean {
  return !!pathname && /^\/produkter\/[^/]+\/?$/.test(pathname);
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Var bubblan ska stå: under målet om det ligger i skärmens övre halva, annars
 * ovanför. Horisontellt centrerad på målet men klämd innanför kanterna.
 */
export function bubblePlacement(
  target: Rect,
  viewport: { width: number; height: number },
  bubble: { width: number; height: number },
  gap = 14,
  gutter = 16
): { top: number; left: number; side: "above" | "below"; arrowLeft: number } {
  const below = target.top + target.height / 2 < viewport.height / 2;
  const top = below ? target.top + target.height + gap : target.top - gap - bubble.height;
  const centre = target.left + target.width / 2;
  const maxLeft = Math.max(gutter, viewport.width - gutter - bubble.width);
  const left = Math.min(maxLeft, Math.max(gutter, centre - bubble.width / 2));
  const arrowLeft = Math.min(bubble.width - 20, Math.max(20, centre - left));
  return { top, left, side: below ? "below" : "above", arrowLeft };
}
