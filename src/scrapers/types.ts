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
  /** Oförändrad rådata från källan — lagras i PriceObservation.rawData. */
  raw: unknown;
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
