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

const MAX_CATEGORIES = 24;
const MAX_PAGES_PER_CATEGORY = 4;
/**
 * Extra kategorier som får hämtas via BARN-NEDSTIGNING (2026-08-13): en upptäckt
 * kategorisida som renderar NOLL produkter är en LANDNINGSSIDA vars barn bär varorna —
 * CardGames hela JP/CN-hylla (Mega Dream, Terastal Festival, Mega Symphonia …) låg på
 * djup 3–4 under `/engelska-pokmon-produkter/japansktkinesiskt`, som själv renderar 0,
 * och tvåsegmentsupptäckten kunde aldrig nå den. Budgeten är per butik och finns för
 * att en butik med många äkta (kaskaderande) föräldrasidor inte ska dra igång en
 * krypning av hela sitt kategoriträd — barn hämtas BARA när föräldern var tom.
 */
const MAX_CHILD_CATEGORIES = 12;

/**
 * Den URSPRUNGLIGA uteslutningen, ordagrant. Används BARA av regel 1 nedan, som är den
 * beprövade vägen för Swepoke och Shinycards.
 *
 * ⛔ Vidga den inte "på köpet". Ett bortfiltrerat kategorinamn tar bort URL:er ur
 *    feeden, och en offer som saknas i feeden nollas till "Okänd" efter 24h — varefter
 *    nästa restock aldrig larmar (UNKNOWN→IN_STOCK räknas inte som en övergång).
 *    Vill man utesluta mer: mät mot butikernas riktiga feedar först.
 */
const LEGACY_NON_SEALED =
  /singles|graded|loose|l[oö]sa|tillbeh|accessor|sleeve|binder|playmat|spelmatt|deck-?box/i;

/**
 * Hyllor den NYA upptäckten (regel 2) aldrig hämtar: singlar/graderat (prissätts av
 * Cardmarket), tillbehör och merch. Bredare än `LEGACY_NON_SEALED` eftersom de nya
 * butikerna säljer gosedjur och figurer i egna kategorier — men den gäller alltså bara
 * kategorier som ingen befintlig butik hämtade förut.
 */
const NON_SEALED_CATEGORY =
  /singles|graded|gradera|loose|l[oö]sa|l[oö]skort|tillbeh|accessor|sleeve|binder|playmat|spelmatt|deck-?box|toploader|merch|gosedjur|plush|figur|kl[äa]der|affisch|poster/i;

/** Sidor som aldrig är en varuhylla (info, kassa, kampanjsidor, andra spel). */
const NON_PRODUCT_CATEGORY =
  /^\/(sidor|pages|contact|kontakt|konto|account|customer|cart|checkout|shop\/wishlist|blogg?|nyheter|search|sok)\b|\b(lorcana|one-?piece|magic|mtg|yu-?gi-?oh|yugioh|digimon|riftbound|rift-bound|sorcery|star-?wars|gundam|shadowverse|keyforge|union-?arena|flesh-?and-?blood|sallskapsspel|b2b|grossist|showroom|specialbest|cashback|presentkort|varumarken|turnering|event)\b/i;

/** Vägen nämner Pokémon. `pok[eé]?mon` med flit — CardGame stavar det "pokmon". */
const POKEMON_MARKER = /pok[eé]?mon/i;

/**
 * Vägen nämner en SEALED-form. Behövs för butiker som inte skriver "pokemon" i
 * sökvägen alls (Packs on Packs: /sealed-produkter, /engelska-packs, /japanska-packs).
 */
const SEALED_MARKER =
  /sealed|booster|\bpacks?\b|\betb\b|elite-?trainer|\btins?\b|blister|bundle|display|boxar|\bbox\b|kortpaket|f[oö]rhandsb|pre-?order|f[oö]rbok/i;

// Fallback-parsern plockar upp korsförsäljnings-hrefs → singel-URL:er kan smita in och
// fel-länkas till en sealed katalogprodukt (t.ex. "Blastoise 1-Pack Blister" bunden till
// ett Blastoise-singelkort). Singlar prissätts via Cardmarket, aldrig via butik → släng dem.
// Butikerna stavar singel-katalogen olika: /singles/, /singles-and-graded-cards/,
// /singles-loskort/ (Shinycards) OCH /los-pokemon/ (Spelkortsbutiken, 2026-08-13).
// En hårdkodad lista över stavningar missar nästa — matcha på segmentet som BÖRJAR
// med "singles", plus svenskans "löskort"/"lös-pokemon". ⛔ INTE bara "lös-": Samlar-
// hobbys "lösa paket"/"lösa boosters" är SEALED (lösplock ur display), inte singlar.
const SINGLE_URL = /\/(singles[a-z-]*|l[oö]skort[a-z-]*|l[oö]s-pokemon[a-z-]*)\//i;

/** Ska en Quickbutik-annons släppas? (singel-URL fel-länkas till sealed). Ren → testbar. */
export function qbShouldDrop(url: string): boolean {
  return SINGLE_URL.test(url);
}

/**
 * Sidvägar som ALDRIG är en produkt. Allt annat med formen /{segment}/{slug} är det —
 * butiken bestämmer själv toppsegmentet.
 */
const NON_PRODUCT_PATH = /^\/(cart|checkout|sidor|pages|contact|kontakt|account|konto|blogg?|search|sok)\//i;

/** Butikens "går inte att köpa"-text. Delas av båda parsrarna så de aldrig glider isär. */
const SOLD_OUT_MARKERS = /Ej tillgänglig|Slutsåld|Sold out|Bevaka|Meddela mig|area-label="Ej/i;

/**
 * Lagerdomen för ett produktblock — på KOMMENTARSFRI text.
 *
 * ⛔ STRIPPNINGEN ÄR INTE VALFRI (2026-08-10): Swepokes tema började 2026-07-27 rendera
 * mallkommentarer i VARJE produktkort — `<!-- Sold out -->`, `<!-- Has options -->` — och
 * SOLD_OUT_MARKERS träffade texten inne i kommentaren. Följden var total och tyst:
 * 101 av 101 Swepoke-offers stod OUT_OF_STOCK i 14 dygn (11 äkta IN→OUT-flippar skrevs
 * 07-27 när temat bytte, sedan NOLL händelser), medan butikssidorna sa "I lager" —
 * inga restock-larm kunde någonsin fyras. En mallkommentar är ingen lagerstatus; bara
 * synlig markup får rösta. Mätt efter fix: 57 IN / 104 OUT på Swepokes riktiga feed,
 * med de äkta slutsålda fällda av `area-label="Ej`-attributet som förut.
 */
export function qbBlockStock(block: string): { soldOut: boolean; buyable: boolean } {
  const text = block.replace(/<!--[\s\S]*?-->/g, " ");
  const soldOut = SOLD_OUT_MARKERS.test(text);
  return { soldOut, buyable: !soldOut && /Lägg i|>\s*I lager|text-success/i.test(text) };
}

/**
 * Produktlänken i ETT data-pid-block.
 *
 * VARFÖR INTE BARA /pokemon/…: Quickbutik låter samma produkt bo under flera toppsegment,
 * och blocket bär den kanoniska. Swepoke länkar sitt NYA sortiment som
 * `/alla-produkter/{slug}` medan äldre varor ligger kvar på `/pokemon/{kategori}/{slug}` —
 * mönstret som bara godtog det senare kastade tyst 9 av 18 produkter på ETB-kategorisidan
 * (73 av 161 över hela butiken, mätt 2026-07-28). De produkterna föll ur feeden, och en
 * offer som saknas i feeden nollas till UNKNOWN efter 24h → "Okänd" i pristabellen på
 * varor butiken hade hela tiden (Pitch Black ETB, 2026-07-25).
 *
 * DJUPET GÅR INTE ATT LÅSA. Butikerna lägger produkten olika djupt — och samma butik är
 * inte konsekvent: Swepoke `/alla-produkter/{slug}` (2), Shinycards `/pokemon/tins/{slug}`
 * (3) OCH `/pokemon/mega-evolution/chaos-rising/{slug}` (4). Varje gissad djupgräns kastar
 * en butiks halva sortiment tyst: `/pokemon/{kat}/{slug}` missade 9 av 18 på Swepokes
 * ETB-sida och 7 av 15 på Shinycards.
 *
 * Vad som DÄREMOT håller (mätt i båda butikernas riktiga markup): produktlänken står
 * FLERA gånger i blocket (bildlänk + titellänk), medan ankare (`#retail-bag-1`) och
 * systemsidor står en gång. Vi väljer därför den vanligaste vägen i blocket i stället för
 * att räkna segment — självvaliderande, och tål att butiken byter URL-struktur igen.
 */
export function productHrefInBlock(block: string): string | null {
  const counts = new Map<string, number>();
  for (const m of block.matchAll(/href="(\/[^"#?]+)"/g)) {
    const href = m[1].replace(/\/$/, "");
    // Minst två segment = en produktväg. "/pokemon" är kategorin, aldrig varan.
    if (href.split("/").length < 3) continue;
    if (NON_PRODUCT_PATH.test(href)) continue;
    counts.set(href, (counts.get(href) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [href, n] of counts) {
    if (best === null || n > (counts.get(best) ?? 0)) best = href;
  }
  return best;
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

  /** Hela sitemapens vägar — sparas av pokemonCategories för barn-nedstigningen. */
  private sitemapPaths: { url: string; path: string }[] = [];

  /** Pokémon-kategorisidor ur sitemap. */
  protected async pokemonCategories(errors: string[]): Promise<string[]> {
    const res = await politeFetch(`${this.baseUrl}/sitemap.xml`, { delayMs: 1000 });
    if (!res.ok) {
      errors.push(`${this.name}: sitemap HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const host = new URL(this.baseUrl).host;
    const urls: { url: string; path: string }[] = [];
    for (const loc of xml.match(/<loc>([^<]+)<\/loc>/g) ?? []) {
      const url = loc.replace(/<\/?loc>/g, "").trim().split("?")[0];
      if (!url.includes(host)) continue;
      try {
        urls.push({ url, path: new URL(url).pathname.replace(/\/$/, "") });
      } catch {
        /* trasig loc — hoppa */
      }
    }
    this.sitemapPaths = urls;
    const cats = new Set<string>();

    // ---- 1) DEN BEPRÖVADE REGELN, ORÖRD ----
    // /pokemon/{kategori} (exakt 2 segment) = kategorisida (ej produkt /{...}/{...}/...).
    // Hoppa över singel-/graderat-/tillbehörs-kategorier — vi prissätter singlar
    // via Cardmarket och bryr oss om sealed för restock. Snabbare + politare.
    for (const { url, path } of urls) {
      if (/^\/pokemon\/[^/]+$/.test(path) && !LEGACY_NON_SEALED.test(path)) cats.add(url);
    }

    // ---- 2) GENERALISERAD UPPTÄCKT (2026-08-07), ADDITIV MED FLIT ----
    // Toppsegmentet "pokemon" är Swepokes och Shinycards vana, inte Quickbutiks regel.
    // De nya butikerna lägger sitt sortiment någon annanstans: CardGame under
    // /engelska-pokmon-produkter (ja, felstavat — därav `pok[eé]?mon`), Mystery Shack
    // under /products/pokemon, Packs on Packs under /sealed-produkter, /engelska-packs
    // och /japanska-packs (som inte nämner Pokémon alls — butiken säljer nästan bara det).
    //
    // ⛔ UNION, ALDRIG ERSÄTTNING. En feed som tappar en URL nollar offern till "Okänd"
    //    efter 24h och nästa restock larmar aldrig (UNKNOWN→IN_STOCK är ingen övergång).
    //    Regel 1 får därför stå kvar exakt som den var: det här kan bara LÄGGA TILL.
    //    Vinsten syns direkt på befintliga butiker — Swepokes /japanska-pokemon-produkter
    //    och /pre-order-pokemon har aldrig hämtats.
    //
    // ⛔ TVÅSEGMENTS-VÄGAR KRÄVER BARN. På Packs on Packs ÄR /sealed-produkter/{slug} en
    //    produkt, inte en kategori — och den matchar "sealed". Att en väg är prefix till
    //    en annan väg i sitemap är butikens eget bevis för att den är en kategori.
    const hasChild = (path: string) => urls.some((u) => u.path.startsWith(`${path}/`));
    for (const { url, path } of urls) {
      const segments = path.split("/").filter(Boolean).length;
      if (segments < 1 || segments > 2) continue;
      if (NON_SEALED_CATEGORY.test(path) || NON_PRODUCT_CATEGORY.test(path)) continue;
      if (!POKEMON_MARKER.test(path) && !SEALED_MARKER.test(path)) continue;
      if (segments === 2 && !hasChild(path)) continue;
      cats.add(url);
    }

    // Pokémon-namngivna vägar först: taket ska gå till dem, inte till en generisk
    // "/sealed-produkter" som råkar stå tidigare i sitemap.
    return Array.from(cats)
      .sort((a, b) => Number(POKEMON_MARKER.test(b)) - Number(POKEMON_MARKER.test(a)))
      .slice(0, MAX_CATEGORIES);
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
      const href = productHrefInBlock(block);
      if (!href) continue;
      const title = titleM[1].replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
      byData.push({ title, priceOre, url: `${this.baseUrl}${href}`, inStock: qbBlockStock(block).buyable });
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
      // Samma slutsåld-markörer som primärparsern (via qbBlockStock, kommentarsfri text).
      // Fallbacken kollade förr BARA "Ej tillgänglig" och antog i lager annars → en
      // produkt vars knapp säger "Slutsåld" rapporterades som I LAGER (Pitch Black ETB,
      // 2026-07-28).
      out.push({ title, priceOre, url: `${this.baseUrl}${href}`, inStock: !qbBlockStock(seg).soldOut });
    }
    return out;
  }

  /**
   * Direkta BARN till en kategoriväg i sitemapen som själva är kategorier (har egna
   * barn) och passerar samma filter som upptäckten. Används bara när förälderns sida
   * renderade noll produkter — se MAX_CHILD_CATEGORIES.
   */
  private sitemapChildren(parentPath: string): { url: string; path: string }[] {
    const out: { url: string; path: string }[] = [];
    for (const u of this.sitemapPaths) {
      if (!u.path.startsWith(`${parentPath}/`)) continue;
      if (u.path.slice(parentPath.length + 1).includes("/")) continue; // bara direkta barn
      if (NON_SEALED_CATEGORY.test(u.path) || NON_PRODUCT_CATEGORY.test(u.path)) continue;
      if (!this.sitemapPaths.some((c) => c.path.startsWith(`${u.path}/`))) continue; // barnlös = produkt
      out.push(u);
    }
    return out;
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    try {
      const categories = await this.pokemonCategories(errors);
      const queue = [...categories];
      const queued = new Set(queue.map((u) => new URL(u).pathname.replace(/\/$/, "")));
      let childBudget = MAX_CHILD_CATEGORIES;
      while (queue.length > 0) {
        const cat = queue.shift()!;
        let firstPageCount = -1;
        for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
          const url = page === 1 ? cat : `${cat}?page=${page}`;
          const res = await politeFetch(url, { delayMs: 900 });
          if (!res.ok) {
            if (page === 1) errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          const html = await res.text();
          const found = this.parseProducts(html);
          if (page === 1) firstPageCount = found.length;
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
        // LANDNINGSSIDA: sida 1 fanns men bar noll produktblock → varorna bor hos
        // barnen (CardGames JP/CN-hylla på djup 3–4). Ställ barnen i kön; är även de
        // landningssidor tar samma regel dem vidare ett steg till.
        if (firstPageCount === 0 && childBudget > 0) {
          const catPath = new URL(cat).pathname.replace(/\/$/, "");
          for (const child of this.sitemapChildren(catPath)) {
            if (childBudget <= 0) break;
            if (queued.has(child.path)) continue;
            queued.add(child.path);
            queue.push(child.url);
            childBudget--;
          }
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

// ---------- Wave 4: Quickbutik-butiker (2026-08-07) ----------
// Verifierade mot sin egen markup före påslag: data-pid-block finns, robots.txt
// tillåter, och kategorivägarna ligger under egna toppsegment — vilket är precis
// varför productHrefInBlock inte får låsa URL-djupet (CardGame lägger produkter fyra
// segment ner: /engelska-pokmon-produkter/japansktkinesiskt/booster-packs/{slug}).
export class CardGameAdapter extends QuickbutikAdapter {
  name = "CardGame";
  baseUrl = "https://cardgame.se";
}
export class MysteryShackAdapter extends QuickbutikAdapter {
  name = "Mystery Shack";
  baseUrl = "https://mysteryshack.se";
}
// Ren sealed-butik: allt ligger under /sealed-produkter/{slug}.
export class PacksOnPacksAdapter extends QuickbutikAdapter {
  name = "Packs on Packs";
  baseUrl = "https://packsonpacks.se";
}

// ---------- Wave 5 (2026-08-13) ----------
// Verifierad mot sin egen markup före påslag (data-pid-block, robots.txt tillåter).
// Singlarna bor under /pokemon/los-pokemon/ — fällda av SINGLE_URL, se kommentaren där.
export class SpelkortsbutikenAdapter extends QuickbutikAdapter {
  name = "Spelkortsbutiken";
  baseUrl = "https://www.spelkortsbutiken.se";
}
