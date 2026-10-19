/**
 * PRO-PLANERNA (ägarbeslut 2026-10-19) — ett ställe för talen, ren modul.
 *
 *   • Månadsvis: 59 kr/mån, ingen bindning. Befintliga prenumeranter behåller sitt
 *     gamla pris (49 kr) — App Store, Play och Stripe låter det gamla priset ligga
 *     kvar på de prenumerationer som redan finns.
 *   • 12 månader: 39 kr/mån i 12 månader (468 kr) med 14 dagar gratis.
 *       – iPhone: Apples "månadsvis med 12 månaders åtagande" (förnyas till ett nytt
 *         åtagande, Apples regel). Äldre iOS/appbyggen får årsplanen förbetald.
 *       – Android: förbetalt 468 kr/år — Play har ingen avbetalning i Sverige
 *         (bara BR/FR/IT/ES, oktober 2026).
 *       – Webben: Stripe 39 kr/mån; bindningen upprätthåller VI (stripe-webhooken
 *         flyttar en uppsägning till bindningstidens slut). Efter 12 månader löper
 *         webbplanen vidare månadsvis à 39 kr utan ny bindning — en automatisk ny
 *         bindning är ett riskabelt avtalsvillkor mot konsument.
 *
 * ⛔ TALEN ÄR PUBLICERADE som fri text i sv.json/en.json (villkor, prissida, arket,
 * mejl). `tests/unit/pro-plans-copy-sync.test.ts` failar om de glider isär — lös det
 * aldrig genom att interpolera konstanterna: någon ska TVINGAS läsa meningarna.
 */

export const PRO_MONTHLY_ORE = 5_900;
export const PRO_COMMIT_MONTHLY_ORE = 3_900;
export const PRO_COMMIT_MONTHS = 12;
export const PRO_COMMIT_TOTAL_ORE = PRO_COMMIT_MONTHLY_ORE * PRO_COMMIT_MONTHS;

/** Provperioden. Bara 12-månadersplanen har en. */
export const PRO_TRIAL_DAYS = 14;
/**
 * Påminnelsen går ut så här många SVENSKA KALENDERDAGAR före provperiodens sista
 * dag (dag 12 av 14). ⛔ Inte senare: Apple drar förnyelsen upp till 24 h före
 * periodens slut, och en påminnelse som landar efter det ger kunden ingen chans att
 * säga nej — det blir återbetalningskrav och dåliga betyg, inte fler kunder.
 */
export const TRIAL_REMINDER_DAYS_BEFORE = 2;
/** Värdebeskedet (push, ingen prislapp) går ut den här dagen i provperioden. */
export const TRIAL_VALUE_DAY = 7;

export type ProPlanChoice = "year" | "month";

/** "59 kr" — heltalskronor med svenskt mellanrum ("1 299 kr"). */
export function formatKr(ore: number): string {
  return `${Math.round(ore / 100).toLocaleString("sv-SE").replace(/ /g, " ")} kr`;
}
