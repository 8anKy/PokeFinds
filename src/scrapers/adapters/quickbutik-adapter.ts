/**
 * QuickbutikAdapter — återanvändbar adapter för Quickbutik-butiker (svensk
 * e-com-plattform). Hämtar Pokémon-kategorisidor (server-renderad HTML) och
 * extraherar produkt-titel/pris/lager/URL ur produktblocken.
 *
 * Upptäckt: sitemap.xml listar /pokemon/{kategori}-sidor. Varje produktblock har
 *   <a class="block px-6 mb-4" href="/{kat}/{slug}"> … <h3>Titel</h3>
 *   <span class="… text-accent">2 099 kr</span>
 *   köpknapp ELLER sold-out-länk area-label="Ej tillgänglig".
 *
 * Konkreta butiker = tunna subklasser längst ner (sätter name + baseUrl).
 * ETIK: politeFetch (robots.txt, delay, FoilioBot UA, backoff).
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

const MAX_CATEGORIES = 18;
const MAX_PAGES_PER_CATEGORY = 4;

// Fallback-parsern plockar upp korsförsäljnings-hrefs → singel-URL:er kan smita in och
// fel-länkas till en sealed katalogprodukt (t.ex. "Blastoise 1-Pack Blister" bunden till
// ett Blastoise-singelkort). Singlar prissätts via Cardmarket, aldrig via butik → släng dem.
const SINGLE_URL = /\/singles(?:-and-graded-cards)?\//i;

/** Ska en Quickbutik-annons släppas? (singel-URL fel-länkas till sealed). Ren → testbar. */
export function qbShouldDrop(url: string): boolean {
  return SINGLE_URL.test(url);
}

function parseSekPrice(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "").replace(/kr|sek/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/booster\s*(box|display)/.test(t)) return "BOOSTER_BOX";
  if (/elite\s*trainer|\betb\b/.test(t)) return "ETB";
  if (/booster\s*bundle/.test(t)) return "BUNDLE";
  if (/booster\s*pack|booster\b/.test(t)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/.test(t)) return "COLLECTION_BOX";
  if (/\btin\b/.test(t)) return "TIN";
  if (/blister/.test(t)) return "BLISTER";
  if (/bundle/.test(t)) return "BUNDLE";
  return "OTHER";
}

interface QbRaw {
  title: string;
  priceOre: number;
  url: string;
  inStock: boolean;
}
function isQbRaw(raw: unknown): raw is QbRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "inStock" in raw;
}

export abstract class QuickbutikAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // t.ex. "https://www.swepoke.se"
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Pokémon-kategorisidor (2-segments-vägar /pokemon/{kat}) ur sitemap. */
  protected async pokemonCategories(errors: string[]): Promise<string[]> {
    const res = await politeFetch(`${this.baseUrl}/sitemap.xml`, { delayMs: 1000 });
    if (!res.ok) {
      errors.push(`${this.name}: sitemap HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const host = new URL(this.baseUrl).host;
    const locs = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
    const cats = new Set<string>();
    for (const loc of locs) {
      const url = loc.replace(/<\/?loc>/g, "").trim();
      let path: string;
      try {
        path = new URL(url).pathname;
      } catch {
        continue;
      }
      // /pokemon/{kategori} (exakt 2 segment) = kategorisida (ej produkt /{...}/{...}/...).
      // Hoppa över singel-/graderat-/tillbehörs-kategorier — vi prissätter singlar
      // via Cardmarket och bryr oss om sealed för restock. Snabbare + politare.
      if (/^\/pokemon\/[^/]+\/?$/.test(path) && url.includes(host) && !/singles|graded|loose|l[oö]sa|tillbeh|accessor|sleeve|binder|playmat|spelmatt|deck-?box/i.test(path)) {
        cats.add(url.split("?")[0]);
      }
    }
    return Array.from(cats).slice(0, MAX_CATEGORIES);
  }

  protected parseProducts(html: string): QbRaw[] {
    // Primärt: Quickbutiks produktwrapper med data-attribut (tema-oberoende):
    //   <div ... data-pid="N" data-s-price="1399" data-s-title="…">
    const byData: QbRaw[] = [];
    const dblocks = html.split(/data-pid="/);
    for (let i = 1; i < dblocks.length; i++) {
      const block = dblocks[i].slice(0, 6000);
      const priceM = block.match(/data-s-price="([0-9]+(?:\.[0-9]+)?)"/);
      const titleM = block.match(/data-s-title="([^"]+)"/);
      if (!priceM || !titleM) continue;
      const priceOre = Math.round(parseFloat(priceM[1]) * 100);
      if (!priceOre || priceOre <= 0) continue;
      const href = block.match(/href="(\/pokemon\/[a-z0-9-]+\/[a-z0-9-]+)"/i)?.[1];
      if (!href) continue;
      const title = titleM[1].replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
      const soldOut = /Ej tillgänglig|Slutsåld|Sold out|Bevaka|Meddela mig/i.test(block);
      const inStock = !soldOut && /Lägg i|>\s*I lager|text-success/i.test(block);
      byData.push({ title, priceOre, url: `${this.baseUrl}${href}`, inStock });
    }
    if (byData.length > 0) return byData;

    // Fallback (äldre tema): titel-länk + h3 + text-accent-pris.
    const out: QbRaw[] = [];
    // Dela på titel-länken (en per produkt). Varje segment = [href, h3, pris, köpknapp, nästa bild-länk].
    const parts = html.split(/class="block px-6 mb-4"\s+href="/);
    for (let i = 1; i < parts.length; i++) {
      // Klipp av segmentet vid nästa produkts bild-länk så vi inte läser fel pris/lager.
      const seg = parts[i].split(/class="block relative w-full/)[0];
      const href = seg.slice(0, seg.indexOf('"'));
      if (!href.startsWith("/") || (href.match(/\//g) ?? []).length < 2) continue; // /{kat}/{slug}
      const titleRaw = seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
      const title = titleRaw?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const priceM = seg.match(/text-accent[^>]*>\s*([0-9][\d\s .,]*)\s*kr/i);
      if (!priceM) continue;
      const priceOre = parseSekPrice(priceM[1]);
      if (!priceOre) continue;
      const soldOut = /Ej tillgänglig|area-label="Ej/i.test(seg);
      out.push({ title, priceOre, url: `${this.baseUrl}${href}`, inStock: !soldOut });
    }
    return out;
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    try {
      const categories = await this.pokemonCategories(errors);
      for (const cat of categories) {
        for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
          const url = page === 1 ? cat : `${cat}?page=${page}`;
          const res = await politeFetch(url, { delayMs: 900 });
          if (!res.ok) {
            if (page === 1) errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          const html = await res.text();
          const found = this.parseProducts(html);
          if (found.length === 0) break;
          let added = 0;
          for (const item of found) {
            if (seen.has(item.url)) continue;
            seen.add(item.url);
            // Singel-URL:er (fel-länkas till sealed) filtreras bort.
            if (qbShouldDrop(item.url)) continue;
            added++;
            products.push({
              externalId: `${this.idPrefix}-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
              title: item.title,
              url: item.url,
              price: item.priceOre,
              currency: "SEK",
              stockStatus: item.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
              category: guessCategory(item.title),
              raw: item,
            });
          }
          if (added === 0) break; // ingen ny produkt → sista sidan
        }
      }
    } catch (err) {
      errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { products, errors };
  }

  protected get idPrefix(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    if (isQbRaw(raw)) return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isQbRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

export class SwepokeAdapter extends QuickbutikAdapter {
  name = "Swepoke";
  baseUrl = "https://www.swepoke.se";
}
export class ShinycardsAdapter extends QuickbutikAdapter {
  name = "Shinycards";
  baseUrl = "https://www.shinycards.se";
}
