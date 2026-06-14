/**
 * SpelexpertenAdapter — scraper för spelexperten.com (Pokémon TCG-produkter).
 *
 * robots.txt verifierad 2026-06-11: produktsidor tillåtna.
 * Hämtar produktkategori-sidor, extraherar titel/pris/lager/URL.
 *
 * ETIK: politeFetch (robots.txt, crawl-delay, PokeFindsBot UA, backoff).
 * Inga captcha-bypass, inga inloggningar, inga personuppgifter.
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

const BASE_URL = "https://www.spelexperten.com";

// Spelexperten Pokémon-kategori (verifierad 2026-06-11, ~32 produkter/sida, ?page=N)
const CATEGORY_URLS = [
  "/sallskapsspel/pokemon/",
];

interface SpelexpertenRaw {
  title: string;
  priceText: string;
  priceOre: number;
  url: string;
  inStock: boolean;
  imageUrl?: string;
}

function isSpelexpertenRaw(raw: unknown): raw is SpelexpertenRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "url" in raw;
}

/**
 * Extraherar pris i öre från en pristext som "79,00 kr" eller "2 499,00 kr".
 */
function parseSekPrice(text: string): number | null {
  // Ta bort mellanslag, "kr", "SEK", etc. och normalisera kommatecken
  const cleaned = text.replace(/\s/g, "").replace(/kr|SEK/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100); // SEK → öre
}

/**
 * Enkel HTML-extraktion utan DOM-parser (verifierad mot sidan 2026-06-11).
 *
 * Spelexperten (iButik) renderar produktkort där:
 *  - titel + produkt-URL ligger i <div class="PT_Beskr ..."><a href="..." title="...">Titel</a></div>
 *  - priset ligger i <span class="PT_PrisNormal ...">749 kr</span>
 *  - köpknappen (class="buy-button") finns bara för köpbara produkter
 */
function extractProducts(html: string, _pageUrl: string): SpelexpertenRaw[] {
  const products: SpelexpertenRaw[] = [];

  // Splitta på produktbeskrivnings-blocket — varje produkt har exakt ett PT_Beskr
  const blocks = html.split(/class="PT_Beskr/i);

  for (let i = 1; i < blocks.length; i++) {
    // Blocket sträcker sig fram till nästa produkt (eller sidslut)
    const block = blocks[i].slice(0, 4000);

    // Titel och URL: <a href="/sallskapsspel/pokemon/....html" title="Titel">Titel</a>
    const linkMatch = block.match(/<a href="(\/[^"]+\.html)" title="([^"]+)">/);
    if (!linkMatch) continue;
    const url = linkMatch[1];
    const title = linkMatch[2].trim();
    if (!title || !url) continue;

    // Pris: <span class="PT_PrisNormal ...">749 kr</span> (ev. kampanjpris i PT_PrisKampanj)
    const priceMatch = block.match(/PT_Pris[A-Za-z]*[^>]*>\s*([\d\s.,]+)\s*kr/);
    if (!priceMatch) continue;
    const priceOre = parseSekPrice(priceMatch[1]);
    if (!priceOre) continue;

    // Lagerstatus: köpknapp = köpbar; "Bevaka"/"Slutsåld" = slut
    const inStock = /buy-button/i.test(block) && !/slutsåld|ej i lager|bevaka/i.test(block);

    // Bild: produktbilden renderas FÖRE PT_Beskr, dvs. i slutet av föregående block
    const prevTail = blocks[i - 1].slice(-3000);
    const imgMatches = prevTail.match(/(?:data-src|src)="(\/(?:img\/)?bilder\/artiklar\/[^"?]+)/g);
    const lastImg = imgMatches?.[imgMatches.length - 1]?.match(/"(\/[^"?]+)/)?.[1];
    const imageUrl = lastImg ? `${BASE_URL}${lastImg}` : undefined;

    products.push({
      title,
      priceText: priceMatch[0],
      priceOre,
      url: `${BASE_URL}${url}`,
      inStock,
      imageUrl,
    });
  }

  return products;
}

function guessCategory(title: string): string {
  const lower = title.toLowerCase();
  if (/booster\s*(box|display)/i.test(lower)) return "BOOSTER_BOX";
  if (/elite\s*trainer/i.test(lower) || /etb/i.test(lower)) return "ETB";
  if (/booster\s*bundle/i.test(lower)) return "BUNDLE";
  if (/booster\s*pack|booster\b/i.test(lower)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/i.test(lower)) return "COLLECTION_BOX";
  if (/tin\b/i.test(lower)) return "TIN";
  if (/blister/i.test(lower)) return "BLISTER";
  if (/bundle/i.test(lower)) return "BUNDLE";
  return "OTHER";
}

export class SpelexpertenAdapter implements SourceAdapter {
  name = "Spelexperten";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];

    for (const categoryPath of CATEGORY_URLS) {
      try {
        // Hämta sida 1 (och eventuellt fler sidor)
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 10) {
          const url = `${BASE_URL}${categoryPath}${page > 1 ? `?page=${page}` : ""}`;
          const res = await politeFetch(url, { delayMs: 2000 });
          if (!res.ok) {
            errors.push(`HTTP ${res.status} från ${url}`);
            break;
          }
          const html = await res.text();
          const found = extractProducts(html, url);
          if (found.length === 0) {
            hasMore = false;
            break;
          }
          for (const item of found) {
            const category = guessCategory(item.title);
            // Filtrera bort icke-Pokémon-produkter
            if (!/pok[eé]mon/i.test(item.title) && !/tcg/i.test(item.title)) continue;

            products.push({
              externalId: `spelexperten-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
              title: item.title,
              url: item.url,
              price: item.priceOre,
              currency: "SEK",
              stockStatus: item.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
              imageUrl: item.imageUrl,
              category,
              raw: item,
            });
          }
          page++;
          // Om sidan inte har "nästa"-länk, sluta
          if (!html.includes(`?page=${page}`)) {
            hasMore = false;
          }
        }
      } catch (err) {
        errors.push(
          `Spelexperten-kategori ${categoryPath}: ${err instanceof Error ? err.message : err}`
        );
      }
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
    if (isSpelexpertenRaw(raw)) {
      return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isSpelexpertenRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}
