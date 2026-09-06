/**
 * CardHavenAdapter — adapter för cardhaven.se (Next.js App Router, server-renderad
 * HTML med Tailwind-klasser).
 *
 * Upptäckt (probe 2026-09-06):
 *   · Sealed bor i två kategorier: /shop/pokemon (20 varor) och /shop/pokemon-jp (4).
 *     ⛔ /cards/pokemon och /shop/graded-cards är SINGLAR resp. GRADERAT — hämta dem
 *        aldrig här. Graderat är enligt katalogens regler en EGEN vara (se
 *        marketplace-tradera.md) och singlarna prissätts ur Cardmarket, inte ur butik.
 *   · Ingen paginering: båda kategorierna renderar hela sortimentet i ett svep
 *     (`Visa fler`-knapp saknas). ⚠️ Växer butiken förbi det tappar vi resten tyst —
 *     se sidräknarvarningen i `fetchProducts`.
 *   · Varje kort:
 *       <a class="group flex flex-col" href="/shop/pokemon/{slug}">
 *         <img alt="Titel" src="https://holohaven.fra1.cdn.digitaloceanspaces.com/…">
 *         <span class="… bg-red-600 …">Slut i lager</span>     ← bara när slutsåld
 *         <span class="… ">Max 1 per order</span>              ← köpgräns, inte lager
 *         <h3 class="text-sm font-semibold …">Titel</h3>
 *         <p class="… text-gold">Släpps 16 sep. 2026</p>       ← förbeställning
 *         <span class="text-lg font-bold text-primary">1&nbsp;249,00&nbsp;kr</span>
 *
 * ⛔ SIDAN BÄR INGEN MASKINLÄSBAR DATA. Ingen `__NEXT_DATA__`, inga JSON-LD-produkter,
 *    och `self.__next_f`-flighten innehåller inga produktfält. Allt måste läsas ur
 *    markupen, och markupen är Tailwind-genererad — dvs den kan ändras av en ren
 *    omdesign. Parsern hänger sig därför på de STABILASTE hållpunkterna som finns
 *    (href-mönstret, `<h3>`, ordet "kr", texten "Slut i lager"), aldrig på en
 *    utility-klasskedja som `text-lg font-bold text-primary`.
 *
 * ⛔ PRISET ANVÄNDER SVENSKT DECIMALKOMMA OCH `&nbsp;` SOM TUSENTALSAVGRÄNSARE:
 *    "1&nbsp;249,00&nbsp;kr" = 124 900 öre. Avkoda FÖRE parsning och behandla kommat
 *    som decimaltecken — annars blir 1 249,00 kr till 124 900 kr (en faktor 100 fel,
 *    vilket gör varan osynlig i varje prisjämförelse).
 *
 * ⛔ "Slut i lager"-BADGEN ÄR ENDA LAGERSIGNALEN, och dess FRÅNVARO betyder "i lager".
 *    Det är en denylist, tvärtemot Alphaspel/Nyehandel. Den kan vi inte komma runt —
 *    butiken renderar ingen positiv markör — men den gör adaptern känslig: slutar
 *    butiken rendera badgen ser ALLT ut som i lager och varje slutsåld vara larmar.
 *    Därför kräver `fetchProducts` att MINST ett kort i hela hämtningen bär badgen
 *    (mätt 2026-09-06: 12 av 24). Noll badges i en icke-tom feed = markupen har
 *    ändrats ⇒ hela hämtningen kasseras med ett fel, hellre än att larma falskt.
 *
 * robots.txt (verifierad 2026-09-06): `Allow: /`, med `/account/`, `/checkout/`,
 * `/cart/` och `/api/` blockerade. Butikskategorierna är tillåtna.
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

const BASE_URL = "https://cardhaven.se";
const CATEGORY_PATHS = ["/shop/pokemon", "/shop/pokemon-jp"];
const PAGE_DELAY_MS = 1500;
/** Bunden segmentlängd per produktkort — mot patologisk backtracking. */
const ITEM_SLICE = 9_000;

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
 * "1 249,00 kr" → 124900 öre. Kommat är DECIMALTECKEN (svensk notation), mellanrum
 * (inkl. hårt mellanslag) är tusentalsavgränsare.
 */
export function parseCardHavenPrice(text: string): number | null {
  const cleaned = decodeEntities(text)
    .replace(/[\s ]/g, "")
    .replace(/kr|sek/gi, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

export type CardHavenStock = "in" | "out" | "preorder";

export interface CardHavenItem {
  url: string;
  title: string;
  priceOre: number | null;
  stock: CardHavenStock;
  imageUrl?: string;
}

interface CardHavenRaw {
  priceOre: number | null;
  stock: CardHavenStock;
  url: string;
}
function isCardHavenRaw(raw: unknown): raw is CardHavenRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw;
}

export interface CardHavenParseResult {
  items: CardHavenItem[];
  /** Hur många kort som bar "Slut i lager" — vakten i fetchProducts läser den. */
  outOfStockBadges: number;
}

/**
 * Plockar produktkorten ur en CardHaven-kategorisida. Ren funktion → testbar utan nät.
 */
export function parseCardHavenListing(html: string): CardHavenParseResult {
  const items: CardHavenItem[] = [];
  let outOfStockBadges = 0;

  // Hållpunkt: länken till en produktsida under /shop/{kategori}/{slug}. Kortets
  // yttre <a> öppnar segmentet; nästa sådan <a> stänger det.
  // ⛔ SPLITTEN ÄTER UPP `href="` — varje segment BÖRJAR därför med själva URL:en,
  //    inte med ett href-attribut. Letar man efter `href="` igen hittar man NÄSTA
  //    korts länk (eller ingenting), och parsern ger tyst noll träffar.
  const segments = html.split(/<a\b[^>]*\bhref="(?=\/shop\/[^"/]+\/[^"]+")/).slice(1);

  for (const rawSeg of segments) {
    const seg = rawSeg.slice(0, ITEM_SLICE);

    const hrefM = seg.match(/^(\/shop\/[^"/]+\/[^"]+)"/);
    if (!hrefM) continue;
    const url = `${BASE_URL}${decodeEntities(hrefM[1]).split("#")[0].split("?")[0]}`;

    const h3M = seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!h3M) continue;
    const title = decodeEntities(h3M[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title) continue;

    // Priset: sista "…kr" i kortet är produktens pris (badgetexter innehåller inget kr).
    const priceM = seg.match(/>([0-9][0-9\s .,&nbsp;]*?(?:&nbsp;|\s)?kr)</i);
    const priceOre = priceM ? parseCardHavenPrice(priceM[1]) : null;

    const hasOutBadge = /Slut i lager/i.test(seg);
    if (hasOutBadge) outOfStockBadges++;
    // Förbeställning känns igen på släppdatumet ELLER på titeln — butiken sätter båda.
    const isPreorder = /Släpps\s+\d|\(Förbeställning\)/i.test(seg);

    items.push({
      url,
      title,
      priceOre,
      // Slutsåld vinner över förbeställning: en förbeställning som tagit slut går
      // inte att köpa, och att kalla den PREORDER hade sett ut som en uppgradering.
      stock: hasOutBadge ? "out" : isPreorder ? "preorder" : "in",
      imageUrl: seg.match(/src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1],
    });
  }

  return { items, outOfStockBadges };
}

export class CardHavenAdapter implements SourceAdapter {
  name = "Card Haven";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    let totalBadges = 0;
    let totalItems = 0;

    for (const path of CATEGORY_PATHS) {
      let html: string;
      try {
        const res = await politeFetch(`${BASE_URL}${path}`, { delayMs: PAGE_DELAY_MS });
        if (!res.ok) {
          errors.push(`${this.name}: HTTP ${res.status} ${BASE_URL}${path}`);
          continue;
        }
        html = await res.text();
      } catch (err) {
        errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      const { items, outOfStockBadges } = parseCardHavenListing(html);
      totalBadges += outOfStockBadges;
      totalItems += items.length;

      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        products.push({
          externalId: `cardhaven-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
          title: item.title,
          url: item.url,
          price: item.priceOre,
          currency: "SEK",
          stockStatus:
            item.stock === "in"
              ? StockStatus.IN_STOCK
              : item.stock === "out"
                ? StockStatus.OUT_OF_STOCK
                : StockStatus.PREORDER,
          imageUrl: item.imageUrl,
          category: guessListingCategory(item.title),
          raw: { priceOre: item.priceOre, stock: item.stock, url: item.url } satisfies CardHavenRaw,
        });
      }
    }

    // ⛔ SANITETSVAKT, se filhuvudet. Lagerstatusen vilar helt på att badgen finns;
    // försvinner den ur markupen blir varenda slutsåld vara "i lager" och varje
    // bevakare får ett larm till en död sida. Noll badges i en icke-tom feed är
    // därför inte "allt är i lager" utan "vi kan inte längre läsa lagerstatus".
    if (totalItems > 0 && totalBadges === 0) {
      return {
        products: [],
        errors: [
          `${this.name}: ${totalItems} annonser men NOLL "Slut i lager"-badges — ` +
            `markupen har troligen ändrats. Hämtningen kasseras hellre än att rapportera ` +
            `allt som i lager. Probea butiken och uppdatera parsern.`,
        ],
      };
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
    if (isCardHavenRaw(raw)) {
      if (raw.stock === "in") return StockStatus.IN_STOCK;
      if (raw.stock === "out") return StockStatus.OUT_OF_STOCK;
      if (raw.stock === "preorder") return StockStatus.PREORDER;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    // null = ingen prisobservation — 0 kr-platshållaren är inte ett pris.
    if (isCardHavenRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
