/**
 * Valen i "Sälj på Tradera"-arket — REN modul (ingen Prisma, ingen Next, ingen
 * fetch) så att API-rutten, klienten och testerna delar exakt samma dom.
 *
 * ⛔ SKICK ÄR INTE SAMMA FRÅGA FÖR ETT KORT OCH FÖR EN FÖRSEGLAD PRODUKT.
 * "Near Mint" på en boosterbox är meningslöst — den är förseglad eller öppnad.
 * Två listor, en per varutyp, och båda lagrar `CardCondition`-NYCKELN (aldrig
 * etiketten) eftersom samlingen och forumet redan gör det.
 */

export type ListingType = "BUY_NOW" | "AUCTION";

/** Tradera item-typ: 1 = Auktion, 3 = Endast Köp Nu (GET /v4/reference-data/item-types). */
export const ITEM_TYPE_AUCTION = 1;
export const ITEM_TYPE_BUY_NOW = 3;

/**
 * DEN PUBLIKA LÄNKEN TILL EN ANNONS.
 *
 * ⛔ `/item/0/<id>` ÄR 404 — och det var länken vi la i forumtrådarna och i
 * katalogens offers ("View on Tradera" ledde till Traderas felsida, rapporterat
 * 2026-09-07). Traderas kanoniska form är `/item/<kategori>/<id>/<slug>`, och
 * BÅDE en påhittad kategori (0) och en utelämnad slug ger 404. Mätt mot
 * tradera.com samma dag:
 *   /item/0/749317922       → 404
 *   /item/1001337/749317922 → 404   (rätt kategori, ingen slug)
 *   /item/749317922         → 308 → /item/1001337/749317922/dragonair-jp-…
 * Den KORTA formen är alltså Traderas egen kanonisering: den kan slugen, vi
 * kan den inte. ⛔ Bygg aldrig ihop en URL av kategori och id igen.
 */
export function traderaItemUrl(itemId: string | number): string {
  return `https://www.tradera.com/item/${itemId}`;
}

/**
 * Graderingsattributen i Traderas Pokémon-kategorier. ⛔ ID:N OCH TERMER ÄR
 * TRADERAS EGNA, hämtade ur `GET /v4/categories/{id}/attribute-definitions`
 * 2026-09-07 (`scripts/probe-tradera-attributes.ts`) — hitta aldrig på ett
 * attribut-id, och skicka aldrig en term som inte står i listan: API:t tar
 * bara `possibleTermValues`.
 *
 * ⚠️ BGS heter "Beckett" hos Tradera, och SGC/TAG/HGA/GMA finns inte alls —
 * de är "Övriga". Listan är därför INTE `GradingIssuer` i lib/graded-listing.ts
 * (som är vår egen, bredare taxonomi för att LÄSA andras annonser).
 */
export const GRADING_ISSUER_ID = 125;
export const GRADE_ID = 126;
export const GRADING_ISSUERS = ["PSA", "Beckett", "CGC", "ACE", "Raukcard", "Övriga"] as const;
export const GRADES = [
  "10",
  "9.5",
  "9",
  "8.5",
  "8",
  "7",
  "6",
  "5",
  "4",
  "3",
  "2",
  "1",
] as const;

/**
 * Samlingens fritextfält (`CollectionItem.gradingCompany`) → Traderas term.
 * Okänt bolag blir "Övriga" — graderingen är sann även när bolaget inte är ett
 * av Traderas fem, och att tappa den helt vore sämre.
 */
export function traderaGradingIssuer(company: string | null | undefined): string | undefined {
  const v = (company ?? "").trim();
  if (!v) return undefined;
  const hit = GRADING_ISSUERS.find((i) => i.toLowerCase() === v.toLowerCase());
  if (hit) return hit;
  if (/^bgs$|beckett/i.test(v)) return "Beckett";
  return "Övriga";
}

/** Samlingens betygsfält → Traderas term. Komma som decimaltecken tillåts. */
export function traderaGrade(grade: string | null | undefined): string | undefined {
  const v = (grade ?? "").trim().replace(",", ".");
  if (!v) return undefined;
  return (GRADES as readonly string[]).includes(v) ? v : undefined;
}

/** "PSA 10" — etiketten i annonsens rubrik och beskrivning. */
export function gradingLabel(
  company: string | null | undefined,
  grade: string | null | undefined
): string | null {
  const issuer = traderaGradingIssuer(company);
  const g = traderaGrade(grade);
  if (!issuer || !g) return null;
  return `${issuer} ${g}`;
}

/** Köp nu-annonsens löptid. 60 dagar = längsta Tradera tillåter. */
export const BUY_NOW_DURATION_DAYS = 60;
/** Auktionens löptid i dagar — Traderas egna val i säljformuläret. */
export const AUCTION_DURATIONS = [3, 5, 7, 10, 14] as const;
export const DEFAULT_AUCTION_DURATION = 7;

/** Skick för ett LÖST kort. Samma nycklar som `CardCondition` i schemat. */
export const SINGLE_CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "EXCELLENT",
  "GOOD",
  "PLAYED",
  "POOR",
] as const;

/**
 * Skick för en FÖRSEGLAD produkt. Tre lägen som en köpare faktiskt kan skilja
 * på; enum-nycklarna återanvänds så att inget nytt behöver migreras.
 */
export const SEALED_CONDITIONS = ["SEALED", "NEAR_MINT", "GOOD"] as const;

export function conditionOptionsFor(isSingle: boolean): readonly string[] {
  return isSingle ? SINGLE_CONDITIONS : SEALED_CONDITIONS;
}

/**
 * Etiketten som hamnar i Tradera-annonsens rubrik och beskrivning. Sealed har
 * EGNA texter — samma nyckel betyder olika saker för de två varutyperna.
 */
const SINGLE_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Förseglad",
};

const SEALED_LABELS: Record<string, string> = {
  SEALED: "Förseglad",
  NEAR_MINT: "Öppnad, som ny",
  GOOD: "Öppnad, använd",
};

export function conditionLabel(condition: string, isSingle: boolean): string {
  const table = isSingle ? SINGLE_LABELS : SEALED_LABELS;
  return table[condition] ?? SINGLE_LABELS[condition] ?? condition;
}

/**
 * AI-graderingens helhetsgrad (1–10) → ett skick att förifylla med.
 *
 * ⛔ FÖRSLAG, ALDRIG ETT PÅSTÅENDE. Graden är vår modells bedömning av två
 * foton, inte en PSA-slab, och den skrivs därför bara in i väljaren — köparen
 * ser skicket säljaren till slut valde, inte vad modellen gissade.
 */
export function gradeToCondition(overall: number): string {
  if (!Number.isFinite(overall)) return "NEAR_MINT";
  if (overall >= 9.5) return "MINT";
  if (overall >= 8.5) return "NEAR_MINT";
  if (overall >= 7) return "EXCELLENT";
  if (overall >= 5) return "GOOD";
  if (overall >= 3) return "PLAYED";
  return "POOR";
}

/** Snabbvalen kring priset. 0 = "tillbaka till marknadspriset". */
export const PRICE_STEPS = [-10, -5, 0, 5, 10, 20] as const;

/** Basen ±procent, aldrig under 1 kr (Tradera tar inga nollannonser). */
export function applyPricePercent(baseKr: number, pct: number): number {
  return Math.max(1, Math.round((baseKr * (100 + pct)) / 100));
}

/** Det köparen faktiskt betalar: pris + frakt. Ogiltiga tal räknas som 0. */
export function totalBuyerKr(priceKr: number, shippingKr: number): number {
  const p = Number.isFinite(priceKr) && priceKr > 0 ? Math.round(priceKr) : 0;
  const s = Number.isFinite(shippingKr) && shippingKr > 0 ? Math.round(shippingKr) : 0;
  return p + s;
}

/**
 * Momssatser en svensk säljare kan välja. 25 % är normalsatsen och den som
 * gäller samlarkort; 12/6 finns för den som säljer något annat i samma flöde.
 *
 * ⛔ VALFRITT MED FLIT. En privatperson som säljer ur sin egen samling redovisar
 * INGEN moms, och ett fält som står ifyllt som standard hade fått folk att
 * påstå något om sin försäljning som inte stämmer. Av = inget `vat` alls
 * skickas till Tradera.
 */
export const VAT_RATES = [25, 12, 6] as const;
export const DEFAULT_VAT_RATE = 25;

/**
 * Momsen SOM REDAN LIGGER I PRISET, i hela kronor. Priser till konsument anges
 * inklusive moms i Sverige — beloppet räknas alltså BAKLÄNGES ur priset
 * (pris × sats/(100+sats)), aldrig som ett påslag ovanpå.
 */
export function vatShareKr(priceKr: number, ratePercent: number): number {
  if (!Number.isFinite(priceKr) || priceKr <= 0 || ratePercent <= 0) return 0;
  return Math.round((priceKr * ratePercent) / (100 + ratePercent));
}

/** Billigaste fraktsättet av dem säljaren valt — det köparen minst kan betala. */
export function cheapestShippingKr(costs: readonly number[]): number {
  const valid = costs.filter((c) => Number.isFinite(c) && c >= 0);
  return valid.length === 0 ? 0 : Math.min(...valid);
}

/**
 * Traderas EGNA paketstorlekar, i METER (samma enhet som `packageRequirements`).
 *
 * ⛔ TALEN ÄR TRADERAS, INTE VÅRA — verifierade mot deras hjälpsidor 2026-09-07
 * (tradera.com/support/se/posts/fler-exempel-pa-matt-foer-large-paket/):
 * Small 34×24×7, Medium 60×40×20, Large 120×40×40 cm. Samma tre steg som deras
 * egen fraktväljare ("Välj storlek (Small, Medium eller Large)"), och de
 * filtrerar på samma sätt: "När du väljer Large så kommer PostNord automatiskt
 * att döljas eftersom deras mått är för små." Hitta aldrig på egna mått här.
 *
 * Storleken skickas ALDRIG till Tradera (fraktraden bär bara vikt) — den
 * FILTRERAR vilka fraktsätt som ens går att välja, så att man inte köper en
 * 22-kronorsfrakt till en boosterbox som aldrig får plats i den.
 */
export const PACKAGE_SIZES = {
  SMALL: { length: 0.34, width: 0.24, height: 0.07 },
  MEDIUM: { length: 0.6, width: 0.4, height: 0.2 },
  LARGE: { length: 1.2, width: 0.4, height: 0.4 },
} as const;

export type PackageSize = keyof typeof PACKAGE_SIZES;
export const PACKAGE_SIZE_KEYS = ["SMALL", "MEDIUM", "LARGE"] as const;
export const DEFAULT_PACKAGE_SIZE: PackageSize = "SMALL";

/** "34 × 24 × 7 cm" — meter → centimeter, som folk mäter paket. */
export function packageSizeLabel(size: PackageSize): string {
  const d = PACKAGE_SIZES[size];
  const cm = (m: number) => Math.round(m * 100);
  return `${cm(d.length)} × ${cm(d.width)} × ${cm(d.height)} cm`;
}
