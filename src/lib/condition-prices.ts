/**
 * PRIS PER SKICK — PROCENT AV CARDMARKETS NEAR MINT (ägarbeslut 2026-10-26).
 *
 * Inget skick utom NM har ett eget Cardmarket-pris hos leverantören, och det finns ingen
 * officiell branschstandard (varken Cardmarket eller TCGplayer publicerar procent). Talen
 * nedan är MÄTTA: median av lägsta CardTrader-annons per skick / samma korts NM-golv över
 * ~10 000 engelska kort (2026-10-26, `scripts/condition-ratio-report.ts`), i två värdeband — dyra kort
 * tappar mer i sämre skick. Good saknar motsvarighet hos CardTrader och ligger mitt
 * emellan Excellent och Light Played. Visas alltid märkt som en UPPSKATTNING.
 *
 * ⛔ En tabell för ALLA kort: CardTraders egna skickpriser visas inte längre — deras
 *    annonser ligger ~3–4x över Cardmarket, och två metoder sida vid sida gav hopp.
 *    Golven skrivs fortfarande nattligen (de är underlaget när procenten mäts om).
 * ⛔ Mät om kvartalsvis och visa ägaren nya tal FÖRE ändring.
 * ⛔ Talen rör ALDRIG rubrikpris, "Lägst", statistik eller larm.
 *
 * CARDTRADER-GOLVEN (underlaget): CT:s Pokémon-annonser bär Near Mint, Slightly Played,
 * Moderately Played, Played, Poor. Slightly → EXCELLENT, Moderately → LIGHT_PLAYED.
 * Talen är tunna och inte monotona ⇒ minst två annonser per golv.
 *
 * REN MODUL — ingen Prisma, inget nätverk.
 */
import type { CtListing } from "./cardtrader";

/** Skicken som kan ha ett pris, bäst först (samma nycklar som `CardCondition`). */
export const PRICED_CONDITIONS = ["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "LIGHT_PLAYED", "PLAYED", "POOR"] as const;
export type PricedCondition = (typeof PRICED_CONDITIONS)[number];

/** CardTraders skicknamn → vårt. Ett namn utanför tabellen räknas inte alls. */
export const CT_CONDITION_MAP: Readonly<Record<string, PricedCondition>> = {
  Mint: "MINT",
  "Near Mint": "NEAR_MINT",
  "Slightly Played": "EXCELLENT",
  "Moderately Played": "LIGHT_PLAYED",
  Played: "PLAYED",
  Poor: "POOR",
};

/** Minst så många annonser bakom ett publicerat golv — samma som `CT_MIN_DEPTH`. */
export const CONDITION_MIN_DEPTH = 2;
/** Äldre än så ⇒ visas inte (passet roterar, ett set som slutat matcha får inte stå kvar). */
export const CONDITION_MAX_AGE_DAYS = 14;

export interface ConditionFloor {
  /** Lägsta annonsen i öre (nattens kurs). */
  ore: number;
  /** Antal annonser golvet valdes ur. */
  n: number;
}
export type ConditionPrices = Partial<Record<PricedCondition, ConditionFloor>>;

export interface Printing {
  reverse: boolean;
  firstEdition: boolean;
}

/**
 * Får annonsen räknas för tryckningen? Samma köpbarhetskrav som `isBuyableNmListing`
 * utom skicket. ⛔ Strikt på tryckningen: `pokemon_reverse` saknas = inte reverse.
 */
export function isConditionListing(l: CtListing, printing: Printing): boolean {
  const p = l.properties_hash ?? {};
  return (
    p.pokemon_language === "en" &&
    typeof p.condition === "string" &&
    p.condition in CT_CONDITION_MAP &&
    (p.pokemon_reverse === true) === printing.reverse &&
    (p.first_edition === true) === printing.firstEdition &&
    l.graded !== true &&
    p.signed !== true &&
    p.altered !== true &&
    p.sealed !== true &&
    l.on_vacation !== true &&
    (l.quantity ?? 0) > 0 &&
    l.price?.currency === "EUR" &&
    Number.isFinite(l.price?.cents) &&
    l.price.cents > 0
  );
}

/** Lägsta annons per skick för tryckningen, bara skick med `minDepth` annonser. */
export function conditionFloors(
  listings: CtListing[] | undefined,
  printing: Printing,
  eurToOre: number,
  minDepth = CONDITION_MIN_DEPTH
): ConditionPrices {
  const acc = new Map<PricedCondition, { cents: number; n: number }>();
  for (const l of listings ?? []) {
    if (!isConditionListing(l, printing)) continue;
    const c = CT_CONDITION_MAP[l.properties_hash.condition as string];
    const cur = acc.get(c);
    if (!cur) acc.set(c, { cents: l.price.cents, n: 1 });
    else {
      cur.n++;
      if (l.price.cents < cur.cents) cur.cents = l.price.cents;
    }
  }
  const out: ConditionPrices = {};
  for (const c of PRICED_CONDITIONS) {
    const v = acc.get(c);
    if (!v || v.n < minDepth) continue;
    const ore = Math.round((v.cents / 100) * eurToOre);
    if (ore > 0) out[c] = { ore, n: v.n };
  }
  return out;
}

/** Läser det lagrade JSON-värdet defensivt — skräp ger tomt, aldrig ett kast. */
export function parseConditionPrices(raw: unknown): ConditionPrices {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ConditionPrices = {};
  for (const c of PRICED_CONDITIONS) {
    const v = (raw as Record<string, unknown>)[c] as { ore?: unknown; n?: unknown } | undefined;
    if (!v || typeof v !== "object") continue;
    const ore = Number(v.ore);
    const n = Number(v.n);
    if (Number.isInteger(ore) && ore > 0 && Number.isInteger(n) && n > 0) out[c] = { ore, n };
  }
  return out;
}

/**
 * Andel av NM per skick, i procent. Gränsen går vid NM-priset 100 kr: under den är
 * annonserna billiga och avdragen mindre, över den tappar ett slitet kort mer.
 */
export const CONDITION_PERCENT_BAND_ORE = 10_000;
export const CONDITION_PERCENT: Readonly<Record<"low" | "high", Readonly<Record<PricedCondition, number>>>> = {
  low: { MINT: 100, NEAR_MINT: 100, EXCELLENT: 95, GOOD: 80, LIGHT_PLAYED: 63, PLAYED: 44, POOR: 33 },
  high: { MINT: 100, NEAR_MINT: 100, EXCELLENT: 92, GOOD: 75, LIGHT_PLAYED: 57, PLAYED: 38, POOR: 25 },
};

export function conditionPercent(condition: PricedCondition, nmOre: number): number {
  return CONDITION_PERCENT[nmOre >= CONDITION_PERCENT_BAND_ORE ? "high" : "low"][condition];
}

export interface ConditionPriceRow {
  condition: PricedCondition;
  /** Öre, eller null = "–" (inget NM-pris att räkna från). */
  ore: number | null;
  /** Procent av NM bakom talet (100 för NM). */
  percent: number;
  /** "headline" = produktens rubrikpris (NM), "estimate" = procent av NM. */
  source: "headline" | "estimate" | null;
}

export interface ConditionPriceTable {
  rows: ConditionPriceRow[];
}

function isPricedCondition(c: string): c is PricedCondition {
  return (PRICED_CONDITIONS as readonly string[]).includes(c);
}

function rowFor(condition: PricedCondition, nmOre: number | null): ConditionPriceRow {
  if (nmOre == null || !(nmOre > 0)) return { condition, ore: null, percent: 0, source: null };
  if (condition === "NEAR_MINT") return { condition, ore: nmOre, percent: 100, source: "headline" };
  const percent = conditionPercent(condition, nmOre);
  return { condition, ore: Math.round((nmOre * percent) / 100), percent, source: "estimate" };
}

/** Tabellen för ett kort med NM-pris (rubriken). Inget NM-pris ⇒ null. */
export function conditionPriceTable(nmHeadlineOre: number | null): ConditionPriceTable | null {
  if (nmHeadlineOre == null || !(nmHeadlineOre > 0)) return null;
  return { rows: PRICED_CONDITIONS.map((c) => rowFor(c, nmHeadlineOre)) };
}

/**
 * Priset för ett valt skick. Tabellen om den finns, annars räknat ur rubriken (äldre
 * cachade payloads bär fortfarande CardTrader-formen eller ingen tabell alls).
 */
export function priceForCondition(
  table: ConditionPriceTable | null,
  condition: string,
  headlineOre: number | null = null
): ConditionPriceRow {
  const c: PricedCondition = isPricedCondition(condition) ? condition : "NEAR_MINT";
  const row = table?.rows.find((r) => r.condition === c);
  if (row && (row.source === "headline" || row.source === "estimate")) return row;
  const nm = table?.rows.find((r) => r.condition === "NEAR_MINT" && r.source === "headline")?.ore ?? headlineOre;
  return rowFor(c, nm);
}
