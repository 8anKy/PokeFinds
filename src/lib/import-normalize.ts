/**
 * VÄRDENORMALISERING FÖR SAMLINGSIMPORT (ren modul).
 *
 * Kolumnen är hittad (import-mapping.ts) — här översätts INNEHÅLLET till våra
 * enum:ar och heltal. Fyra av fallen bär varsin fälla som kostat andra appar:
 *
 * ⛔ "LP" BETYDER TVÅ OLIKA SAKER. I den vanligaste amerikanska skalan är
 *    Lightly Played det NÄST bästa skicket; i den europeiska är Light Played
 *    det NÄST SÄMSTA. Samma bokstäver,
 *    fyra steg isär. Vi kan inte veta vilken skala filen använder, så skicket
 *    tolkas efter den vanligaste (TCG-skalan) och får bli ETT steg fel i värsta
 *    fall. Det är ofarligt HÄR och bara här: skicket är en etikett i samlingen,
 *    det prissätter ingenting hos oss (priset kommer från katalogen). Skulle
 *    skicket någon gång börja påverka värdet måste den här raden läsas om.
 *
 * ⛔ "HOLOFOIL" ÄR INTE EN EGEN VARA HOS OSS, "REVERSE HOLO" ÄR DET. Katalogen
 *    delar bara reverse-tryckningarna i egna produkter (+ Master/Poké Ball och
 *    Base tre tryckningar). En holo-rad ska därför landa på den ORDINARIE
 *    produkten — att uppfinna en holo-variant vore påhitt.
 *
 * ⛔ 10/09/2026 GÅR INTE ATT LÄSA UR EN ENSAM RAD. Ordningen gissas för HELA
 *    filen (`inferDateOrder`): finns en enda rad där första talet är > 12 vet vi
 *    ordningen säkert, annars gäller filens default. Att gissa per rad ger en
 *    fil där hälften av köpen ligger i fel månad.
 *
 * ⛔ ETT BELOPP UTAN VALUTA ÄR INTE NOLL KRONOR. Vi returnerar valutan vi
 *    faktiskt läste och låter anroparen avgöra — se collection-import.ts för
 *    varför utländska inköpspriser lämnas TOMMA i stället för att räknas om.
 */
import type { CardCondition, CardLanguage } from "@prisma/client";
import { CONDITION_LABELS } from "@/lib/collection-labels";
import {
  PRINT_FIRST_EDITION,
  PRINT_SHADOWLESS,
  PRINT_UNLIMITED,
  VARIANT_MASTER_BALL,
  VARIANT_POKE_BALL,
  VARIANT_REVERSE_HOLO,
} from "@/lib/print-variant";

/** Gemener, diakriter kvar, skiljetecken → mellanslag. */
function slim(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------- Skick ----------

const CONDITION_MAP: Record<string, CardCondition> = {
  "gem mint": "MINT",
  "gem mt": "MINT",
  pristine: "MINT",
  mint: "MINT",
  m: "MINT",
  "near mint": "NEAR_MINT",
  "near mint mint": "NEAR_MINT",
  "mint near mint": "NEAR_MINT",
  nearmint: "NEAR_MINT",
  nm: "NEAR_MINT",
  "nm mt": "NEAR_MINT",
  "nm m": "NEAR_MINT",
  excellent: "EXCELLENT",
  exc: "EXCELLENT",
  ex: "EXCELLENT",
  "lightly played": "EXCELLENT",
  "light played": "EXCELLENT",
  "slightly played": "EXCELLENT",
  lp: "EXCELLENT",
  sp: "EXCELLENT",
  good: "GOOD",
  gd: "GOOD",
  "moderately played": "GOOD",
  "moderate play": "GOOD",
  mp: "GOOD",
  played: "PLAYED",
  "heavily played": "PLAYED",
  hp: "PLAYED",
  pl: "PLAYED",
  poor: "POOR",
  po: "POOR",
  damaged: "POOR",
  dmg: "POOR",
  sealed: "SEALED",
  "factory sealed": "SEALED",
  förseglad: "SEALED",
  oöppnad: "SEALED",
  ny: "SEALED",
  // Svenska etiketter (vår egen export skriver enum-nyckeln, men en handskriven
  // Excel-fil skriver det man ser i appen).
  skick: "NEAR_MINT",
  nyskick: "NEAR_MINT",
  bra: "GOOD",
  dålig: "POOR",
};

/** `null` = kolumnen sa ingenting ⇒ anroparen använder sin default. */
export function normalizeCondition(raw: string): CardCondition | null {
  const key = slim(raw);
  if (!key) return null;
  // Vår egen export skriver enum-nyckeln rakt av.
  const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (upper in CONDITION_LABELS) return upper as CardCondition;
  return CONDITION_MAP[key] ?? null;
}

// ---------- Språk ----------

const LANGUAGE_MAP: Record<string, CardLanguage> = {
  en: "EN",
  eng: "EN",
  english: "EN",
  engelska: "EN",
  jp: "JP",
  ja: "JP",
  jpn: "JP",
  japanese: "JP",
  japanska: "JP",
  日本語: "JP",
  sv: "SV",
  se: "SV",
  swe: "SV",
  swedish: "SV",
  svenska: "SV",
  de: "DE",
  ger: "DE",
  german: "DE",
  deutsch: "DE",
  tyska: "DE",
  fr: "FR",
  fra: "FR",
  fre: "FR",
  french: "FR",
  français: "FR",
  francais: "FR",
  franska: "FR",
};

export function normalizeLanguage(raw: string): CardLanguage | null {
  const key = slim(raw);
  if (!key) return null;
  const hit = LANGUAGE_MAP[key];
  if (hit) return hit;
  // Okänt språk är ett FAKTUM ("Italiano"), inte ett saknat värde.
  return "OTHER";
}

// ---------- Tryckning / variant ----------

const PRINTING_MAP: [RegExp, string][] = [
  [/master ?ball/, VARIANT_MASTER_BALL],
  [/(poke|poké) ?ball/, VARIANT_POKE_BALL],
  [/\b(reverse|rev)\b|\brh\b/, VARIANT_REVERSE_HOLO],
  [/(1st|first) ?ed/, PRINT_FIRST_EDITION],
  [/shadowless/, PRINT_SHADOWLESS],
  [/unlimited/, PRINT_UNLIMITED],
];

/**
 * `null` = ordinarie tryckning (inklusive "Normal", "Holofoil", "Foil").
 * Se filhuvudet för varför holo INTE blir en egen variant.
 */
export function normalizePrinting(raw: string): string | null {
  const key = slim(raw);
  if (!key) return null;
  for (const [re, label] of PRINTING_MAP) if (re.test(key)) return label;
  return null;
}

// ---------- Kortnummer ----------

export interface ParsedImportNumber {
  /** Numret som katalogen skriver det: "25", "TG28", "SM103a". */
  number: string;
  /** Talet efter snedstrecket ("025/165" → 165), när filen bär det. */
  printedTotal: number | null;
  /** Alternativa skrivsätt att prova mot katalogen, bästa först. */
  candidates: string[];
}

/**
 * Läser ett kortnummer. Hanterar "025/165", "#25", "SV025", "TG28/TG30", "25a".
 *
 * Nollutfyllnad är rent kosmetisk i exportfiler ("025") medan katalogen skriver
 * "25" — men INTE alltid: några delserier trycker faktiskt nollor. Därför
 * returneras BÅDA formerna som kandidater i stället för att en väljs.
 */
export function parseImportNumber(raw: string): ParsedImportNumber {
  const trimmed = raw.trim().replace(/^#/, "");
  if (!trimmed) return { number: "", printedTotal: null, candidates: [] };

  const [left, right] = trimmed.split("/");
  const printedTotal = right ? Number.parseInt(right.replace(/\D/g, ""), 10) : NaN;

  const core = left.trim().toUpperCase().replace(/\s+/g, " ");
  const m = /^([A-ZÅÄÖ ]*?)\s*0*(\d+)\s*([A-ZÅÄÖ]?)$/.exec(core);

  const candidates = new Set<string>();
  candidates.add(core);
  if (m) {
    const [, prefix, digits, suffix] = m;
    const p = prefix.trim();
    candidates.add(`${p}${digits}${suffix}`);
    if (p) candidates.add(`${p} ${digits}${suffix}`);
    // Nollutfylld till tre siffror — några promo-serier trycker den formen.
    candidates.add(`${p}${digits.padStart(3, "0")}${suffix}`);
  }

  return {
    number: m ? `${m[1].trim()}${m[2]}${m[3]}` : core,
    printedTotal: Number.isFinite(printedTotal) && printedTotal > 0 ? printedTotal : null,
    candidates: [...candidates].filter(Boolean),
  };
}

// ---------- Antal ----------

export function parseQuantity(raw: string): number {
  const n = Number.parseInt(raw.replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  // Taket speglar radtaket per fil: ett fyrsiffrigt antal på EN rad är
  // nästan alltid en felmappad kolumn (marknadsvärde i antalskolumnen).
  return Math.min(n, 9999);
}

// ---------- Pengar ----------

export type MoneyCurrency = "SEK" | "USD" | "EUR" | "OTHER";

export interface ParsedMoney {
  /** Belopp i huvudenhet (kronor/dollar/euro), aldrig öre. */
  amount: number | null;
  /** Valutan som FILEN angav. `null` = ingen markör — anroparen bestämmer. */
  currency: MoneyCurrency | null;
}

const CURRENCY_SIGNS: [RegExp, MoneyCurrency][] = [
  [/kr|sek/i, "SEK"],
  [/\$|usd|dollar/i, "USD"],
  [/€|eur/i, "EUR"],
  [/£|gbp|¥|jpy|dkk|nok|chf|pln/i, "OTHER"],
];

/**
 * Läser ett belopp med okänt decimal- och tusentalstecken.
 *
 * Regeln: det SIST förekommande av "," och "." är decimaltecknet — men bara om
 * det följs av 1–2 siffror. "1.234" är alltså ettusentvåhundratrettiofyra,
 * "12,50" är tolv och femtio. Utan den regeln blir varje svensk Excel-export
 * tusen gånger för dyr eller tusen gånger för billig, tyst.
 */
export function parseMoney(raw: string): ParsedMoney {
  const text = raw.trim();
  if (!text) return { amount: null, currency: null };

  let currency: MoneyCurrency | null = null;
  for (const [re, code] of CURRENCY_SIGNS) {
    if (re.test(text)) {
      currency = code;
      break;
    }
  }

  const digits = text.replace(/[^\d,.\-]/g, "");
  if (!digits) return { amount: null, currency };

  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  const sepIndex = Math.max(lastComma, lastDot);
  let normalized: string;
  if (sepIndex >= 0 && digits.length - sepIndex - 1 <= 2 && digits.length - sepIndex - 1 >= 1) {
    normalized = digits.slice(0, sepIndex).replace(/[,.]/g, "") + "." + digits.slice(sepIndex + 1);
  } else {
    normalized = digits.replace(/[,.]/g, "");
  }

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: null, currency };
  return { amount, currency };
}

/**
 * Belopp → öre. ⛔ `null` när resultatet inte är positivt — samma doktrin som
 * `priceOreFromEur`: "0 kr" läses som gratis, "–" som "vi vet inte".
 */
export function moneyToOre(amount: number | null, unit: "major" | "ore"): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const ore = unit === "ore" ? Math.round(amount) : Math.round(amount * 100);
  // int4-taket (samma räcke som parseKronorToOre i purchase-price.ts).
  if (ore <= 0 || ore > 2_147_483_647) return null;
  return ore;
}

// ---------- Datum ----------

export type DateOrder = "dmy" | "mdy";

const NUMERIC_DATE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/;

/**
 * Gissar dag/månad-ordningen för HELA filen. En enda rad där första talet är
 * > 12 avgör; annars faller vi på `fallback` (sv-SE ⇒ dag först).
 */
export function inferDateOrder(values: string[], fallback: DateOrder = "dmy"): DateOrder {
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const value of values) {
    const m = NUMERIC_DATE.exec(value.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12++;
    if (Number(m[2]) > 12) secondOver12++;
  }
  if (firstOver12 > 0 && secondOver12 === 0) return "dmy";
  if (secondOver12 > 0 && firstOver12 === 0) return "mdy";
  return fallback;
}

/**
 * Läser ett datum. ISO först (entydigt), sedan numeriskt enligt `order`.
 * Klockslag i värdet ignoreras — vi lagrar köpdag, inte köpminut.
 */
export function parseImportDate(raw: string, order: DateOrder = "dmy"): Date | null {
  const text = raw.trim().split(/[T ]/)[0];
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const m = NUMERIC_DATE.exec(text);
  if (m) {
    const day = order === "dmy" ? Number(m[1]) : Number(m[2]);
    const month = order === "dmy" ? Number(m[2]) : Number(m[1]);
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return utcDate(year, month, day);
  }
  return null;
}

/**
 * ⛔ UTC, aldrig lokal midnatt (samma regel som `utcToday`): en post skapad
 * 01:00 svensk tid skulle annars få gårdagens datum, osynligt i drift.
 */
function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  // Date.UTC normaliserar annars 31 februari till 3 mars och gör ett trasigt
  // kalkylarksdatum till ett till synes giltigt köpdatum.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  // Ett datum i framtiden är alltid en felläsning (ingen köper i förväg).
  if (d.getTime() > Date.now() + 86_400_000) return null;
  return d;
}
