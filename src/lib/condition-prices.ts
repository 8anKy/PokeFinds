/**
 * PRIS PER SKICK (2026-10-23, ägaren: "konkurrenten visar priser per skick — gör det").
 *
 * KÄLLAN ÄR CARDTRADERS ANNONSER, ALDRIG EN MULTIPLIKATOR. Cardmarket-leverantören ger
 * bara NM-golvet (`lowest_near_mint`), och en tabell "Played = 60 % av NM" vore ett
 * påhittat pris (CLAUDE.md: inga fabricerade priser). CardTraders marknadsplats bär
 * skicket PÅ ANNONSEN, så lägsta engelska annons per skick är ett verkligt tal.
 *
 * MÄTT 2026-10-23 (Paldea Evolved / Secret Wonders / Unseen Forces): CT:s Pokémon-
 * annonser bär exakt fem skick — Near Mint, Slightly Played, Moderately Played, Played,
 * Poor (+ "Mint" i teorin). De går 1:1 på vår `CardCondition`:
 *   Slightly Played → EXCELLENT · Moderately Played → GOOD · Played → PLAYED · Poor → POOR.
 * Talen är TUNNA och INTE monotona (Charizard SW 3: SP 150,64 € över NM 40,52 € med EN
 * NM-annons) — därför samma djupkrav som varje annat publicerat CT-golv (`CT_MIN_DEPTH`):
 * minst två annonser, annars "–". Vi jämnar aldrig ut och interpolerar aldrig.
 *
 * ⛔ NM-RADEN ÄGS AV RUBRIKEN (Cardmarket, eller den källa produktens rubrik har) —
 *    CardTraders NM-golv lagras men visas inte som NM-pris.
 * ⛔ Talen rör ALDRIG rubrikpris, "Lägst", statistik, larm eller samlingsvärde: det är en
 *    annan marknadsplats (median ~3,7x dyrare än CM, mätt i cardtrader-reverse).
 *
 * REN MODUL — ingen Prisma, inget nätverk. Skrivs nattligen av reverse-passet
 * (`jobs/cardtrader-condition-prices.ts`), läses ur detail-payloaden.
 */
import type { CtListing } from "./cardtrader";

/** Skicken som kan ha ett pris, bäst först (samma nycklar som `CardCondition`). */
export const PRICED_CONDITIONS = ["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "PLAYED", "POOR"] as const;
export type PricedCondition = (typeof PRICED_CONDITIONS)[number];

/** CardTraders skicknamn → vårt. Ett namn utanför tabellen räknas inte alls. */
export const CT_CONDITION_MAP: Readonly<Record<string, PricedCondition>> = {
  Mint: "MINT",
  "Near Mint": "NEAR_MINT",
  "Slightly Played": "EXCELLENT",
  "Moderately Played": "GOOD",
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

export interface ConditionPriceRow {
  condition: PricedCondition;
  /** Öre, eller null = "–". */
  ore: number | null;
  /** Antal CardTrader-annonser bakom talet (0 för rubrikraden). */
  n: number;
  /** "headline" = produktens rubrikpris (NM), "cardtrader" = lägsta CT-annons. */
  source: "headline" | "cardtrader" | null;
}

export interface ConditionPriceTable {
  rows: ConditionPriceRow[];
  /** När CT-talen skrevs (ISO), null om inga CT-tal visas. */
  at: string | null;
}

/**
 * Tabellen arket visar. NM = rubrikpriset (aldrig CardTraders NM-golv); övriga skick ur
 * CardTrader om färska nog. Inga CT-tal alls ⇒ null (arket visar då bara skickvalet).
 */
export function conditionPriceTable(
  raw: unknown,
  at: string | Date | null | undefined,
  nmHeadlineOre: number | null,
  now: Date = new Date()
): ConditionPriceTable | null {
  const atMs = at ? new Date(at).getTime() : NaN;
  const fresh = Number.isFinite(atMs) && now.getTime() - atMs <= CONDITION_MAX_AGE_DAYS * 86_400_000;
  const ct = fresh ? parseConditionPrices(raw) : {};
  const hasCt = PRICED_CONDITIONS.some((c) => c !== "NEAR_MINT" && ct[c]);
  if (!hasCt) return null;
  return {
    at: new Date(atMs).toISOString(),
    rows: PRICED_CONDITIONS.map((condition): ConditionPriceRow => {
      if (condition === "NEAR_MINT") {
        return nmHeadlineOre != null && nmHeadlineOre > 0
          ? { condition, ore: nmHeadlineOre, n: 0, source: "headline" }
          : { condition, ore: null, n: 0, source: null };
      }
      const f = ct[condition];
      return f ? { condition, ore: f.ore, n: f.n, source: "cardtrader" } : { condition, ore: null, n: 0, source: null };
    }),
  };
}

/**
 * Priset för ett valt skick. Utan tabell (inga CT-tal) är bara NM känt — ur rubriken.
 * Ett skick utan pris ger `ore: null`, aldrig rubrikpriset i dess ställe.
 */
export function priceForCondition(
  table: ConditionPriceTable | null,
  condition: string,
  headlineOre: number | null = null
): ConditionPriceRow {
  const row = table?.rows.find((r) => r.condition === condition);
  if (row) return row;
  if (condition === "NEAR_MINT" && headlineOre != null && headlineOre > 0) {
    return { condition: "NEAR_MINT", ore: headlineOre, n: 0, source: "headline" };
  }
  return { condition: (condition as PricedCondition) ?? "NEAR_MINT", ore: null, n: 0, source: null };
}
