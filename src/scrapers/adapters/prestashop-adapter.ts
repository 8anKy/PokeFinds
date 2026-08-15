/**
 * PrestaShopAdapter — återanvändbar adapter för PrestaShop-butiker (server-renderad
 * kategori-/märkes-HTML). Tre butiker på samma plattform = EN parser, tunna subklasser.
 *
 * Upptäckt (probe 2026-08-13, sparade sidor i sessionens scratchpad):
 *   - PrestaShop-standardtemat (badge-varianten, sedd på Playoteket): 60 <article
 *     class="product-miniature" data-id-product="…"> per sida, paginering ?page=N.
 *     Titel i <h2 class="h3 product-title"><a>. Lagerbadge per artikel:
 *     "badge-success product-available" (I lager) ELLER "badge-danger
 *     product-unavailable" (Slut i weblager) — aldrig båda (mätt: 0 av 60), och
 *     d-none förekommer bara på "product-last-items"-mallen, inte på huvudbadgarna.
 *     ⛔ PLAYOTEKET ÄR ÄNDÅ INTE EN BUTIK HÄR: deras robots.txt slutar med ett andra
 *     "User-agent: *"-block med "Disallow: /" (bara Googlebot/Slurp/msnbot släpps in)
 *     — upptäckt 2026-08-13 när politeFetch korrekt vägrade kategorisidan. Samma dom
 *     som arcadedreams: robots-blockerad butik hämtas inte. Badge-parsningen behålls
 *     eftersom den ÄR PrestaShops standardtema och nästa PS-butik lär bära den.
 *   - Leksaksaffären /1231_pokemon-tcg (märkessida, "Det finns 102 produkter"): 36
 *     artiklar/sida, ?page=2..3. Titel i <h2 class="… product-name"><a> men texten kan vara
 *     SERVER-trunkerad ("Pokemon Pitch Black Booster..."), medan <img alt> bär hela titeln
 *     → alt vinner när ankartexten slutar på "…". Lagersignalen är INDIREKT men mätt
 *     (2026-08-13, 36 artiklar): köpbara rader bär pris + add-to-cart-or-refresh-form (22),
 *     slutsålda bär "Tillfälligt slut i webblager" och varken pris eller form (14) —
 *     de prislösa faller ur feeden (pris är obligatoriskt i pipelinen), precis som
 *     Speltrollets slutsålda faller ur sina kollektioner.
 *   - NordicTCG: startsidan listar hela (lilla) katalogen + kategorin /3-booster-boxar.
 *     Eget tema: flaggan <li class="out_of_stock"><span>Slutsåld</span></li> och
 *     "ajax_add_to_cart_button disabled" på slutsålda; aktiv köpknapp på köpbara.
 *
 * Pris: "749,00 kr" / "2 999,00 kr" / "1 079,00 kr" → öre. PrestaShops robots
 * (auto-genererad) blockerar bara parametrar som ?order=/?tag= — kategorisidor och
 * ?page= är tillåtna (verifierat 2026-08-13 i Leksaksaffärens och NordicTCG:s robots;
 * ⚠ läs ALLTID robots-filen till SLUTET — Playoteket lade sitt "Disallow: /" sist).
 *
 * ETIK: politeFetch (robots.txt, delay ≥1500 ms — butikerna kör egna servrar, inte CDN-
 * feeds som Shopify), FoilioBot UA, backoff. Inga inloggningar/captcha/personuppgifter.
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

const MAX_PAGES_PER_CATEGORY = 8; // 8 × 36-60 artiklar täcker alla tre butikerna med marginal
const PAGE_DELAY_MS = 1500;
/** Bunden segmentlängd per artikel — mot patologisk backtracking på 1 MB-sidor (Leksaksaffären). */
const ARTICLE_SLICE = 20_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** "2 999,00 kr" → 299900 öre. Tål vanligt blanksteg, nbsp och punkt som tusentalsavskiljare. */
export function parseSekListingPrice(text: string): number | null {
  const cleaned = text
    .replace(/[\s ]/g, "")
    .replace(/kr|sek/gi, "")
    // "2.999,00" → punkt är tusental när komma finns; annars är punkten decimal
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}


export type PrestaStock = "in" | "out" | "unknown";

export interface PrestaItem {
  idProduct: string;
  url: string;
  title: string;
  priceOre: number;
  stock: PrestaStock;
  imageUrl?: string;
}

interface PrestaRaw {
  idProduct: string;
  priceOre: number;
  stock: PrestaStock;
  url: string;
}
function isPrestaRaw(raw: unknown): raw is PrestaRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw;
}

/**
 * Lagerdom per artikelsegment. EXPLICIT markör krävs åt båda hållen:
 * slutsåld-markör → out; tillgänglig-markör/aktiv köpknapp → in; annars unknown.
 * En listning utan signal (Leksaksaffären) får aldrig gissas till in — en offer
 * som ljuger "I lager" är värre än en som säger "Okänd".
 */
export function prestaStockFromArticle(seg: string): PrestaStock {
  if (
    /product-unavailable/.test(seg) ||
    /class="out_of_stock"/.test(seg) ||
    /ajax_add_to_cart_button disabled/.test(seg) ||
    />\s*Slutsåld\s*</.test(seg) ||
    // Leksaksaffären: "Tillfälligt slut i webblager" + TOM product-list-actions
    // (upptäckt 2026-08-13 — de 14 slutsålda av märkessidans 36 artiklar saknar
    // dessutom pris, så de faller ändå ur feeden; markören håller domen ärlig
    // ifall temat någon gång visar pris på en slutsåld rad).
    /slut i web?blager/i.test(seg)
  ) {
    return "out";
  }
  // "out"-grenen ovan har redan fångat disabled-knappen, så en kvarvarande
  // ajax_add_to_cart_button är per definition aktiv (NordicTCG-temat). Leksaksaffärens
  // köpbara rader bär en add-to-cart-or-refresh-form — slutsålda rader har den inte
  // (mätt: 22 med form+pris, 14 utan båda), så formen ÄR en tillgänglighetssignal.
  if (
    /badge-success product-available/.test(seg) ||
    /ajax_add_to_cart_button/.test(seg) ||
    /add-to-cart-or-refresh/.test(seg)
  ) {
    return "in";
  }
  return "unknown";
}

/**
 * Plockar produkterna ur en server-renderad PrestaShop-listning (kategori-, märkes-
 * eller startsida). Ren funktion → testbar utan nät. Artiklar utan produktlänk
 * + data-id-product (blogg-/innehållskort) hoppas tyst.
 */
export function parsePrestaShopListing(html: string): PrestaItem[] {
  const out: PrestaItem[] = [];
  const articles = html.split(/<article/).slice(1);
  for (const raw of articles) {
    const seg = raw.slice(0, ARTICLE_SLICE);
    const idM = seg.match(/data-id-product="(\d+)"/);
    // Produkt-URL: {…}/{id}-{slug}.html — samma form i alla tre butikerna.
    const urlM = seg.match(/href="(https?:\/\/[^"]+\/\d+-[^"/]+\.html)"/);
    if (!idM || !urlM) continue;
    const url = decodeEntities(urlM[1]).split("#")[0].split("?")[0];

    // Titel i fallande förtroendeordning: ankartitel (NordicTCG bär full titel där),
    // product-title/product-name-ankartext, sist bildens alt.
    const titleAttr = seg.match(/<a[^>]*class="[^"]*product_name[^"]*"[^>]*title="([^"]*)"/)?.[1];
    const anchorText = seg.match(
      /class="[^"]*product[-_](?:title|name)[^"]*"[^>]*>\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/
    )?.[1];
    const alt = seg.match(/<img[^>]*\salt="([^"]+)"/)?.[1];
    let title = decodeEntities(titleAttr ?? anchorText ?? alt ?? "").replace(/\s+/g, " ").trim();
    // Leksaksaffären trunkerar ankartexten SERVER-sida ("…Booster...") — alt bär hela.
    if (/(\.\.\.|…)$/.test(title) && alt) {
      const full = decodeEntities(alt).replace(/\s+/g, " ").trim();
      if (full.length > title.length) title = full;
    }
    // NordicTCG:s alt slutar "… Köp hos NordicTCG!" — bara när alt var enda källan.
    title = title.replace(/\s*Köp hos [^!]+!$/i, "").trim();
    if (!title) continue;

    const priceM = seg.match(/class="price[^"]*"[^>]*>\s*([0-9][0-9\s .,]*)\s*kr/i);
    const priceOre = priceM ? parseSekListingPrice(priceM[1]) : null;
    if (!priceOre) continue; // pris är obligatoriskt — utan pris är observationen värdelös

    const imgM = seg.match(/(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);

    out.push({
      idProduct: idM[1],
      url,
      title,
      priceOre,
      stock: prestaStockFromArticle(seg),
      imageUrl: imgM?.[1],
    });
  }
  return out;
}

export abstract class PrestaShopAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /**
   * Listnings-sidor att hämta (kategori/märke/startsida). "/" pagineras aldrig;
   * övriga får ?page=2..N tills en sida är tom eller bara innehåller redan sedda URL:er.
   */
  protected abstract categoryPaths: string[];

  protected get idPrefix(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const path of this.categoryPaths) {
      const maxPages = path === "/" ? 1 : MAX_PAGES_PER_CATEGORY;
      for (let page = 1; page <= maxPages; page++) {
        const url =
          page === 1 ? `${this.baseUrl}${path}` : `${this.baseUrl}${path}?page=${page}`;
        let html: string;
        try {
          const res = await politeFetch(url, { delayMs: PAGE_DELAY_MS });
          if (!res.ok) {
            if (page === 1) errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          html = await res.text();
        } catch (err) {
          errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }

        const found = parsePrestaShopListing(html);
        if (found.length === 0) break;
        let added = 0;
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          added++;
          products.push({
            externalId: `${this.idPrefix}-${item.idProduct}`,
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
              idProduct: item.idProduct,
              priceOre: item.priceOre,
              stock: item.stock,
              url: item.url,
            } satisfies PrestaRaw,
          });
        }
        // Ingen NY produkt → sista sidan (PrestaShop repeterar sista sidan för höga ?page).
        if (added === 0) break;
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
    if (isPrestaRaw(raw)) {
      if (raw.stock === "in") return StockStatus.IN_STOCK;
      if (raw.stock === "out") return StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isPrestaRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

// ---------- Konkreta butiker (PrestaShop) ----------
// ⛔ INGEN PlayoteketAdapter: playoteket.com robots-blockerar alla bottar utom
//    Googlebot/Slurp/msnbot (sista blocket i deras robots.txt, läst 2026-08-13).
//    Lägg inte till den utan att robots-filen har ÄNDRATS — politeFetch vägrar ändå.

/**
 * Märkessidan "Pokemon TCG" (102 produkter) är hela TCG-sortimentet — kategorin
 * /649-pokemon-tcg-shop är en delmängd. ⚠ Slutsålda rader saknar PRIS i listningen
 * ("Tillfälligt slut i webblager") och faller därmed ur feeden — restock på en sådan
 * vara syns först när butiken prissätter raden igen (samma mönster som Speltrollet).
 */
export class LeksaksaffarenAdapter extends PrestaShopAdapter {
  name = "Leksaksaffären";
  baseUrl = "https://leksaksaffaren.com";
  protected categoryPaths = ["/1231_pokemon-tcg"];
}

/**
 * Liten JP-fokuserad butik: startsidan listar katalogen, /3-booster-boxar är den
 * sealed-kategori som finns. /10-singel-kort och /11-sleeves-storage hämtas ALDRIG
 * (singlar prissätts via Cardmarket, tillbehör hör inte hemma i katalogen).
 */
export class NordicTcgAdapter extends PrestaShopAdapter {
  name = "NordicTCG";
  baseUrl = "https://nordictcg.se";
  protected categoryPaths = ["/", "/3-booster-boxar"];
}
