/**
 * SfBokAdapter — Science Fiction Bokhandeln (sfbok.se), Pokémon TCG.
 *
 * Probad 2026-09-17. Next.js App Router ovanpå Norce/Storm-backend. robots.txt:
 * `User-Agent: * / Allow: /` (bara Semrush/MJ12 nekas). Priser i SEK inkl. moms.
 *
 * ⛔ KATEGORIN `/sv/spel/samlarkortspel-tcg-ccg/pokemon-trading-card-game` HAR BARA
 *    8 PRODUKTER — butikens egen katalogisering. Hela sortimentet (21 st, inkl. hela
 *    30th Celebration-raden) ligger under UNIVERSUM-listningen med facetten
 *    `GameFamily=Pokémon TCG`. Den hämtas som RSC-flight (`RSC: 1`, ~420 kB) i
 *    stället för HTML (~1 MB) — samma JSON, hälften så tungt, en enda förfrågan.
 *    Svarar servern med HTML ändå (produktobjekten ligger då som `\"`-escapad
 *    sträng i `self.__next_f.push`) avkodas den och parsas likadant.
 *
 * LAGERDOMEN ÄR BUTIKENS EGEN — `webDisplay` (mätt över 107 Pokémon-produkter):
 *   buttonState 0  → "Lägg i varukorg" online (även restnoterad "kan fortfarande
 *                    beställas": canBackorder) ⇒ IN_STOCK
 *   buttonState 3/4 → "butiksvara — kan endast köpas i våra fysiska butiker":
 *                    lager > 0 ⇒ IN_STOCK (går att RESERVERA I BUTIK — ägarbeslut
 *                    2026-09-17: butikens drop är en drop), annars OUT_OF_STOCK
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
const LIST_URL = `${BASE_URL}/sv/universum/pokemon?GameFamily=Pok%C3%A9mon+TCG`;

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

interface SfBokVariant {
  skuCode?: string;
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

export class SfBokAdapter implements SourceAdapter {
  name = "SF-Bok";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    let body: string;
    try {
      const res = await politeFetch(LIST_URL, { delayMs: 1000, headers: { RSC: "1" } });
      if (!res.ok) return { products, errors: [`${this.name}: HTTP ${res.status} ${LIST_URL}`] };
      body = await res.text();
    } catch (err) {
      return { products, errors: [`${this.name}: ${err instanceof Error ? err.message : String(err)}`] };
    }

    const parsed = parseSfBokProducts(body);
    if (parsed.length === 0) {
      // Tom lista = "vi kan inte läsa sidan", aldrig "allt försvann". Ett fel gör att
      // anroparen behåller förra lagerläget (se runner/lanen) i stället för att nolla.
      errors.push(`${this.name}: 0 produktobjekt i svaret (${body.length} tecken) — markupen har troligen ändrats.`);
      return { products, errors };
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
      const { stock, storeOnly } = sfbokStock({
        buttonState: p.webDisplay?.buttonState,
        isPreOrder: p.webDisplay?.isPreOrder,
        stockQuantity: v.stockQuantity,
      });
      const ean = p.attributes?.find((a) => a.identifier === "ean")?.value?.trim() || null;
      const imageUrl = v.images?.find((i) => i.url)?.url ?? p.images?.find((i) => i.url)?.url ?? undefined;
      const raw: SfBokRaw = {
        identifier: p.identifier,
        priceOre,
        stock,
        buttonState: p.webDisplay?.buttonState ?? null,
        stockQuantity: v.stockQuantity ?? null,
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
        // ⛔ SF-Bok ger ETT totaltal, ingen nedbrytning per butik — `stores: null`
        //    betyder "vet inte", och copyn skriver då bara antalet exemplar.
        storeStock:
          typeof v.stockQuantity === "number" && v.stockQuantity > 0
            ? { units: v.stockQuantity, stores: null, capped: false }
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
