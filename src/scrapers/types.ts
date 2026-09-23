/**
 * Gemensamma typer för datainsamlings-adaptrar.
 *
 * ETIK & ANSVARSFULL DATAINSAMLING — alla adaptrar MÅSTE:
 *  - Respektera robots.txt (se src/scrapers/http.ts → checkRobotsTxt)
 *  - Identifiera sig med tydlig user-agent: "FoilioBot/1.0 (+kontakt: hej@foilio.se)"
 *  - Vänta mellan förfrågningar (per-host-fördröjning) och använda exponentiell backoff
 *  - Stoppa automatiskt efter upprepade fel
 *  - ALDRIG kringgå captcha, inloggning eller betalväggar
 *  - ALDRIG samla in personuppgifter
 *  - Lagra rådata separat (PriceObservation.rawData) från normaliserad data
 */
import type { SourceType, StockStatus } from "@prisma/client";

/** Rå produktdata som en adapter hämtat från en källa. Priser i öre. */
export interface RawProductData {
  externalId: string;
  title: string;
  url: string;
  /**
   * Pris i öre (heltal, > 0). Används för prisobservation/historik (t.ex. CM-trend).
   * `null` = PRIS OKÄNT — aldrig 0, aldrig "gratis". Butikerna prissätter osläppta
   * produkter till 0 kr som platshållare (2026-09-04: 26 Shopify-annonser, alla 30th
   * Celebration); tappar vi priset ska annonsen ändå överleva som länk + lagerstatus.
   * En annons utan pris får offer men ALDRIG en PriceObservation. Bara adaptrar som
   * uttryckligen släpper igenom `null` i `validateResult` ger det (Shopify) — övriga
   * kräver fortfarande ett positivt pris.
   */
  price: number | null;
  /**
   * Valfritt pris i öre som ska visas som butikens erbjudande, när det skiljer
   * sig från `price`. För Cardmarket: lägsta annonspris ("From") medan `price`
   * är trend-priset som prishistoriken/grafen bygger på. Saknas → `price` används.
   */
  offerPrice?: number;
  currency: string;
  stockStatus: StockStatus;
  imageUrl?: string;
  category?: string;
  /**
   * Lägg-i-korgen-länk när butikens plattform har en (Shopify, WooCommerce) — se
   * src/lib/cart-url.ts. Adaptern sätter den, aldrig en URL-gissning. Saknas → null.
   */
  cartUrl?: string | null;
  /**
   * true = "butiksvara": går bara att köpa/reservera i butikens FYSISKA butik, inte
   * beställa online (SF-Bok `buttonState` 3/4, Webhallen `web: 0` med butikssaldo).
   * Lagerdomen är oförändrad (butiksvara = IN_STOCK, ägarbeslut 2026-09-17/20) —
   * flaggan är en ETIKETT på larmet så läsaren vet om det är en köpknapp eller en
   * bilresa. Saknas/false = beställningsbar online (eller okänt).
   */
  storeOnly?: boolean;
  /**
   * Hur mycket som står i de FYSISKA butikerna, när källan säger det. Bara
   * meningsfullt tillsammans med `storeOnly` — det är där talet avgör om resan är
   * värd att göra. `null` på ett fält = "vet inte", ALDRIG noll.
   *
   * `locations` namnger butikerna när källan gör det möjligt (Webhallen via
   * `/api/store/se`); SF-Bok ger bara ett totaltal och lämnar den tom. Saknas den
   * står `stores` kvar som ANTAL — ett larm utan namn är sämre, inte trasigt.
   */
  storeStock?: StoreStock | null;
  /**
   * De FYSISKA butikernas lagerläge som ett EGET spår, oberoende av webblagret —
   * bara när källan skiljer dem åt (i dag Webhallen: numeriska butiksnycklar mot `web`).
   * Discord-lanen diffar det separat, så en vara som fylls på BÅDE online och i butik
   * ger ett inlägg i varje kanal (ägarbeslut 2026-09-23). Rör inte `stockStatus`, som
   * DB-vägen läser. Saknas = källan har inget separat butiksspår.
   */
  storeStatus?: StockStatus;
  /**
   * Lägsta medlemsnivå som krävs för att köpa varan (Webhallens `minimumRankLevel`,
   * "Lvl 9+"). null/≤1 = alla kan köpa. Visas i Discord-inlägget — ett larm om en vara
   * man inte får köpa är annars en bilresa i onödan.
   */
  minRankLevel?: number | null;
  /** Oförändrad rådata från källan — lagras i PriceObservation.rawData. */
  raw: unknown;
}

/**
 * Butikssaldot bakom en butiksvara. Alla fält får vara `null` — en källa som bara
 * säger "finns i butik" ska kunna säga just det utan att uppfinna ett tal.
 */
export interface StoreStock {
  /** Antal exemplar totalt i fysiska butiker. null = okänt. */
  units: number | null;
  /** Antal BUTIKER som har minst ett exemplar. null = källan bryter inte ner det. */
  stores: number | null;
  /**
   * Butikerna med saldo, störst först. Tom = källan namnger dem inte (SF-Bok) eller
   * uppslagningen fallerade — då återstår `units`/`stores`.
   * ⛔ ALDRIG ETT GISSAT NAMN. En rad här måste komma från butikens egen
   *    uppslagning; ett påhittat filialnamn skickar folk till fel stad.
   */
  locations?: StoreStockLocation[];
  /**
   * true = minst en butik låg på källans visningstak (Webhallens `displayCap`, 50 =
   * "Fler än 50 st") ⇒ `units` är ett GOLV, inte ett facit, och copyn måste säga
   * "minst". Utan flaggan hade vi publicerat ett exakt tal som är fel nedåt.
   */
  capped: boolean;
  /**
   * Saldo per butiks-id för ALLA butiker källan listar, nollor inräknade (Webhallens
   * numeriska nycklar). Discord-lanen diffar varje butik för sig, så en ny butiks
   * påfyllning postas även när en annan butik redan hade varan. Saknas = källan bryter
   * inte ner per butik.
   */
  byStore?: Record<string, number>;
}

/** En namngiven fysisk butik med saldo. */
export interface StoreStockLocation {
  /** Källans butiks-id (Webhallens numeriska nyckel) — markerar NYA butiker i inlägget. */
  id?: string;
  /** Butikens namn, med ort när den inte framgår av namnet ("Ringen, Stockholm"). */
  label: string;
  /** Antal exemplar i just den butiken. */
  units: number;
  /** true = butiken låg på källans visningstak ⇒ talet är ett golv. */
  capped: boolean;
}

export interface AdapterResult {
  products: RawProductData[];
  errors: string[];
}

/** Normaliserad produktdata, redo för matchning mot Product-katalogen. */
export interface NormalizedProduct {
  normalizedTitle: string;
  /** Öre, > 0 — eller `null` = pris okänt (se RawProductData.price). Aldrig 0. */
  price: number | null;
  /** Erbjudandepris i öre om det skiljer sig från `price` (se RawProductData). */
  offerPrice?: number;
  currency: string;
  stockStatus: StockStatus;
  url: string;
  imageUrl?: string;
  category?: string;
}

/** Kontrakt som varje källadapter implementerar. */
export interface SourceAdapter {
  name: string;
  type: SourceType;
  baseUrl: string;
  supportsSearch: boolean;
  supportsStock: boolean;
  fetchProducts(): Promise<AdapterResult>;
  fetchProductDetails?(externalId: string): Promise<RawProductData | null>;
  normalizeProduct(raw: RawProductData): NormalizedProduct;
  detectStockStatus(raw: unknown): StockStatus;
  extractPrice(raw: unknown): { price: number; currency: string } | null;
  validateResult(p: RawProductData): boolean;
}
