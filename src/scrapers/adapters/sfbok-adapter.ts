/**
 * SfBokAdapter — Science Fiction Bokhandeln (sfbok.se), Pokémon TCG.
 *
 * Probad 2026-09-17. Next.js App Router ovanpå Norce/Storm-backend. robots.txt:
 * `User-Agent: * / Allow: /` (bara Semrush/MJ12 nekas). Priser i SEK inkl. moms.
 *
 * ⛔ TVÅ LISTNINGAR, UNIONEN PÅ `identifier` (2026-10-02). En vara syns på butikens sajt
 *    via sin GameFamily-tagg ELLER sin kategori — så vi läser båda:
 *      1. `/sv/spel?GameFamily=Pokémon TCG` — hela spelavdelningen, oavsett kategori
 *         (ETB:er ligger i föräldern, SPC/ETB ibland under brädspel).
 *      2. `/sv/spel/samlarkortspel-tcg-ccg/pokemon-trading-card-game` — Pokémon-kategorin,
 *         för en ny vara som butiken glömt GameFamily-taggen på.
 *    ⛔ ALDRIG `/sv/universum/pokemon?GameFamily=…` (som vi läste t.o.m. 2026-10-02): den
 *    kräver ÄVEN attributet Universe, och butikens NYA poster saknar det — 30th Celebration
 *    Mini Tin (280 ex i butik) och Booster Bundle syntes aldrig, varken i Discord eller i
 *    katalogen. Listning 1 gav 22 mot 14, en strikt överordnad mängd.
 *    ⛔ PAGINERAS (`?page=N`, 60 per sida) tills `totalHits` är nått eller en sida inte ger
 *    något nytt — `hasMoreProducts` i flighten är OPÅLITLIG (står `true` även på sista sidan).
 *    ⛔ FALLER EN ENDA SIDA blir hela hämtningen ett fel utan produkter: en halv lista hade
 *    fått lanen att se varor "försvinna" och sedan "komma tillbaka" som påfyllningar.
 *    Hämtas som RSC-flight (`RSC: 1`, ~490 kB) i stället för HTML (~1 MB) — samma JSON.
 *    Svarar servern med HTML ändå (produktobjekten ligger då som `\"`-escapad
 *    sträng i `self.__next_f.push`) avkodas den och parsas likadant.
 *
 * LAGERDOMEN ÄR BUTIKENS EGEN — `webDisplay` (mätt över 107 Pokémon-produkter):
 *   buttonState 0  → "Lägg i varukorg" online (även restnoterad "kan fortfarande
 *                    beställas": canBackorder) ⇒ IN_STOCK
 *   buttonState 3/4 → "butiksvara — kan endast köpas i våra fysiska butiker":
 *                    BUTIKSLAGER > 0 ⇒ IN_STOCK (går att RESERVERA I BUTIK — ägarbeslut
 *                    2026-09-17: butikens drop är en drop), annars OUT_OF_STOCK
 * ⛔ `stockQuantity` ÄR INTE BUTIKSLAGRET (2026-10-02): det är summan av ALLA lager i
 *    `warehouseInventories`, centrallagret (`isPrimaryWarehouse`, kod "1") inräknat.
 *    30th Celebration Mini Tin på släppdagen: 280 i centrallagret, 0 i var och en av
 *    butikerna S010–S040 ⇒ vi larmade "280 ex i butik" om en vara ingen butik hade.
 *    Butikslagret = summan av de icke-primära lagren (`sfbokStoreStock`).
 *   buttonState 2  → "Bevaka" (ej utgiven / osäkert leveransdatum) ⇒ OUT_OF_STOCK,
 *                    utom isPreOrder=true ⇒ PREORDER (bokningsbar)
 *   annat          → UNKNOWN
 * ⛔ HELA POKÉMON TCG-SORTIMENTET VAR BUTIKSVARA VID PROBEN ("går inte att beställa
 *    via hemsidan, kan inte förhandsbokas, max 3 ex per kund"). Ett IN_STOCK härifrån
 *    betyder alltså oftast "finns i en fysisk butik, reservera" — inte en köpknapp.
 *
 * Produkt-URL = `${canonicalCategoryPath}/${identifier}/${slug}` (verifierat 200).
 * EAN finns i `attributes[identifier=ean]` — sparas i raw för framtida GTIN-bruk.
 */
import { StockStatus, SourceType } from "@prisma/client";
import { politeFetch } from "../http";
import { normalizeTitle } from "../../lib/utils";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";
import { guessListingCategory } from "../listing-category";

const BASE_URL = "https://www.sfbok.se";
const LIST_URLS = [
  `${BASE_URL}/sv/spel?GameFamily=Pok%C3%A9mon+TCG`,
  `${BASE_URL}/sv/spel/samlarkortspel-tcg-ccg/pokemon-trading-card-game`,
];
const PAGE_SIZE = 60;
/** Skyddsräcke mot en loop som aldrig tar slut — 600 Pokémon-varor är ~25× dagens sortiment. */
const MAX_PAGES = 10;

export type SfBokStock = "in" | "out" | "preorder" | "unknown";

export interface SfBokRaw {
  identifier: string;
  priceOre: number | null;
  stock: SfBokStock;
  buttonState: number | null;
  stockQuantity: number | null;
  /** true = "butiksvara": kan bara köpas/reserveras i fysisk butik. */
  storeOnly: boolean;
  ean: string | null;
  url: string;
}

function isSfBokRaw(raw: unknown): raw is SfBokRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw && "url" in raw;
}

interface SfBokWarehouse {
  warehouseCode?: string;
  quantity?: number | null;
  isPrimaryWarehouse?: boolean;
}

interface SfBokVariant {
  skuCode?: string;
  warehouseInventories?: SfBokWarehouse[];
  displayName?: string;
  slug?: string;
  isPublished?: boolean;
  stockStatus?: number;
  stockQuantity?: number | null;
  price?: { currency?: string; bestPriceInclVat?: number | null };
  images?: { url?: string | null }[];
}

interface SfBokProduct {
  identifier: string;
  displayName: string;
  slug?: string;
  canonicalCategoryPath?: string;
  gameFamilyName?: string | null;
  attributes?: { identifier?: string; value?: string }[];
  images?: { url?: string | null }[];
  variants?: SfBokVariant[];
  webDisplay?: {
    isVisible?: boolean;
    buttonState?: number;
    isPreOrder?: boolean;
    canBackorder?: boolean;
    isBackorder?: boolean;
  };
}

/**
 * Lagerdom ur butikens egen `webDisplay`, se filhuvudet. Ren funktion — testad.
 */
export function sfbokStock(input: {
  buttonState: number | null | undefined;
  isPreOrder?: boolean;
  stockQuantity: number | null | undefined;
}): { stock: SfBokStock; storeOnly: boolean } {
  const qty = input.stockQuantity ?? 0;
  switch (input.buttonState) {
    case 0:
      return { stock: "in", storeOnly: false };
    case 3:
    case 4:
      return { stock: qty > 0 ? "in" : "out", storeOnly: true };
    case 2:
      return { stock: input.isPreOrder ? "preorder" : "out", storeOnly: false };
    default:
      return { stock: "unknown", storeOnly: false };
  }
}

/**
 * Exemplar i de FYSISKA butikerna = de icke-primära lagren (S010–S040); centrallagret
 * (`isPrimaryWarehouse`) är webblagret och räknas aldrig. Saknas uppdelningen faller vi
 * tillbaka på `stockQuantity` (totalen) med okänt butiksantal — samma som före 2026-10-02.
 */
export function sfbokStoreStock(v: {
  stockQuantity?: number | null;
  warehouseInventories?: SfBokWarehouse[] | null;
}): { units: number | null; stores: number | null } {
  const stores = (v.warehouseInventories ?? []).filter((w) => w.isPrimaryWarehouse === false);
  if (stores.length === 0) {
    return { units: typeof v.stockQuantity === "number" ? v.stockQuantity : null, stores: null };
  }
  const qty = stores.map((w) => (typeof w.quantity === "number" && w.quantity > 0 ? w.quantity : 0));
  return { units: qty.reduce((a, b) => a + b, 0), stores: qty.filter((q) => q > 0).length };
}

/**
 * Plockar ut produktobjekten ur en RSC-flight eller HTML-sida. Objekten känns igen
 * på `{"identifier":"<siffror>","displayName":"` och klipps ut med en klammer-
 * matchare som respekterar strängar — JSON.parse gör resten. Ett objekt som inte
 * går att tolka hoppas över; ett fel i markupen ska aldrig fälla hela hämtningen.
 */
export function parseSfBokProducts(body: string): SfBokProduct[] {
  const text = body.includes("self.__next_f.push") ? body.replace(/\\"/g, '"') : body;
  const out = new Map<string, SfBokProduct>();
  const re = /\{"identifier":"(\d+)","displayName":"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let k = start; k < text.length; k++) {
      const c = text[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as SfBokProduct;
      if (obj.identifier && obj.displayName && Array.isArray(obj.variants)) out.set(obj.identifier, obj);
    } catch {
      /* trasigt objekt — hoppa */
    }
    re.lastIndex = end;
  }
  return [...out.values()];
}

/** Butikens eget totaltal för listningen, eller null om det inte står i svaret. */
export function parseSfBokTotalHits(body: string): number | null {
  const m = body.match(/\\?"totalHits\\?":(\d+)/);
  return m ? Number(m[1]) : null;
}

export function sfbokPageUrl(url: string, page: number): string {
  if (page <= 1) return url;
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

/**
 * Läser alla listningar, alla sidor, och slår ihop på `identifier`. Ren bortsett från
 * `fetchBody` (injiceras — testad utan nät). Kastar om en sida inte går att hämta, eller
 * om en listnings FÖRSTA sida saknar produktobjekt: då vet vi inte vad som finns, och
 * anroparen ska behålla förra lagerläget hellre än att rapportera en halv lista.
 */
export async function collectSfBokProducts(
  urls: string[],
  fetchBody: (url: string) => Promise<string>
): Promise<{ products: SfBokProduct[]; warnings: string[] }> {
  const all = new Map<string, SfBokProduct>();
  const warnings: string[] = [];
  for (const url of urls) {
    const seen = new Set<string>();
    let total: number | null = null;
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      const body = await fetchBody(sfbokPageUrl(url, page));
      const parsed = parseSfBokProducts(body);
      if (page === 1) {
        if (parsed.length === 0) {
          throw new Error(`0 produktobjekt i ${url} (${body.length} tecken) — markupen har troligen ändrats.`);
        }
        total = parseSfBokTotalHits(body);
      }
      let added = 0;
      for (const p of parsed) {
        if (seen.has(p.identifier)) continue;
        seen.add(p.identifier);
        added++;
        if (!all.has(p.identifier)) all.set(p.identifier, p);
      }
      if (added === 0) break;
      if (total !== null && page * PAGE_SIZE >= total) break;
    }
    if (page > MAX_PAGES) warnings.push(`${url}: sidtaket ${MAX_PAGES} nått (${seen.size} lästa) — höj MAX_PAGES.`);
  }
  return { products: [...all.values()], warnings };
}

export class SfBokAdapter implements SourceAdapter {
  name = "SF-Bok";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    let parsed: SfBokProduct[];
    try {
      const out = await collectSfBokProducts(LIST_URLS, async (url) => {
        const res = await politeFetch(url, { delayMs: 1000, headers: { RSC: "1" } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        return res.text();
      });
      parsed = out.products;
      for (const w of out.warnings) console.warn(`[sfbok] ${w}`);
    } catch (err) {
      // Ett fel gör att anroparen behåller förra lagerläget (se runner/lanen) i stället
      // för att nolla — samma väg som en tom lista alltid tagit.
      return { products, errors: [`${this.name}: ${err instanceof Error ? err.message : String(err)}`] };
    }

    for (const p of parsed) {
      if (p.gameFamilyName && !/pok[eé]mon/i.test(p.gameFamilyName)) continue;
      if (!/pok[eé]mon/i.test(p.displayName) && !/tcg/i.test(p.displayName)) continue;
      const v = p.variants?.[0];
      if (!v || v.isPublished === false || p.webDisplay?.isVisible === false) continue;
      const slug = v.slug ?? p.slug;
      if (!slug || !p.canonicalCategoryPath) continue;
      const url = `${BASE_URL}${p.canonicalCategoryPath}/${p.identifier}/${slug}`;
      const price = v.price?.bestPriceInclVat;
      const priceOre =
        typeof price === "number" && Number.isFinite(price) && price > 0 && (v.price?.currency ?? "SEK") === "SEK"
          ? Math.round(price * 100)
          : null;
      const inStores = sfbokStoreStock(v);
      const { stock, storeOnly } = sfbokStock({
        buttonState: p.webDisplay?.buttonState,
        isPreOrder: p.webDisplay?.isPreOrder,
        stockQuantity: inStores.units,
      });
      const ean = p.attributes?.find((a) => a.identifier === "ean")?.value?.trim() || null;
      const imageUrl = v.images?.find((i) => i.url)?.url ?? p.images?.find((i) => i.url)?.url ?? undefined;
      const raw: SfBokRaw = {
        identifier: p.identifier,
        priceOre,
        stock,
        buttonState: p.webDisplay?.buttonState ?? null,
        stockQuantity: inStores.units,
        storeOnly,
        ean,
        url,
      };
      products.push({
        externalId: `sfbok-${p.identifier}`,
        title: p.displayName.replace(/\s+/g, " ").trim(),
        url,
        price: priceOre,
        currency: "SEK",
        stockStatus: STATUS_BY_STOCK[stock],
        imageUrl: imageUrl ?? undefined,
        category: guessListingCategory(p.displayName),
        storeOnly,
        // ⛔ Butikerna är namnlösa lagerkoder (S010…) — antal butiker, aldrig ett namn.
        storeStock:
          storeOnly && inStores.units !== null && inStores.units > 0
            ? { units: inStores.units, stores: inStores.stores, capped: false }
            : null,
        raw,
      });
    }
    return { products, errors };
  }

  normalizeProduct(raw: RawProductData): NormalizedProduct {
    return {
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      imageUrl: raw.imageUrl,
      category: raw.category,
    };
  }

  detectStockStatus(raw: unknown): StockStatus {
    if (isSfBokRaw(raw)) return STATUS_BY_STOCK[raw.stock] ?? StockStatus.UNKNOWN;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isSfBokRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      p.price !== null &&
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}

const STATUS_BY_STOCK: Record<SfBokStock, StockStatus> = {
  in: StockStatus.IN_STOCK,
  out: StockStatus.OUT_OF_STOCK,
  preorder: StockStatus.PREORDER,
  unknown: StockStatus.UNKNOWN,
};
