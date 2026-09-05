/**
 * SVEP-NER-FÖR-ATT-STÄNGA — den rena domen.
 *
 * Ligger här, skild från effekten, av EXAKT samma skäl som `evaluateStockFlap`:
 * regeln har felat i fält TVÅ gånger och båda gångerna var symtomet "det
 * fungerar ibland", vilket är det svåraste av alla att felsöka. En ren funktion
 * går att testa utan WebView, utan finger och utan gissningar.
 *
 * DE TVÅ HAVERIERNA, för den som frestas ändra trösklarna:
 *
 * 1. (2026-08-04, morgon) Draget låg på POINTER-events med pointer-capture.
 *    Studsvakten i `pwa-register.tsx` `preventDefault`:ar varje nedåtdrag när
 *    `scrollY === 0` — och skannern ligger `fixed inset-0`, så scrollY är alltid
 *    0. I WebKit avbryter det HELA pointer-strömmen (`pointercancel`), som koden
 *    läste som "fingret släppte" → glid tillbaka + död gest.
 *
 * 2. (2026-08-04, kväll) Omskrivet på touch-events, men axeln låstes vid 8 px.
 *    Ett SNABBT svep hinner 8 px i den första touchmove-händelsen och vann;
 *    ett LÅNGSAMT levererar 1–2 px per ruta, så webbläsarens egen scrolltröskel
 *    (~5 px) passerades först, den tog gesten och skickade `touchcancel`. Samma
 *    symtom, en nivå ner.
 *
 * ⛔ DÄRAV: `DIRECTION_PX` MÅSTE ligga under webbläsarens tröskel. Höjs den
 * tillbaka mot 8 px återuppstår bugg 2 — och den syns bara för den som sveper
 * långsamt, alltså inte för den som testar snabbt.
 */

/** Riktningen läses här. Under webbläsarens scrolltröskel (~5 px), med marginal. */
export const DIRECTION_PX = 3;
/** Sträcka som ensam stänger. */
export const CLOSE_PX = 100;
/** Kast: px/ms nedåt. */
export const FLICK_V = 0.45;
/** … men aldrig från stillastående — någon sträcka krävs alltid. */
export const FLICK_PX = 32;
/**
 * Började gesten i KANDIDATRADEN (sidledsscroller) måste lodrätt dominera så
 * här mycket över vågrätt för att draget ska bli vårt. Raden bläddrar i
 * sidled och en tumme drar sällan rakt — hellre att ett snett drag bläddrar
 * bland korten än att arket stängs mitt i valet.
 */
export const RAIL_VERTICAL_RATIO = 2;

export type DragDecision =
  /** För litet för att läsa riktning — vänta på nästa ruta. */
  | "wait"
  /** Nedåt: vi äger gesten och ska blockera native scroll. */
  | "own"
  /** Vågrätt eller uppåt: webbläsarens gest. Släpp den, ta den ALDRIG tillbaka. */
  | "release";

/**
 * Riktningsbeslutet, taget en gång per gest.
 *
 * `fromHandle` = gesten började på draghandtaget, som varken scrollar eller kan
 * panorera. Där finns ingen konkurrerande gest att lämna ifrån sig, så ett drag
 * uppåt är fortfarande vårt (det ger bara noll förflyttning). I KROPPEN är ett
 * drag uppåt däremot en vanlig scroll och måste släppas.
 *
 * `fromRail` = gesten började i kandidatraden. Förut var en sådan gest ALDRIG
 * vår (uteslöts vid touchstart), men raden täcker mitten av arket, så i praktiken
 * gick arket bara att svepa ner från handtaget och bildparet (ägaren 2026-09-05:
 * "swipe it down from the middle also"). Nu är den vår om den är tydligt lodrätt
 * nedåt — `RAIL_VERTICAL_RATIO` — annars radens.
 */
export function classifyDrag(
  ddx: number,
  ddy: number,
  fromHandle: boolean,
  fromRail = false
): DragDecision {
  if (Math.abs(ddx) < DIRECTION_PX && Math.abs(ddy) < DIRECTION_PX) return "wait";
  // Vågrätt är alltid någon annans — i praktiken kandidatraden.
  if (Math.abs(ddx) > Math.abs(ddy)) return "release";
  if (!fromHandle && ddy <= 0) return "release";
  if (fromRail && Math.abs(ddy) < RAIL_VERTICAL_RATIO * Math.abs(ddx)) return "release";
  return "own";
}

/**
 * Stänger arket vid släpp?
 *
 * STRÄCKA **ELLER** FART. Ett kort, snabbt kast är en lika tydlig avsikt som ett
 * långt lugnt drag, och att bara mäta sträcka gjorde den snabba gesten omöjlig.
 * Farten ensam räcker aldrig: `FLICK_PX` hindrar att en darrning vid pekytan
 * läses som ett kast.
 */
export function shouldCloseSheet(dy: number, vy: number): boolean {
  return dy > CLOSE_PX || (vy > FLICK_V && dy > FLICK_PX);
}
