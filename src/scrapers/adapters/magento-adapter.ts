/**
 * MagentoAdapter — adapter för Magento 2-butiker (server-renderad kategori-HTML).
 * Byggd för Toyspace; basklassen är återanvändbar om fler Magento-butiker dyker upp.
 *
 * Upptäckt (probe 2026-09-06 mot toyspace.se):
 *   · Butiken är en ALLMÄN leksaksaffär — 9 514 URL:er i sitemapen, varav det mesta
 *     "Pokémon" är gosedjur, pussel och LEGO. TCG:n bor i EN kategori,
 *     /samlarkortspel/pokemonkort, med 14 produkter som ryms på en sida.
 *   · Varje kort (mätt: 14 av 14 bär ALLA fyra fälten, i lager som slutsålda):
 *       <li class="item product product-item">
 *         <div class="product-item-info" id="product-item-info_53669">
 *         <a class="product-item-link" href="https://toyspace.se/{slug}">Titel</a>
 *         <span data-price-amount="85" data-price-type="finalPrice">
 *         <form data-role="tocart-form" data-product-sku="03266-17">   ← saknas när slutsåld
 *
 * ⛔ INGEN PAGINERING FÅR ANVÄNDAS. robots.txt börjar med `Disallow: /*?` — det
 *    blockerar VARJE URL med frågesträng, alltså Magentos egen `?p=2` OCH
 *    `?product_list_limit=`. Vi hämtar därför sida 1 och inget mer. Det räcker i dag
 *    (14 av 14 produkter ryms), men ⚠️ VÄXER KATEGORIN FÖRBI EN SIDA TAPPAR VI
 *    RESTEN TYST. Kontrollera `toolbar-number` mot antalet parsade kort — adaptern
 *    varnar själv när de skiljer sig (se `fetchProducts`).
 *
 * ⛔ TITELN BÄR IBLAND EN KÖPGRÄNS: "Max 5 per kund. Pokémon TCG …". Prefixet är
 *    butikslogistik, inte produktnamn, och skulle förgifta matchningen mot katalogen
 *    (och dyka upp i Discord-inlägg). Det strippas i `stripMagentoTitleNoise`.
 *
 * ⛔ LAGERDOMEN KRÄVER TVÅ SIGNALER SOM PEKAR ÅT SAMMA HÅLL: `out-of-stock`-klassen
 *    OCH avsaknaden av köpformuläret. Magento-teman renderar båda, och en butik som
 *    slutar rendera den ena får då `unknown` i stället för ett falskt "i lager".
 *    (Sex butiker i basen kan redan aldrig uttrycka "slut i lager" — se
 *    scraping-restock.md. Den klassen av tyst fel ska inte växa.)
 *
 * ETIK: politeFetch (robots.txt, per-host-delay, FoilioBot UA, backoff). Inga
 * inloggningar, ingen captcha, inga personuppgifter.
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

const PAGE_DELAY_MS = 1500;
/** Bunden segmentlängd per produktkort — mot patologisk backtracking. */
const ITEM_SLICE = 12_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

/**
 * Tar bort butikslogistik som ligger i produktnamnet. "Max 5 per kund." är en
 * köpgräns, inte en del av varan — den skiljer sig dessutom mellan butiker och
 * över tid, så den skulle göra samma produkt omatchbar mot katalogen.
 */
export function stripMagentoTitleNoise(title: string): string {
  return title
    .replace(/^\s*max\s+\d+\s+per\s+(kund|order|beställning)\s*[.:–-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type MagentoStock = "in" | "out" | "unknown";

export interface MagentoItem {
  url: string;
  title: string;
  priceOre: number | null;
  stock: MagentoStock;
  productId?: string;
  sku?: string;
  imageUrl?: string;
}

interface MagentoRaw {
  priceOre: number | null;
  stock: MagentoStock;
  url: string;
  productId?: string;
}
function isMagentoRaw(raw: unknown): raw is MagentoRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw;
}

/**
 * Plockar produktkorten ur en Magento 2-kategorisida. Ren funktion → testbar utan nät.
 */
export function parseMagentoListing(html: string): MagentoItem[] {
  const out: MagentoItem[] = [];
  const segments = html.split(/<li class="item product product-item"/).slice(1);

  for (const rawSeg of segments) {
    const seg = rawSeg.slice(0, ITEM_SLICE);

    const linkM = seg.match(/class="product-item-link"[^>]*href="(https?:\/\/[^"]+)"/)
      ?? seg.match(/href="(https?:\/\/[^"]+)"[^>]*class="product-item-link"/);
    if (!linkM) continue;
    const url = decodeEntities(linkM[1]).split("#")[0];

    const nameM = seg.match(/class="product-item-link"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    if (!nameM) continue;
    const title = stripMagentoTitleNoise(decodeEntities(nameM[1].replace(/<[^>]+>/g, " ")));
    if (!title) continue;

    // ⛔ finalPrice, inte regularPrice — på en reavara renderar Magento båda och den
    // ordinarie står först. Priset är i KRONOR (heltal eller decimal).
    const priceM = seg.match(/data-price-amount="([0-9.]+)"[^>]*data-price-type="finalPrice"/);
    const priceKr = priceM ? parseFloat(priceM[1]) : NaN;
    // 0 kr är en platshållare, inte ett pris — annonsen överlever ändå (se types.ts).
    const priceOre = Number.isFinite(priceKr) && priceKr > 0 ? Math.round(priceKr * 100) : null;

    // Två oberoende signaler, se filhuvudet.
    const hasCartForm = /data-role="tocart-form"/.test(seg);
    const marksOutOfStock = /out-of-stock|tillfälligt slut|slut i lager/i.test(seg);
    const stock: MagentoStock =
      marksOutOfStock && !hasCartForm ? "out" : hasCartForm && !marksOutOfStock ? "in" : "unknown";

    const imgM = seg.match(/data-src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);

    out.push({
      url,
      title,
      priceOre,
      stock,
      productId:
        seg.match(/id="product-item-info_(\d+)"/)?.[1] ??
        seg.match(/data-product-id="(\d+)"/)?.[1],
      sku: seg.match(/data-product-sku="([^"]+)"/)?.[1],
      imageUrl: imgM ? decodeEntities(imgM[1]) : undefined,
    });
  }
  return out;
}

/** Magentos egen produkträknare i verktygsraden ("14" av "Artiklar 1-14 av 14"). */
export function magentoToolbarCount(html: string): number | null {
  const m = html.match(/toolbar-number"[^>]*>(\d+)</);
  return m ? parseInt(m[1], 10) : null;
}

export abstract class MagentoAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash — måste matcha ScrapeSource.baseUrl
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Kategorisidor att hämta (butikens egen stavning!). */
  protected abstract categoryPaths: string[];

  protected get idPrefix(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const path of this.categoryPaths) {
      // ⛔ EN sida per kategori — robots.txt förbjuder frågesträngar (se filhuvudet).
      const url = `${this.baseUrl}${path}`;
      let html: string;
      try {
        const res = await politeFetch(url, { delayMs: PAGE_DELAY_MS });
        if (!res.ok) {
          errors.push(`${this.name}: HTTP ${res.status} ${url}`);
          continue;
        }
        html = await res.text();
      } catch (err) {
        errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      const found = parseMagentoListing(html);

      // Butikens EGEN räknare mot vad vi faktiskt fick. Utan den växer kategorin förbi
      // en sida och vi tappar resten UTAN ett enda fel i loggen.
      const total = magentoToolbarCount(html);
      if (total !== null && total > found.length) {
        errors.push(
          `${this.name}: ${path} har ${total} produkter men sidan gav ${found.length} — ` +
            `kategorin har växt förbi en sida och robots.txt förbjuder paginering (?p=N). ` +
            `Dela upp i smalare kategorier.`
        );
      }

      for (const item of found) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        products.push({
          externalId: item.productId
            ? `${this.idPrefix}-${item.productId}`
            : `${this.idPrefix}-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
          title: item.title,
          url: item.url,
          price: item.priceOre,
          currency: "SEK",
          stockStatus:
            item.stock === "in"
              ? StockStatus.IN_STOCK
              : item.stock === "out"
                ? StockStatus.OUT_OF_STOCK
                : StockStatus.UNKNOWN,
          imageUrl: item.imageUrl,
          category: guessListingCategory(item.title),
          raw: {
            priceOre: item.priceOre,
            stock: item.stock,
            url: item.url,
            productId: item.productId,
          } satisfies MagentoRaw,
        });
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
    if (isMagentoRaw(raw)) {
      if (raw.stock === "in") return StockStatus.IN_STOCK;
      if (raw.stock === "out") return StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    // null = ingen prisobservation — 0 kr-platshållaren är inte ett pris.
    if (isMagentoRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      // null = pris okänt och GODKÄNT; ett TAL måste vara ett positivt heltal i öre.
      (p.price === null || (Number.isInteger(p.price) && p.price > 0)) &&
      p.url.startsWith("http")
    );
  }
}

// ---------- Konkreta butiker (Magento 2) ----------

/**
 * Toyspace är en allmän leksaksaffär — bara TCG-kategorin hämtas. Kategorin rymmer
 * även pärmar och sleeves; de fälls av vaktkedjan i runnern (isAccessoryListing),
 * inte här.
 */
export class ToyspaceAdapter extends MagentoAdapter {
  name = "Toyspace";
  baseUrl = "https://toyspace.se";
  protected categoryPaths = ["/samlarkortspel/pokemonkort"];
}
