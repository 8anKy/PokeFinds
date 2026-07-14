/**
 * ShopifyAdapter — återanvändbar adapter för Shopify-butiker (svenska Pokémon-
 * shoppar). Hämtar produkter + lagerstatus via det publika JSON-API:t:
 *   /collections.json              → hitta Pokémon-kollektioner
 *   /collections/{handle}/products.json → produkter (titel, pris, variant.available)
 *
 * EN bulk-JSON-hämtning ger pris + lager för hela Pokémon-katalogen → billigt nog
 * att polla ofta för restock-alerts. robots.txt tillåter products.json/collections
 * (verifierat 2026-06-14; endast sort_by- och recommendations-vägar är Disallow).
 *
 * Konkreta butiker = tunna subklasser längst ner (sätter name + baseUrl).
 * ETIK: politeFetch (robots.txt, delay, FoilioBot UA, backoff). Inga
 * inloggningar/captcha/personuppgifter.
 */
import { StockStatus, SourceType } from "@prisma/client";
import { politeFetch } from "../http";
import { normalizeTitle } from "../../lib/utils";
import { characterNames, isAccessoryListing } from "../matching";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";

interface ShopifyVariant {
  id: number;
  title?: string; // optionsvärdet, t.ex. "Mega Emboar" — "Default Title" när produkten saknar val
  price: string; // major units, t.ex. "2490.00"
  available: boolean;
  featured_image?: { src: string } | null;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  tags?: string[];
  images?: { src: string }[];
  variants?: ShopifyVariant[];
}

const MAX_COLLECTIONS = 30;
const MAX_PAGES_PER_COLLECTION = 8;

/**
 * Shopify Markets serverar products.json med pris per BESÖKARENS marknad (geo/cookie).
 * Våra jobb kör på GitHub Actions (US-datacenter) → utan detta får vi den utländska
 * marknadens EX-moms-pris (Goblinen: 55,20 = 69/1,25; DE-marknaden gav t.o.m. 6,95).
 * `localization`-cookien är auktoritativ och överstyr geo → pinna svenska marknaden så
 * priset ALLTID är ink. moms, oavsett var runnern står. Butiker utan Markets ignorerar den.
 */
const SE_MARKET_HEADERS = { cookie: "localization=SE", "accept-language": "sv-SE" } as const;

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

interface ShopifyRaw {
  productId: number;
  variantId?: number;
  available: boolean;
  priceOre: number;
}
function isShopifyRaw(raw: unknown): raw is { priceOre: number; available: boolean } {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "available" in raw;
}

/**
 * SORTIMENTSSIDA: en Shopify-produkt kan vara TRE SKU:er.
 *
 * Speltrollet säljer Mega Emboar / Mega Meganium / Mega Feraligatr ex Box som tre
 * VARIANTER av samma sida — var och en med egen streckkod (…1972/…1973/…1974) och egen
 * `?variant=`-URL. Vi kollapsade dem till EN annons på den nakna handle-URL:en, så bara
 * EN av de tre boxarna fick en Speltrollet-länk (vilken avgjordes av matcharen = myntkast)
 * och de andra två stod utan. Länkrevisionen larmade varje vecka, korrekt.
 *
 * VARFÖR INTE BARA SPLITTA ALLT (mätt 2026-07-14 mot butikernas RIKTIGA Pokémon-
 * kollektioner, inte gissat): Speltrollet har ~100 flervariant-produkter i dem, och nästan
 * alla är sleeve-färger, pärmfärger, tärningar och spelmattor — "Black | Blue | Red".
 * Splittar vi dem blir varje FÄRG en egen annons: hundratals nya URL:er, en huvudboksrad
 * var, och restock-lanen larmar "ny produkt" på varenda en. Vi har redan haft en
 * larm-spam-incident ([[project-absence-unknown-restock]]) — den vill vi inte upprepa.
 *
 * Skillnaden mellan ett SORTIMENT och en FÄRGKARTA sitter i variantnamnen: sortimentets
 * varianter bär KARAKTÄRSNAMN ("Mega Emboar", "Melmetal"), färgkartans bär färger och
 * storlekar. Vi kräver därför att VARJE variant nämner en Pokémon — samma vokabulär som
 * characterMismatch() redan använder för att skilja SKU:er åt. Mot de riktiga feedarna
 * ger regeln: ex-box-sortimenten, EX/Deluxe-battledecks och Spring-tins splittas;
 * sleeves, pärmar, tärningar, spelmattor, deltagarbiljetter, VM-decks (spelarnamn) och
 * artikelnummer-varianter rörs inte. Tillbehörsvakten ligger kvar som andra linje: en
 * pärm med Charizard-tryck ska inte bli tre katalogprodukter.
 */
export function splittableVariants(productTitle: string, variants: ShopifyVariant[]): ShopifyVariant[] | null {
  if (variants.length < 2) return null;
  const named = variants.filter((v) => v.title && v.title !== "Default Title");
  if (named.length !== variants.length) return null; // blandning = otydligt, rör inte
  if (isAccessoryListing(productTitle)) return null;
  if (!named.every((v) => characterNames(v.title!).size > 0)) return null;
  return named;
}

/** Variantens egen URL — Shopify väljer varianten i väljaren och i varukorgen. */
export function variantUrl(baseUrl: string, handle: string, variantId: number): string {
  return `${baseUrl}/products/${handle}?variant=${variantId}`;
}

export abstract class ShopifyAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash, t.ex. "https://speltrollet.se"
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Hämtar Pokémon-kollektionernas handles (cachar inte — körs sällan). */
  protected async pokemonCollections(errors: string[]): Promise<string[]> {
    const res = await politeFetch(`${this.baseUrl}/collections.json?limit=250`, { delayMs: 1200, headers: SE_MARKET_HEADERS });
    if (!res.ok) {
      errors.push(`${this.name}: collections.json HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { collections?: { handle: string; title: string }[] };
    return (data.collections ?? [])
      .filter((c) => {
        const s = `${c.handle} ${c.title}`.toLowerCase();
        return /pok[eé]mon/.test(s) && !/lego|plush|gosedjur|figur/.test(s);
      })
      .map((c) => c.handle)
      .slice(0, MAX_COLLECTIONS);
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();
    try {
      const handles = await this.pokemonCollections(errors);
      for (const handle of handles) {
        for (let page = 1; page <= MAX_PAGES_PER_COLLECTION; page++) {
          const url = `${this.baseUrl}/collections/${handle}/products.json?limit=250&page=${page}`;
          const res = await politeFetch(url, { delayMs: 1200, headers: SE_MARKET_HEADERS });
          if (!res.ok) {
            errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          const data = (await res.json()) as { products?: ShopifyProduct[] };
          const batch = data.products ?? [];
          if (batch.length === 0) break;
          for (const p of batch) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            products.push(...this.toRaws(p));
          }
          if (batch.length < 250) break;
        }
      }
    } catch (err) {
      errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { products, errors };
  }

  /**
   * En Shopify-produkt → EN annons, utom när sidan är ett sortiment (se
   * splittableVariants) → då EN annons per variant, med egen URL, eget pris och
   * eget lagerläge. Vanliga produkter behåller sin nakna handle-URL oförändrad:
   * annars hade varenda befintlig butiks-offer bytt nyckel på en gång.
   */
  private toRaws(p: ShopifyProduct): RawProductData[] {
    const variants = p.variants ?? [];
    if (variants.length === 0) return [];

    const split = splittableVariants(p.title.trim(), variants);
    if (split) {
      const out: RawProductData[] = [];
      for (const v of split) {
        const priceOre = Math.round(parseFloat(v.price) * 100);
        if (!Number.isFinite(priceOre) || priceOre <= 0) continue;
        const rawData: ShopifyRaw = { productId: p.id, variantId: v.id, available: v.available, priceOre };
        // Butikens egen namngivning av varianten ("… - Mega Emboar") — samma sträng som
        // deras JSON-LD, så länkrevisionen jämför äpplen med äpplen.
        const title = `${p.title.trim()} - ${v.title!.trim()}`;
        out.push({
          externalId: `${this.idPrefix}-${p.id}-${v.id}`,
          title,
          url: variantUrl(this.baseUrl, p.handle, v.id),
          price: priceOre,
          currency: "SEK",
          stockStatus: v.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
          imageUrl: v.featured_image?.src ?? p.images?.[0]?.src,
          category: guessCategory(title),
          raw: rawData,
        });
      }
      return out;
    }

    const anyAvailable = variants.some((v) => v.available);
    // Visa billigaste köpbara variantens pris (annars billigaste variant alls).
    const pool = variants.filter((v) => v.available);
    const priceVariant = (pool.length ? pool : variants).reduce((a, b) =>
      parseFloat(b.price) < parseFloat(a.price) ? b : a
    );
    const priceOre = Math.round(parseFloat(priceVariant.price) * 100);
    if (!Number.isFinite(priceOre) || priceOre <= 0) return [];
    const rawData: ShopifyRaw = { productId: p.id, available: anyAvailable, priceOre };
    return [
      {
        externalId: `${this.idPrefix}-${p.id}`,
        title: p.title.trim(),
        url: `${this.baseUrl}/products/${p.handle}`,
        price: priceOre,
        currency: "SEK",
        stockStatus: anyAvailable ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
        imageUrl: p.images?.[0]?.src,
        category: guessCategory(p.title),
        raw: rawData,
      },
    ];
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
    if (isShopifyRaw(raw)) return raw.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isShopifyRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

// ---------- Konkreta butiker (Shopify) ----------
export class SpeltrolletAdapter extends ShopifyAdapter {
  name = "Speltrollet";
  baseUrl = "https://speltrollet.se";
}
export class SamlarhobbyAdapter extends ShopifyAdapter {
  name = "Samlarhobby";
  baseUrl = "https://samlarhobby.se";
}
export class GoblinenAdapter extends ShopifyAdapter {
  name = "Goblinen";
  baseUrl = "https://goblinen.com";
}
// Fler-spels-butik (MTG/FaB/Pokémon) — collections.json-namnfiltret plockar
// Pokémon-kollektionerna ("pokemon-booster-boxes", "pokemon-elite-trainer-boxes" …).
export class ManatorskAdapter extends ShopifyAdapter {
  name = "Manatörsk";
  baseUrl = "https://manatorsk.com";
}
// Dragon's Lair bytte plattform (Vendre → Shopify) ~2026-07. Fler-spels-butik:
// collections.json-namnfiltret hittar inte de generiska sealed-kollektionerna, men
// master-kollektionen "pokemon-the-trading-card-game" täcker allt Pokémon-sealed.
export class DragonsLairAdapter extends ShopifyAdapter {
  name = "Dragon's Lair";
  baseUrl = "https://dragonslair.se";
  protected async pokemonCollections(): Promise<string[]> {
    return ["pokemon-the-trading-card-game"];
  }
}
