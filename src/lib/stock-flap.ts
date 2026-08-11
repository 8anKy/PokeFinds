/**
 * FLAPP-DÄMPNING — ren dom, ingen DB.
 *
 * Flyttad hit ur `services/alerts.ts` 2026-08-11 när Discord-snabbfilen
 * (scripts/discord-restock-run.ts) behövde SAMMA regel utan att kunna läsa
 * RestockEvent: den lanen är DB-fri med flit och håller sin egen övergångs-
 * historik i Actions-cachen. ⛔ Kopiera aldrig reglerna dit i stället — glider
 * de isär blir felet tyst och asymmetriskt (en lane spammar, den andra tiger),
 * och det tar dygn att se. `services/alerts.ts` re-exporterar härifrån, så alla
 * befintliga importvägar är oförändrade.
 *
 * BAKGRUND (2026-07-26). En butik som pytsar ut en het vara växlar
 * "i lager"/"slut" om vartannat: Dragon's Lair togglade Pitch Black ETB och
 * Booster Box 28 respektive 45 gånger på tre dygn (uppmätt i feeden — både
 * kollektions-JSON och produktens egen `.js` sa samma sak, så det är butikens
 * riktiga lager som studsar, inte vår sampling). Enda skyddet var 2h-cooldownen
 * → ett mejl varannan timme, dygnet runt, för samma produkt.
 *
 * Två regler, båda mätta mot HELA restock-historiken (21 dgr, 470 händelser)
 * innan de skeppades — inte gissade:
 *
 *   A. BLINK: är produkten tillbaka i det tillstånd den nyss lämnade, inom
 *      `minAwayMinutes`, har den aldrig varit borta på riktigt. Inget larm.
 *   B. FLAPP: har paret (produkt, butik) fler än `flapMaxTransitions`
 *      lagerövergångar det senaste dygnet är butiken i droppläge → cooldownen
 *      förlängs till `flapCooldownHours` (ett besked per dygn i stället för
 *      ett varannan timme). Tystar INTE helt: att en het vara trillar in med
 *      jämna mellanrum är i sig information värd ett larm om dagen.
 *
 * Utfall på facit: 177 → 147 larmtillfällen totalt, och de värsta paren faller
 * från 12/6 till 7/3. Två par tappar sitt enda larm helt — båda var 30-minuters
 * blinkar (produkten lämnade aldrig hyllan). Ingen produkt med en ÄKTA
 * påfyllning (borta > 1 h) blir tyst.
 */
import type { StockStatus } from "@prisma/client";

export const FLAP_WINDOW_HOURS = 24;

export interface FlapPolicy {
  minAwayMinutes: number;
  flapMaxTransitions: number;
  flapCooldownHours: number;
}

export function flapPolicy(): FlapPolicy {
  return {
    // 20, inte 60 (ägarbeslut 2026-08-10): 60-minutersblinken åt ett ÄKTA larm — TCG
    // Stores Prismatic-bundle såldes slut 06:43 och fylldes på 07:13 (borta 30 min),
    // och för heta släpp är just den snabba påfyllningen det man bevakar. 21-dygns-
    // facitet från 07-26 mättes med 60; priset för 20 är fler mejl från studsiga
    // butiker (DL). Defaulten bor HÄR (en definition för Actions + Railway) —
    // env-variabeln är kvar som nödventil, inte som produktbeslut.
    minAwayMinutes: Number(process.env.RESTOCK_MIN_AWAY_MINUTES ?? 20),
    flapMaxTransitions: Number(process.env.RESTOCK_FLAP_MAX_TRANSITIONS ?? 6),
    flapCooldownHours: Number(process.env.RESTOCK_FLAP_COOLDOWN_HOURS ?? 24),
  };
}

/**
 * Ren dom över `recent` = lagerövergångarna (RestockEvent) för EN produkt hos EN
 * butik, nyast först. Filtrerar själv till dygnsfönstret så den inte är beroende
 * av att anroparens fråga råkar ha rätt `gte`.
 *
 * Övergången som just larmar ingår i `recent` (runner skriver händelsen FÖRE
 * larmet, med flit — se ordningskommentaren i runRestockScan). Den kan aldrig
 * matcha blink-regeln själv: dess `oldStatus` är det tillstånd vi lämnade, inte
 * det vi återvänder till.
 */
export function evaluateStockFlap(
  recent: { oldStatus: StockStatus; detectedAt: Date }[],
  toStatus: StockStatus | null,
  now: Date,
  policy: FlapPolicy
): { blip: boolean; cooldownHours: number } {
  const windowStart = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  const inWindow = recent.filter((e) => e.detectedAt.getTime() >= windowStart);

  // A: senaste gången produkten LÄMNADE tillståndet den nu återvänder till.
  const left = toStatus == null ? undefined : inWindow.find((e) => e.oldStatus === toStatus);
  const blip =
    policy.minAwayMinutes > 0 &&
    left != null &&
    now.getTime() - left.detectedAt.getTime() < policy.minAwayMinutes * 60_000;

  const flapping =
    policy.flapMaxTransitions > 0 && inWindow.length > policy.flapMaxTransitions;
  return { blip, cooldownHours: flapping ? policy.flapCooldownHours : 0 };
}
