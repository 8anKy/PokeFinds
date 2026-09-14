/**
 * GRADERADE BEGÄRDA PRISER — ren dom (ingen DB, ingen nätverk), testad i
 * `tests/unit/graded-ask.test.ts`.
 *
 * Källan är eBays Browse API (gratis, ~5 000 anrop/dygn): EN sökning per kort
 * ger de billigaste aktiva graderade annonserna, och vi bucketar dem per
 * (bolag, betyg) HÄR — sök-svaret bär inga aspekter, så bolag och betyg läses ur
 * titeln med samma `detectGrading` som Tradera-serien.
 *
 * ⛔ BEGÄRT ÄR INTE SÅLT. Det här är vad säljare VILL HA, inte vad kort går för.
 * Raden heter "till salu", aldrig "värde", och `GradedSale` (hammarpris) är den
 * enda serien som får kallas en affär.
 *
 * ⛔ SÖKNINGEN ÄR FUZZY — VARJE TRÄFF MÅSTE BEVISA SIG. eBay returnerar gärna
 * "Charizard 4/102" på en sökning efter "Charizard 6/165". Kortnumret i titeln
 * måste vara produktens (samma regel som Tradera-matchningen), betyget måste gå
 * att läsa, och lotter/bulk kastas. Hellre en tom rad än ett främmande pris.
 *
 * ⛔ BARA FASTPRIS ÄR ETT BEGÄRT PRIS. En pågående auktions nuvarande bud är
 * varken begärt eller betalt — det är ett mellanläge som ser billigt ut tills
 * sista minuten. `AUCTION`-annonser utan `FIXED_PRICE` hoppas över.
 */
import { cardNumberKey, printedNumberKey, bareCardNumbers } from "../scrapers/matching";
import { detectGrading, type GradingIssuer } from "./graded-listing";
import { listingCardLanguage } from "./listing-language";
import { listingFitsVariant } from "./print-variant";
import { normalizeTitle } from "./utils";
import type { CardLanguage } from "@prisma/client";

/** Källnamn i `GradedAsk.source`. */
export const EBAY_ASK_SOURCE = "ebay";

/** Så gammal får en rad vara innan läsmodellen döljer den (svepet roterar). */
export const GRADED_ASK_MAX_AGE_DAYS = 14;

/** Minsta bild av en eBay-annons ur `item_summary/search`. */
export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value?: string; currency?: string } | null;
  itemWebUrl?: string;
  buyingOptions?: string[];
}

export interface GradedAskProduct {
  id: string;
  language: CardLanguage;
  variantLabel: string | null;
  card: { name: string; number: string; set: { name: string } };
}

export interface GradedAskBucket {
  issuer: GradingIssuer;
  gradeTenths: number;
  /** Antal annonser som klarade vakterna. */
  listingCount: number;
  /** Billigaste annonsen — beloppet i källans valuta (t.ex. 129.99). */
  amount: number;
  currency: string;
  itemId: string;
  title: string;
  url: string;
}

/**
 * Söksträngen. Kortnamn + nummer räcker: eBays sök är fuzzy och setnamnet
 * skulle mest tappa träffar där säljaren skrivit setkoden i stället. Numret är
 * den identitet vakten sedan kräver i titeln, så det ska med i frågan.
 * "Japanese" läggs på för JP-produkter — annars dränks de av EN-exemplaren.
 */
export function buildGradedSearchQuery(p: GradedAskProduct): string {
  const number = p.card.number.trim();
  const parts = [p.card.name.trim(), number];
  if (p.language === "JP") parts.push("Japanese");
  return parts.join(" ").replace(/\s+/g, " ");
}

/**
 * Lotter, bulk och "välj kort" är inte ett pris på ETT exemplar.
 * ⛔ `lot` bara som eget ord ("Charlotte" bär det — ordgränsen behövs).
 * ⛔ Kvantitet bara som "2x"/"2 x" (siffra FÖRE x): "Mega Charizard X 108/108"
 *    är ett kortnamn, och ett "x\d+"-mönster hade kastat varje annons på det.
 */
const LOT_RE =
  /\b(?:lot|lots|bundle|bulk|set of \d+|\d+\s?x|choose|pick your|you pick|multi-?listing)\b/i;

/** Bär titeln PRODUKTENS kortnummer? Samma dom som Tradera-matchningen. */
export function titleCarriesNumber(title: string, productNumber: string): boolean {
  const want = cardNumberKey(productNumber);
  if (!want) return false;
  const printed = printedNumberKey(title);
  if (printed) return printed === want;
  // Inget "X/Y" — ett bart nummer duger om det är produktens (bokstavssuffix kan
  // inte läsas då, så "115a" kräver X/Y-formen).
  const wantBare = /^\d+$/.test(want) ? parseInt(want, 10) : null;
  if (wantBare == null) return false;
  return bareCardNumbers(normalizeTitle(title)).includes(wantBare);
}

/**
 * Bucketar ett sök-svar per (bolag, betyg) och behåller den billigaste per grupp.
 * Ordningen på `items` spelar ingen roll — minsta belopp vinner.
 */
export function bucketGradedAsks(
  items: EbayItemSummary[],
  product: GradedAskProduct
): GradedAskBucket[] {
  const buckets = new Map<string, GradedAskBucket>();
  for (const it of items) {
    const title = it.title ?? "";
    if (!title || !it.itemId || !it.itemWebUrl) continue;
    if (it.buyingOptions && !it.buyingOptions.includes("FIXED_PRICE")) continue;
    if (LOT_RE.test(title)) continue;
    // Språk: en EN-produkt får inte prissättas av ett japanskt exemplar och vice
    // versa (olika varor, olika marknader). Blockade språk (CN/KR/EU) faller ut
    // som OTHER och matchar ingen produkt.
    if (listingCardLanguage(title) !== product.language) continue;
    if (!titleCarriesNumber(title, product.card.number)) continue;
    // Tryckning: 1st Edition/Shadowless är egna produkter; en Unlimited-produkt
    // får inte bära 1st Edition-priset.
    if (!listingFitsVariant(product.variantLabel, title, product.card.name)) continue;

    const grading = detectGrading({ title });
    if (!grading || grading.gradeTenths == null) continue;

    const amount = Number(it.price?.value);
    const currency = it.price?.currency;
    if (!Number.isFinite(amount) || amount <= 0 || !currency) continue;

    const key = `${grading.issuer}|${grading.gradeTenths}`;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, {
        issuer: grading.issuer,
        gradeTenths: grading.gradeTenths,
        listingCount: 1,
        amount,
        currency,
        itemId: it.itemId,
        title,
        url: it.itemWebUrl,
      });
      continue;
    }
    // Olika valutor i samma grupp går inte att jämföra utan kurs — behåll den
    // första valutan och räkna bara annonser i den.
    if (currency !== cur.currency) continue;
    cur.listingCount++;
    if (amount < cur.amount) {
      cur.amount = amount;
      cur.itemId = it.itemId;
      cur.title = title;
      cur.url = it.itemWebUrl;
    }
  }
  return [...buckets.values()];
}
