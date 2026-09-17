/**
 * WorldOfBoardGamesAdapter — worldofboardgames.com (Umeå), Pokémon TCG.
 *
 * Probad 2026-09-17. Egen PHP-butik, server-renderad. robots.txt = två rader
 * (`User-agent: *` + Sitemap), inga Disallow. SEK.
 *
 * ⛔ KATEGORIN `/sallskapsspel/pokemon_tcg/` VAR TOM VID PROBEN. Sajtens sök listade
 *    501 Pokémon TCG-produkter, ALLA med status "Utgått" (butikens egen definition:
 *    "har utgått … inte troligt att vi kommer få in produkten igen") — inklusive
 *    Mega Evolution, Ascended Heroes, och ingen 30th Celebration alls på släppdagen.
 *    Kategorisidan visar bara produkter som INTE är utgångna, så ett släpp syns som
 *    en NY URL i kategorin (lanen postar en ny URL i lager/förhandsbokning). Sökningen
 *    (`/sok/pokemon`, 1,7 MB, 907 kort) används med flit INTE — kategorin är 64 kB.
 *    (⛔ `/kortspel/pokemon_tcg/` finns också men är alltid tom — brödsmulan på
 *    produktsidorna pekar på `/sallskapsspel/…`.)
 *
 * Kortet (`<div class="product-item"`) bär EN knapp, och knappen är domen (mätt över
 * 907 sökträffar):
 *   `class="button … add-to-cart"` "Köp" (grön 1–3 dagar / gul 7–10 dagar) ⇒ IN_STOCK
 *   `preorder.php?…`  "Boka"  (title "Kommande produkt")                   ⇒ PREORDER
 *   `gametip.php?…`   "Bevaka" (title "Tillfälligt slut")                  ⇒ OUT_OF_STOCK
 *   `product_status.php?productStatusTypeID=3` "Utgått"                   ⇒ OUT_OF_STOCK
 *   `product_status.php?productStatusTypeID=5` "Kommande" (ej beställbar)  ⇒ OUT_OF_STOCK
 *   ingen känd knapp                                                       ⇒ UNKNOWN
 * Paginering: 40 kort/sida, `/{offset}/` (`/40/`, `/80/` …).
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

const BASE_URL = "https://www.worldofboardgames.com";
const CATEGORY_PATH = "/sallskapsspel/pokemon_tcg/";
const PAGE_SIZE = 40;
const MAX_PAGES = 10;
const PAGE_DELAY_MS = 1500;

export type WobgStock = "in" | "preorder" | "out" | "unknown";

export interface WobgRaw {
  priceOre: number | null;
  stock: WobgStock;
  button: string;
  url: string;
  itemId: string | null;
}

function isWobgRaw(raw: unknown): raw is WobgRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw && "url" in raw;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** Knappens markup → dom. Ren funktion — testad. */
export function wobgStockFromButton(buttonHtml: string | null): WobgStock {
  if (!buttonHtml) return "unknown";
  if (/\badd-to-cart\b/.test(buttonHtml)) return "in";
  if (/preorder\.php/.test(buttonHtml)) return "preorder";
  if (/gametip\.php|product_status\.php/.test(buttonHtml)) return "out";
  return "unknown";
}

export interface WobgItem {
  title: string;
  url: string;
  priceOre: number | null;
  stock: WobgStock;
  button: string;
  itemId: string | null;
  imageUrl?: string;
}

export function parseWobgListing(html: string): WobgItem[] {
  const out: WobgItem[] = [];
  const cards = html.split(/<div class="product-item"/).slice(1);
  for (const c of cards) {
    const card = c.slice(0, 6000);
    const link = card.match(/<a href="(https:\/\/www\.worldofboardgames\.com\/[^"]+)" title="([^"]*)"/);
    if (!link) continue;
    const url = link[1].split("#")[0];
    const title = decodeEntities(link[2]).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const priceM = card.match(/<strong>\s*([\d\s.,]+)\s*kr/);
    const priceKr = priceM ? parseFloat(priceM[1].replace(/[\s.]/g, "").replace(",", ".")) : NaN;
    const priceOre = Number.isFinite(priceKr) && priceKr > 0 ? Math.round(priceKr * 100) : null;
    // Knappen sitter sist i kortet: <a href="…" class="… button …" …>Köp|Boka|Bevaka|Utgått</a>
    const btn = card.match(/<a\b[^>]*class="[^"]*\bbutton\b[^"]*"[^>]*>[^<]*<\/a>/);
    const button = btn?.[0] ?? "";
    const itemId = button.match(/data-itemid="(\d+)"|webshopChildItemID=(\d+)/);
    const img = card.match(/<img[^>]*src="(https:\/\/www\.worldofboardgames\.com\/product_images\/[^"]+)"/);
    out.push({
      title,
      url,
      priceOre,
      stock: wobgStockFromButton(btn ? button : null),
      button: button.slice(0, 200),
      itemId: itemId?.[1] ?? itemId?.[2] ?? null,
      imageUrl: img?.[1],
    });
  }
  return out;
}

const STATUS_BY_STOCK: Record<WobgStock, StockStatus> = {
  in: StockStatus.IN_STOCK,
  preorder: StockStatus.PREORDER,
  out: StockStatus.OUT_OF_STOCK,
  unknown: StockStatus.UNKNOWN,
};

export class WorldOfBoardGamesAdapter implements SourceAdapter {
  name = "World of Board Games";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${BASE_URL}${CATEGORY_PATH}${page > 0 ? `${page * PAGE_SIZE}/` : ""}`;
      let html: string;
      try {
        const res = await politeFetch(url, { delayMs: PAGE_DELAY_MS });
        if (!res.ok) {
          errors.push(`${this.name}: HTTP ${res.status} ${url}`);
          break;
        }
        html = await res.text();
      } catch (err) {
        errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      const items = parseWobgListing(html);
      if (items.length === 0) {
        // Sida 0 tom = kategorin är tom just nu (alla Pokémon-produkter utgångna) —
        // det är ett sant tillstånd, inte ett fel. Sidan säger det själv.
        if (page === 0 && !/inga tr[äa]ffar/i.test(html)) {
          errors.push(`${this.name}: 0 kort OCH ingen "inga träffar"-text — markupen har troligen ändrats.`);
        }
        break;
      }
      let added = 0;
      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        if (!/pok[eé]mon/i.test(item.title) && !/tcg/i.test(item.title)) continue;
        added++;
        const raw: WobgRaw = { priceOre: item.priceOre, stock: item.stock, button: item.button, url: item.url, itemId: item.itemId };
        products.push({
          externalId: item.itemId ? `wobg-${item.itemId}` : `wobg-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
          title: item.title,
          url: item.url,
          price: item.priceOre,
          currency: "SEK",
          stockStatus: STATUS_BY_STOCK[item.stock],
          imageUrl: item.imageUrl,
          category: guessListingCategory(item.title),
          raw,
        });
      }
      if (added === 0 || items.length < PAGE_SIZE) break;
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
    if (isWobgRaw(raw)) return STATUS_BY_STOCK[raw.stock] ?? StockStatus.UNKNOWN;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isWobgRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
