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
import { guessListingCategory } from "../listing-category";
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

/**
 * Taket höjt 30 → 60 (2026-08-13): TCG Store har 47 Pokémon-matchande kollektioner och
 * `.slice(0, 30)` kapade TYST de 17 sista — i collections.json-ordning låg de NYASTE
 * seten där (Prismatic Evolutions, Surging Sparks, Journey Together). Ett tak får
 * aldrig vara tyst: fetchProducts loggar när filtret matchar fler än taket.
 */
const MAX_COLLECTIONS = 60;
const MAX_PAGES_PER_COLLECTION = 8;
/**
 * /products.json (wholeCatalog) får ett högre sidtak: hela sortimentet är per
 * definition större än en kollektion. TCG Store = 2 677 produkter = 11 sidor,
 * Speltrollet = 4 117 = 17 sidor (mätt 2026-08-13). Fylls sista sidan varnar
 * fetchProducts precis som för kollektioner — taket är ett skyddsräcke, aldrig
 * en tyst gräns.
 */
const MAX_PAGES_WHOLE_CATALOG = 20;

/** Produkten bär Pokémon-markören någonstans Shopify visar den (titel/typ/taggar). */
function hasPokemonMarker(p: ShopifyProduct): boolean {
  return (
    /pok[eé]mon/i.test(p.title) ||
    /pok[eé]mon/i.test(p.product_type ?? "") ||
    (p.tags ?? []).some((t) => /pok[eé]mon/i.test(t))
  );
}

/**
 * Paus mellan JSON-hämtningar mot SAMMA Shopify-butik. 300 ms (≤3,3 req/s) i stället
 * för politeFetchs 1500/1200 ms: butikerna hostas av Shopify och `/collections/...
 * products.json` serveras från deras CDN-edge (mätt 2026-08-13: Dragon's Lair-sida på
 * 0,15–0,27 s, 600 kB) — lasten landar hos Shopify, inte på en småbutiks egen server.
 * Det här är restock-lanens största latenspost: Speltrollet har 28 Pokémon-kollektioner
 * och TCG Store 47, dvs ~30–50 requests per svep; 1200 ms paus gjorde EN butik till
 * ~40 s medan 300 ms ger ~15 s. politeFetch backar fortfarande av på 429/5xx.
 * ⛔ Gäller BARA Shopify-JSON — Quickbutik/Woo/custom-butiker kör sina egna servrar
 * och behåller sina långsammare takter.
 */
const SHOPIFY_JSON_DELAY_MS = 300;

/**
 * Kollektionslistan cachas i minnet per butik i 10 min: i loop-läget (Discord-lanen
 * kör flera svep i samma process) är listan stabil mellan tick, och en request per
 * butik och tick var ren omkostnad. Nya kollektioner syns inom TTL:n; korta jobb
 * (scrape-all) märker ingen skillnad — de frågar ändå bara en gång.
 */
const COLLECTIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const collectionsCache = new Map<string, { at: number; handles: string[] }>();

/**
 * Kollektioner vi aldrig hämtar: löskort/graderat och rena merch-hyllor.
 *
 * Butikerna vi hade tidigare sålde nästan bara sealed ur sina Pokémon-kollektioner.
 * De nya gör inte det — Pokétalk har 113 Pokémon-kollektioner, varav flera heter
 * "loskort" och "graderade kort", och taket på 30 kollektioner hade då avgjorts av
 * ordningen i collections.json i stället för av innehållet: singlarna hade ätit upp
 * platserna och de riktiga sealed-kollektionerna fallit utanför.
 *
 * Vakterna i ensureListingProduct fångar annonserna ändå (isSingleCardListing,
 * isMerchandiseListing) — det här sparar hämtningar och, viktigare, PLATSER i taket.
 *
 * ⛔ MÄTT FÖRE PÅSLAG (2026-08-07) mot alla fyra befintliga Shopify-butikers riktiga
 *    feedar: 0 kollektioner bortfiltrerade, 0 produkt-handles förlorade
 *    (Speltrollet 379, Samlarhobby 250, Goblinen 21, Manatörsk 38 — oförändrat).
 *    En feed som tappar en URL nollar offern till "Okänd" efter 24h, så den mätningen
 *    är kravet för att röra det här filtret igen.
 */
const NON_SEALED_COLLECTION =
  /l[oö]s(a|t)?[\s-]*kort|l[oö]skort|\bsingles?\b|\bsinglar\b|singel|gradera|\bgraded\b|\bslabs?\b|gosedjur|plush|figur|affisch|poster|kl[äa]der/i;

/**
 * Shopify Markets serverar products.json med pris per BESÖKARENS marknad (geo/cookie).
 * Våra jobb kör på GitHub Actions (US-datacenter) → utan detta får vi den utländska
 * marknadens EX-moms-pris (Goblinen: 55,20 = 69/1,25; DE-marknaden gav t.o.m. 6,95).
 * `localization`-cookien är auktoritativ och överstyr geo → pinna svenska marknaden så
 * priset ALLTID är ink. moms, oavsett var runnern står. Butiker utan Markets ignorerar den.
 */
const SE_MARKET_HEADERS = { cookie: "localization=SE", "accept-language": "sv-SE" } as const;

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

  /**
   * Läs HELA sortimentet via /products.json i stället för per kollektion.
   *
   * För butiker där kollektionerna inte kan avgränsa Pokémon:
   *  - Pokexclusive: kollektionerna är TOMMA i JSON-API:t (alla nio svarar
   *    `{"products":[]}`, mätt 2026-08-07) medan `/products.json` ger allt.
   *  - Samlarhobby: kollektionerna är TYP-baserade ("tins", "booster-boxar",
   *    "elite-trainer-boxar") och blandar franchiser UTAN "pokemon" i namnet — enda
   *    namnträffen är master-kollektionen "pokemon", som bara bar 379 av katalogens
   *    975 produkter (mätt 2026-08-13). 596 låg utanför, däribland Pokémon-tins och
   *    -boosters vars restocks därför aldrig kunde larma någonstans.
   * ⚠️ På en fler-franchise-butik hämtar den här vägen även One Piece/Lorcana/sport.
   *    Det är avgränsat och billigt: feed-först-grenen släpper bara igenom sealed-
   *    kategorier, och positiv Pokémon-evidens krävs för att en produkt ska skapas —
   *    uppmätt på Samlarhobby är merkostnaden ~60 främmande sealed-titlar som avvisas
   *    med regex (ingen LLM, ingen extra HTTP efter första körningen). Väg det mot
   *    alternativet: ett namnfilter som strukturellt ALDRIG kan se hela sortimentet.
   */
  protected wholeCatalog = false;

  /**
   * wholeCatalog MED per-produkt-filter (titel/typ/taggar måste bära "pokemon").
   * För STORA fler-franchise-butiker där ofiltrerad wholeCatalog hade fyllt feeden
   * med tusentals främmande varor. ⛔ Slå bara på efter att ha MÄTT att inga i dag
   * täckta produkter saknar markören — Speltrollet: 0 av 368 täckta föll ut,
   * 1 083 av 4 117 markerade (2026-08-13). Kanto Vault är MOTEXEMPLET: 349 av
   * deras 422 produkter (graderade singlar, "Charizard PSA 9 …") saknar markören —
   * där vore filtret en katastrof, men butiken är ren Pokémon så ofiltrerad
   * wholeCatalog är rätt.
   */
  protected wholeCatalogPokemonOnly = false;

  /**
   * Kollektions-handles som ALDRIG hämtas för just den här butiken, utöver det
   * generella namnfiltret. För hyllor vars namn inte avslöjar innehållet: Aquitaz
   * "pokemonkort" är 3 896 SINGLAR (mätt 2026-08-13 — fyllde sidtaket varje svep
   * med rader som ändå skippas nedströms).
   */
  protected excludedCollections: string[] = [];

  /**
   * Titlar som aldrig blir annonser för just den här butiken. Behövs när en
   * produktTYP inte går att avgränsa via kollektioner: Rogerz vägda vintage-packs
   * är korslistade i de vanliga set-kollektionerna, så kollektionsuteslutningen
   * ensam läckte 42 av dem (mätt 2026-08-13). Titelfiltret är sista grinden och
   * prövas mot BÅDE produkttiteln och varje splittad variants sammansatta titel.
   */
  protected dropTitles: RegExp | null = null;

  /** Hämtar Pokémon-kollektionernas handles (minnescachade 10 min — se konstanten). */
  protected async pokemonCollections(errors: string[]): Promise<string[]> {
    const cached = collectionsCache.get(this.baseUrl);
    if (cached && Date.now() - cached.at < COLLECTIONS_CACHE_TTL_MS) return cached.handles;

    const res = await politeFetch(`${this.baseUrl}/collections.json?limit=250`, { delayMs: SHOPIFY_JSON_DELAY_MS, headers: SE_MARKET_HEADERS });
    if (!res.ok) {
      errors.push(`${this.name}: collections.json HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { collections?: { handle: string; title: string }[] };
    const matched = (data.collections ?? [])
      .filter((c) => {
        const s = `${c.handle} ${c.title}`.toLowerCase();
        return /pok[eé]mon/.test(s) && !/lego/.test(s) && !NON_SEALED_COLLECTION.test(s);
      })
      .map((c) => c.handle)
      .filter((h) => !this.excludedCollections.includes(h));
    // Ett tyst tak var exakt så TCG Stores nyaste set försvann ur feeden — kapas det
    // ska det synas i loggen, varje gång.
    if (matched.length > MAX_COLLECTIONS) {
      console.warn(
        `[shopify] ${this.name}: ${matched.length} Pokémon-kollektioner matchade men taket är ` +
          `${MAX_COLLECTIONS} — ${matched.length - MAX_COLLECTIONS} hämtas INTE: ` +
          matched.slice(MAX_COLLECTIONS).join(", ")
      );
    }
    const handles = matched.slice(0, MAX_COLLECTIONS);
    collectionsCache.set(this.baseUrl, { at: Date.now(), handles });
    return handles;
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();
    try {
      // Butiker vars kollektioner är TOMMA i JSON-API:t (se wholeCatalog) läser hela
      // sortimentet i stället — `null` som handle betyder "/products.json" utan kollektion.
      const handles = this.wholeCatalog ? [null] : await this.pokemonCollections(errors);
      for (const handle of handles) {
        const maxPages = handle === null ? MAX_PAGES_WHOLE_CATALOG : MAX_PAGES_PER_COLLECTION;
        for (let page = 1; page <= maxPages; page++) {
          const url = handle === null
            ? `${this.baseUrl}/products.json?limit=250&page=${page}`
            : `${this.baseUrl}/collections/${handle}/products.json?limit=250&page=${page}`;
          const res = await politeFetch(url, { delayMs: SHOPIFY_JSON_DELAY_MS, headers: SE_MARKET_HEADERS });
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
            if (handle === null && this.wholeCatalogPokemonOnly && !hasPokemonMarker(p)) continue;
            products.push(...this.toRaws(p));
          }
          if (batch.length < 250) break;
          // Sista tillåtna sidan kom FULL → det finns fler produkter vi aldrig ser.
          // Samma regel som kollektionstaket: kapa aldrig tyst.
          if (page === maxPages) {
            console.warn(
              `[shopify] ${this.name}: ${handle ?? "/products.json"} fyllde alla ` +
                `${maxPages} sidor (${maxPages * 250} produkter) — resten hämtas INTE. ` +
                `Höj sidtaket.`
            );
          }
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
    if (this.dropTitles?.test(p.title)) return [];

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
        if (this.dropTitles?.test(title)) continue;
        out.push({
          externalId: `${this.idPrefix}-${p.id}-${v.id}`,
          title,
          url: variantUrl(this.baseUrl, p.handle, v.id),
          price: priceOre,
          currency: "SEK",
          stockStatus: v.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
          imageUrl: v.featured_image?.src ?? p.images?.[0]?.src,
          category: guessListingCategory(title),
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
        category: guessListingCategory(p.title),
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
// Butiken har SLUTAT kurera sina kollektioner (mätt 2026-08-13: per-set-kollektionerna
// är tomma eller nästan tomma, "mega-evolution" = 5 produkter) — 281 sealed låg helt
// utanför de 28 pokemon-namngivna kollektionerna. Markörfiltrerad wholeCatalog i
// stället: 0 av 368 täckta produkter föll ut, +~700 markerade tillkom (17 sidor,
// ungefär samma requestbudget som kollektionsvägens 28+).
export class SpeltrolletAdapter extends ShopifyAdapter {
  name = "Speltrollet";
  baseUrl = "https://speltrollet.se";
  protected wholeCatalog = true;
  protected wholeCatalogPokemonOnly = true;
}
// Typ-kollektioner utan "pokemon" i namnet → namnfiltret såg bara master-kollektionen
// (379 av 975 produkter). wholeCatalog är enda kompletta vägen — se fältets doc.
export class SamlarhobbyAdapter extends ShopifyAdapter {
  name = "Samlarhobby";
  baseUrl = "https://samlarhobby.se";
  protected wholeCatalog = true;
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

// ---------- Wave 4: Shopify-butiker (2026-08-07) ----------
// Alla verifierade mot sin egen collections.json före påslag: plattform = Shopify,
// products.json svarar, robots.txt tillåter, och namnfiltret hittar minst en
// Pokémon-kollektion med varor i. Ingen av dem behöver en egen kollektionslista —
// de namnger sina hyllor med "pokemon" precis som basklassen förutsätter.
// 47 Pokémon-matchande kollektioner (2026-08-13) — det gamla 30-taket kapade de 17
// SISTA, där de nyaste seten låg (Prismatic Evolutions, Surging Sparks, Journey
// Together). Hela katalogen är 2 677 produkter = 11 sidor, dvs FÄRRE requests än
// kollektionsvägen och strukturellt komplett — samma resonemang som Samlarhobby.
export class TcgStoreAdapter extends ShopifyAdapter {
  name = "TCG Store";
  baseUrl = "https://tcgstore.se";
  protected wholeCatalog = true;
}
export class BeamCardshopAdapter extends ShopifyAdapter {
  name = "Beam Cardshop";
  baseUrl = "https://beamcardshop.com";
}
// 45 sealed låg i INGEN kollektion alls (bara i /products.json, mätt 2026-08-13).
// Katalogen är 591 produkter = 3 sidor; främmande TCG (MTG/sport) avvisas nedströms
// av positiv Pokémon-evidens — ofiltrerad wholeCatalog, samma familj som Samlarhobby.
export class HobbykortAdapter extends ShopifyAdapter {
  name = "Hobbykort";
  baseUrl = "https://hobbykort.se";
  protected wholeCatalog = true;
}
// 113 Pokémon-kollektioner men bara 744 produkter totalt (mätt 2026-08-13) —
// /products.json är 3 sidor mot kollektionsvägens ~30 requests, och kan inte missa
// en hylla vars namn inte innehåller "pokemon". Singlar/graderat i feeden filtreras
// nedströms precis som för Samlarhobby.
export class PoketalkAdapter extends ShopifyAdapter {
  name = "Pokétalk";
  baseUrl = "https://www.poketalk.se";
  protected wholeCatalog = true;
}
// Ren Pokémon-butik, 422 produkter = 2 sidor — wholeCatalog är BILLIGARE än
// kollektionsvägen och täcker de Illustration Collections som låg utanför.
// ⛔ ALDRIG wholeCatalogPokemonOnly här: 349 av 422 (graderade singlar) saknar
// markören i titeln — de skippas ändå nedströms, men får inte filtreras i feeden.
export class KantoVaultAdapter extends ShopifyAdapter {
  name = "Kanto Vault";
  baseUrl = "https://kantovault.se";
  protected wholeCatalog = true;
}
export class PokemurreAdapter extends ShopifyAdapter {
  name = "Pokemurre";
  baseUrl = "https://pokemurre.se";
}
export class AuroraDexAdapter extends ShopifyAdapter {
  name = "AuroraDex";
  baseUrl = "https://auroradex.se";
}
export class TinyMistersAdapter extends ShopifyAdapter {
  name = "Tiny Misters";
  baseUrl = "https://tinymisters.com";
}
export class CardlevelsAdapter extends ShopifyAdapter {
  name = "Cardlevels";
  baseUrl = "https://cardlevels.se";
}
export class KortarkivetAdapter extends ShopifyAdapter {
  name = "Kortarkivet";
  baseUrl = "https://www.kortarkivet.se";
}
export class RahTechAdapter extends ShopifyAdapter {
  name = "RahTech";
  baseUrl = "https://rahtech.se";
}
export class CardClubAdapter extends ShopifyAdapter {
  name = "Card Club";
  baseUrl = "https://cardclub.se";
}
export class BlindboxAdapter extends ShopifyAdapter {
  name = "Blindbox";
  baseUrl = "https://blindbox.se";
}
export class RgbKingzAdapter extends ShopifyAdapter {
  name = "RGB Kingz";
  baseUrl = "https://rgbkingz.com";
}
// Fler-spels-butik (Warhammer/brädspel) — ENDA Pokémon-kollektionen är "pokemon-tcg".
export class MiniatureMetropolisAdapter extends ShopifyAdapter {
  name = "Miniature Metropolis";
  baseUrl = "https://miniaturemetropolis.se";
}
// Ren Pokémon-butik vars kollektioner är TOMMA i JSON-API:t (alla nio svarar
// {"products":[]}) medan /products.json ger hela sortimentet — därav wholeCatalog.
export class PokexclusiveAdapter extends ShopifyAdapter {
  name = "Pokexclusive";
  baseUrl = "https://pokexclusive.se";
  protected wholeCatalog = true;
}
export class SpelgalaxenAdapter extends ShopifyAdapter {
  name = "Spelgalaxen";
  baseUrl = "https://spelgalaxen.se";
}

// ---------- Wave 5: Shopify-butiker (2026-08-13) ----------
// Alla verifierade mot sin egen collections.json före påslag, samma metod som Wave 4.
// >1000 sealed inkl. stora JP/CN/KR-sortiment — kinesiska/koreanska annonser fälls av
// isBlockedListingLanguage och JP-tvillingvakten (2026-08-10) gör den tunga lyftningen.
export class AquitazAdapter extends ShopifyAdapter {
  name = "Aquitaz";
  baseUrl = "https://aquitaz.se";
  // "pokemonkort" = 3 896 singlar (fyllde sidtaket varje svep); "rip-ship" = live-
  // öppningar i ström, inte sealed som skickas hem — ingen katalogvara. Sealed täcks
  // av de granulära hyllorna (booster-box/packs/etbs/tins/JP/CN/KR/set-kollektioner).
  protected excludedCollections = ["pokemonkort", "rip-ship-tcg-pokemon"];
}
// Dansk butik på Shopify Markets — `localization=SE`-cookien (SE_MARKET_HEADERS) ger
// verifierat SEK-priser (Pitch Black PC ETB = 2 411,00 SEK, mätt 2026-08-13).
export class RogerzAdapter extends ShopifyAdapter {
  name = "Rogerz";
  baseUrl = "https://rogerz.dk";
  // VÄGDA vintage-packs ("(Heavy) - Scyther", "17.68g"): ett lotteri per gram, inte
  // en SKU — varianterna bär karaktärsnamn så splittern hade gjort en annons per
  // vägning, och de är KORSLISTADE i vanliga set-kollektioner (uteslutningen av
  // heavy-kollektionen ensam läckte 42, mätt 2026-08-13). Ovägda vintage-packs
  // (pokemon-vintage-booster-pakker) är riktiga produkter och hämtas som vanligt.
  protected excludedCollections = ["heavy-pokemon-booster-pack"];
  protected dropTitles = /\((heavy|light|medium)\)|\bheavy\b|\d+[.,]\d+\s*g\s*\//i;
}
// Tysk butik på Shopify Markets — samma cookie, verifierat SEK (mätt 2026-08-13).
export class YonkoTcgAdapter extends ShopifyAdapter {
  name = "Yonko TCG";
  baseUrl = "https://yonko-tcg.de";
}
export class FiregamesAdapter extends ShopifyAdapter {
  name = "Firegames";
  baseUrl = "https://firegames.se";
}

// ---------- Wave 6: Shopify-butiker (2026-08-17) ----------
// TCG Picks (Skene) — ägaren såg deras Storm Emeralda-restock i en KONKURRENTS
// Discord men inte i vår. Butiken fanns inte som källa alls.
//
// ⛔ `tcgpicks.se` 301:ar till `tcgpicks.com` — bas-URL:en MÅSTE vara .com. En 301 är
//    gratis bara för webbläsare (samma regel som apex-domänen i CLAUDE.md): feed-URL:er
//    byggs av adaptern och `politeFetch` hämtar robots.txt för den värd vi PEKAR PÅ.
//
// wholeCatalog för att kollektionsNAMN-filtret strukturellt inte kan fungera här:
// butiken har 20 kollektioner och de som bär sealed heter "booster-boxes",
// "elite-trainer-boxes", "sealed-products" och "upc-spc-boxes" — INGEN med "pokemon"
// i namn eller handle (mätt 2026-08-17). Namnfiltret hade hittat fyra hyllor, varav
// tre är singlar/graderat/displaystativ. Hela katalogen är 888 produkter = **4
// hämtningar** (250+250+250+138 → sista sidan bryter loopen), alltså BILLIGARE än
// kollektionsvägen och utan tyst tak.
// ⛔ INGEN `wholeCatalogPokemonOnly`: 784 av 888 är löskort och 55 sealed, och alla
//    839 bär "Pokemon TCG - …" som product_type — markörfiltret hade alltså inte tagit
//    bort singlarna (de fälls nedströms av isSingleCardListing ändå), bara de 49
//    otypade raderna (slab guards, pärmar, 3D-figurer). Samma skäl som Kanto Vault:
//    ren Pokémon-butik ⇒ ofiltrerad wholeCatalog, ingen risk att en framtida sealed-SKU
//    utan markör faller ur feeden tyst.
export class TcgPicksAdapter extends ShopifyAdapter {
  name = "TCG Picks";
  baseUrl = "https://tcgpicks.com";
  protected wholeCatalog = true;
}
