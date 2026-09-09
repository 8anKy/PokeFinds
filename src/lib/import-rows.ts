/**
 * FIL + KOLUMNTOLKNING → UTKASTRADER (ren modul).
 *
 * Sista steget innan databasen ser något. En utkastrad är filens rad, läst med
 * VÅRA begrepp men ännu utan koppling till katalogen — matchningen sker i
 * `services/collection-import.ts`, som är den enda delen som behöver Prisma.
 * Uppdelningen är vad som gör hela tolkningen testbar utan databas.
 *
 * ⛔ UTLÄNDSKA INKÖPSPRISER SLÄPPS, DE RÄKNAS INTE OM (ägarbeslut 2026-09-10).
 * Inköpspriset är kostnadsbasen i vinst/förlust. Ett köp gjort 2023 i dollar
 * omräknat till DAGENS kurs är en påhittad anskaffningskostnad — exakt det som
 * `collection-portfolio.md` redan förbjuder för backfill ur `estimatedValue`
 * ("en påhittad anskaffningskostnad gör hela siffran till en lögn"). Raden
 * importeras ändå; det är BELOPPET som lämnas tomt, och antalet släppta belopp
 * redovisas för användaren så tystnaden inte förväxlas med "filen hade inga
 * priser". Användaren kan säga vilken valuta filen är i — då räknas inget om
 * eftersom vi då VET att den är i kronor.
 */
import type { CardCondition, CardLanguage } from "@prisma/client";
import { rowValue, type ParsedCsv } from "@/lib/csv-parse";
import type { ColumnMapping, MoneyUnit } from "@/lib/import-mapping";
import {
  inferDateOrder,
  moneyToOre,
  normalizeCondition,
  normalizeLanguage,
  normalizePrinting,
  parseImportDate,
  parseImportNumber,
  parseMoney,
  parseQuantity,
  type DateOrder,
  type MoneyCurrency,
  type ParsedImportNumber,
} from "@/lib/import-normalize";

export interface ImportDraftRow {
  /** Radnummer i FILEN (1 = första dataraden). Felmeddelanden pekar hit. */
  row: number;
  name: string;
  setName: string;
  setCode: string;
  number: ParsedImportNumber;
  quantity: number;
  condition: CardCondition | null;
  language: CardLanguage | null;
  /** Vår `Product.variantLabel`, eller null för ordinarie tryckning. */
  variantLabel: string | null;
  purchasePrice: number | null;
  purchaseDate: Date | null;
  estimatedValue: number | null;
  gradingCompany: string | null;
  grade: string | null;
  notes: string | null;
  /** pokemontcg.io-id ("sv3pt5-25") när filen bär ett. */
  externalId: string | null;
  /** Foilio-slug ur vår egen export — exakt nyckel även för sealed. */
  slug: string | null;
  /** Filens egen varutyp ("Sealed", "Card") när den finns. */
  itemType: string | null;
}

export interface BuildDraftOptions {
  /** Öre (vår egen export) eller huvudenhet (alla andra). */
  moneyUnit: MoneyUnit;
  /** Valutan användaren säger att filen är i, när filen själv inte säger det. */
  fileCurrency: MoneyCurrency;
  /** Överstyr datumordningen (annars gissas den ur hela filen). */
  dateOrder?: DateOrder;
  /** Bara vår egen backup bär ett marknadsvärde vi kan återställa ärligt. */
  trustEstimatedValue?: boolean;
}

export interface BuildDraftResult {
  rows: ImportDraftRow[];
  /** Rader utan namn — de kan inte bli något och räknas bara. */
  skippedEmpty: number;
  /** Belopp vi släppte för att valutan inte var SEK. Redovisas i UI:t. */
  droppedForeignPrices: number;
  /** Externa marknadsvärden som ersätts av Foilios livevärde efter matchning. */
  ignoredMarketValues: number;
  dateOrder: DateOrder;
}

const MAX_NOTES = 1000;

function clean(value: string, max: number): string | null {
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * En penningkolumn → öre, eller null när valutan inte är kronor.
 * Returnerar också om ett BELOPP faktiskt kastades (för räknaren) — ett tomt
 * fält är inte ett kastat belopp.
 */
function moneyColumn(
  raw: string,
  opts: BuildDraftOptions
): { ore: number | null; dropped: boolean } {
  const { amount, currency } = parseMoney(raw);
  if (amount == null) return { ore: null, dropped: false };
  const effective = currency ?? opts.fileCurrency;
  if (effective !== "SEK") return { ore: null, dropped: true };
  return { ore: moneyToOre(amount, opts.moneyUnit), dropped: false };
}

export function buildDraftRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  opts: BuildDraftOptions
): BuildDraftResult {
  const dateOrder =
    opts.dateOrder ??
    inferDateOrder(parsed.rows.map((r) => rowValue(r, mapping.purchaseDate)));

  const rows: ImportDraftRow[] = [];
  let skippedEmpty = 0;
  let droppedForeignPrices = 0;
  let ignoredMarketValues = 0;

  parsed.rows.forEach((raw, i) => {
    const name = rowValue(raw, mapping.name);
    if (!name) {
      skippedEmpty++;
      return;
    }

    const purchase = moneyColumn(rowValue(raw, mapping.purchasePrice), opts);
    const estimatedRaw = rowValue(raw, mapping.estimatedValue);
    const estimated = opts.trustEstimatedValue
      ? moneyColumn(estimatedRaw, opts)
      : { ore: null, dropped: false };
    if (!opts.trustEstimatedValue && parseMoney(estimatedRaw).amount != null) ignoredMarketValues++;
    if (purchase.dropped) droppedForeignPrices++;

    rows.push({
      row: i + 1,
      name: name.slice(0, 300),
      setName: rowValue(raw, mapping.setName).slice(0, 200),
      setCode: rowValue(raw, mapping.setCode).slice(0, 40),
      number: parseImportNumber(rowValue(raw, mapping.cardNumber)),
      quantity: parseQuantity(rowValue(raw, mapping.quantity)),
      condition: normalizeCondition(rowValue(raw, mapping.condition)),
      language: normalizeLanguage(rowValue(raw, mapping.language)),
      variantLabel: normalizePrinting(rowValue(raw, mapping.printing)),
      purchasePrice: purchase.ore,
      purchaseDate: parseImportDate(rowValue(raw, mapping.purchaseDate), dateOrder),
      estimatedValue: estimated.ore,
      gradingCompany: clean(rowValue(raw, mapping.gradingCompany), 50),
      grade: clean(rowValue(raw, mapping.grade), 20),
      notes: clean(rowValue(raw, mapping.notes), MAX_NOTES),
      externalId: clean(rowValue(raw, mapping.externalId), 100),
      slug: clean(rowValue(raw, mapping.slug), 200),
      itemType: clean(rowValue(raw, mapping.itemType), 60),
    });
  });

  return { rows, skippedEmpty, droppedForeignPrices, ignoredMarketValues, dateOrder };
}

/**
 * Ser raden ut att gälla en FÖRSEGLAD vara?
 *
 * Tre signaler, i fallande tillförlitlighet: filens egen varutyp, skicket
 * SEALED, och avsaknaden av ett kortnummer. ⛔ Den sista är EN indikation, inte
 * ett bevis — en handskriven Excel-fil har sällan nummer alls. Därför avgör den
 * bara VILKEN matchningsväg vi provar först; en singel som råkar sakna nummer
 * faller ändå tillbaka på namnvägen.
 */
export function looksSealed(row: ImportDraftRow): boolean {
  const type = (row.itemType ?? "").toLowerCase();
  if (/sealed|box|product|förseglad|oöppnad/.test(type)) return true;
  if (/card|singel|single|kort/.test(type)) return false;
  if (row.condition === "SEALED") return true;
  return row.number.number === "";
}
