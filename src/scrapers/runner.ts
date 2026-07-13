/**
 * Kör ett insamlingsjobb för en källa: hämtar produkter via adapter,
 * matchar mot katalogen, uppdaterar erbjudanden, skapar prisobservationer
 * (rådata separat i rawData), dagliga prissnapshots, restock-händelser
 * och triggar alerts.
 *
 * Säkerhetsregler: jobbet avbryts automatiskt om felräknaren passerar 20.
 */
import { JobStatus, SourceType, StockStatus, type Prisma, type ProductCategory } from "@prisma/client";
import { prisma, withDbRetry } from "@/lib/db";
import { normalizeTitle, slugify } from "@/lib/utils";
import { MockAdapter } from "@/scrapers/adapters/mock-adapter";
import { PokemonTcgAdapter } from "@/scrapers/adapters/pokemontcg-adapter";
import { SpelexpertenAdapter } from "@/scrapers/adapters/spelexperten-adapter";
import { WebhallenAdapter } from "@/scrapers/adapters/webhallen-adapter";
import { AlphaspelAdapter } from "@/scrapers/adapters/alphaspel-adapter";
import { TraderaAdapter } from "@/scrapers/adapters/tradera-adapter";
import { CardmarketPriceGuideAdapter } from "@/scrapers/adapters/cardmarket-adapter";
import {
  SpeltrolletAdapter,
  SamlarhobbyAdapter,
  GoblinenAdapter,
  DragonsLairAdapter,
  ManatorskAdapter,
} from "@/scrapers/adapters/shopify-adapter";
import {
  SwepokeAdapter,
  ShinycardsAdapter,
} from "@/scrapers/adapters/quickbutik-adapter";
import { MaxGamingAdapter } from "@/scrapers/adapters/maxgaming-adapter";
import {
  classifyForm,
  cleanListingTitle,
  isPlausiblePriceFor,
  loadMatchIndex,
  matchProduct,
  type MatchIndex,
} from "@/scrapers/matching";
import { judgeSameProduct } from "@/lib/same-product";
import { netStockEvent, isRestock, isNewInStockArrival } from "@/scrapers/restock";
import { isCardmarketRedirect, isEnglishCardmarketUrl } from "@/lib/marketplace-urls";
import { isBlockedListingLanguage, listingCardLanguage } from "@/lib/listing-language";
import type { SourceAdapter } from "@/scrapers/types";
import { checkPriceAlerts, checkRestockAlerts, checkListingAlerts } from "@/services/alerts";
import { CARDMARKET_SOURCE_NAMES, HIDDEN_CATEGORIES, NON_RETAIL_SOURCE_NAMES } from "@/services/products";
import { dispatchPendingAlerts } from "@/services/notifications";
import { mapPool } from "@/lib/concurrency";

const MAX_ERRORS = 20;

/** Namn → adapter-klass för SCRAPER-typ-källor. */
const SCRAPER_ADAPTERS: Record<string, new () => SourceAdapter> = {
  Spelexperten: SpelexpertenAdapter,
  Webhallen: WebhallenAdapter,
  "Dragon's Lair": DragonsLairAdapter,
  Alphaspel: AlphaspelAdapter,
  Tradera: TraderaAdapter,
  // Shopify-butiker (återanvändbar ShopifyAdapter)
  Speltrollet: SpeltrolletAdapter,
  Samlarhobby: SamlarhobbyAdapter,
  Goblinen: GoblinenAdapter,
  Manatörsk: ManatorskAdapter,
  // Quickbutik-butiker (återanvändbar QuickbutikAdapter)
  Swepoke: SwepokeAdapter,
  Shinycards: ShinycardsAdapter,
  // Custom-plattform (server-renderad PT_-markup)
  MaxGaming: MaxGamingAdapter,
};

export function getAdapter(type: SourceType, sourceName?: string): SourceAdapter {
  switch (type) {
    case SourceType.MOCK:
      return new MockAdapter();
    case SourceType.API:
      // "Cardmarket" = officiella prisguiden (sealed); övriga API-källor = Pokémon TCG API
      if (sourceName === "Cardmarket") return new CardmarketPriceGuideAdapter();
      return new PokemonTcgAdapter();
    case SourceType.SCRAPER: {
      const AdapterClass = sourceName ? SCRAPER_ADAPTERS[sourceName] : undefined;
      if (!AdapterClass) {
        throw new Error(`Ingen scraper-adapter för "${sourceName}". Tillgängliga: ${Object.keys(SCRAPER_ADAPTERS).join(", ")}`);
      }
      return new AdapterClass();
    }
    default:
      throw new Error(`Adapter ej implementerad för källtyp: ${type}`);
  }
}

export interface ScrapeJobSummary {
  jobId: string;
  status: JobStatus;
  itemsFound: number;
  itemsUpdated: number;
  errorCount: number;
}

/** Hitta eller skapa en Retailer som motsvarar källan. */
async function getRetailerForSource(sourceName: string, baseUrl: string, type: SourceType) {
  return prisma.retailer.upsert({
    where: { name: sourceName },
    update: {},
    create: { name: sourceName, websiteUrl: baseUrl, sourceType: type },
  });
}

export interface RestockScanResult {
  sources: number;
  checked: number;
  restocks: number;
  newListings: number;
  alertsSent: number;
  skipped?: boolean; // true = feed oförändrad, DB-fasen hoppades över (Neon sov)
  /** Källorna skanningen använde — CLI-wrappern cachar listan på disk så nästa
   *  körning slipper väcka Neon bara för källist-uppslaget. */
  sourceList?: RestockSourceInfo[];
}

/** Det minimum en restock-skanning behöver veta om en källa (cachebart som JSON). */
export interface RestockSourceInfo {
  name: string;
  type: SourceType;
  baseUrl: string;
  /** Feeden returnerar en roterande delmängd av sortimentet (Quickbutik/Swepoke) —
   *  en URL som "dyker upp" kan vara urgammal → inga "ny produkt"-larm för källan. */
  rotatingFeed?: boolean;
}

/** Hur många butiker som hämtas parallellt (olika hostar → artigt per värd ändå). */
const RESTOCK_SCAN_CONCURRENCY = 4;

/** En normaliserad annons från en butiksfeed, med det som ett feed-först-larm behöver. */
type FeedItem = {
  url: string;
  stockStatus: StockStatus;
  title: string;
  price: number | null;
  imageUrl: string | null;
  category: string | null;
};

/**
 * Feed-först-larm är BARA för sealed — singlar/övrigt (adaptrarnas guessCategory →
 * "OTHER") sköts av Cardmarket/Tradera och skulle spamma (butiker som Swepoke/
 * Shinycards har tusentals singlar). Alla watched-adaptrar delar dessa etiketter.
 * ponytail: ett sealed som guessCategory missar (→ "OTHER") får inget ny-produkt-larm
 * här, men daglig scrape-all matchar+skapar dess offer och offer-grenen täcker restocks.
 */
const SEALED_FEED_CATEGORIES = new Set([
  "BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER",
]);

/**
 * Auto-import: säkerställ att en katalogprodukt finns för en sealed butiksannons (feed-
 * först). Länkar till befintlig produkt vid HÖG matchkonfidens (≥0.85). Under det men
 * över matcher-golvet (0.55–0.85) får en billig LLM-dom (Haiku) avgöra "samma SKU?" —
 * hellre ett öres-anrop än en dubblettprodukt; utan ANTHROPIC_API_KEY skapas som förr
 * en ny produkt (veckodedupen städar). Upsertar butikens offer så URL:en får ett
 * Offer → nästa skanning går via den beprövade offer-diffen. Returnerar productId
 * (null om kategori saknas eller språket är blockat).
 */
export async function ensureListingProduct(
  it: { title: string; url: string; price: number | null; imageUrl: string | null; retailerId: string; category: string | null },
  stockStatus: StockStatus
): Promise<string | null> {
  const category = (it.category ?? null) as ProductCategory | null;
  if (!category) return null;
  // Blockade språk (kinesiska/koreanska) får ALDRIG bli katalogprodukter — kolla
  // även butiks-URL:en (DL:s "…-kinesisk-version"-slug avslöjade en latinsk titel).
  if (isBlockedListingLanguage(it.title, it.url)) return null;
  // Cross-produkt-vakt: ägs URL:en redan av en produkt (t.ex. länkad av scrape-all-
  // matcharen) → använd DEN länken. Skapa aldrig en andra produkt/offer för samma
  // butikssida — det var så dubblettstubbarna uppstod (34 delade URL:er, städat 07-07).
  const owner = await prisma.offer.findFirst({
    where: { retailerId: it.retailerId, url: it.url },
    select: { productId: true },
  });
  if (owner) return owner.productId;
  // Butiks-skräp ("MAX 1 per kund", "förhandsbokning", "(kopia)") bort INNAN
  // matchning/namnsättning — annars blir samma SKU från olika butiker
  // dubblettprodukter med skräpiga katalogtitlar.
  const cleanTitle = cleanListingTitle(it.title);
  // Lot-/kombo-annonser ("Booster Pack x4", "ETB + bundle") är inte katalogprodukter
  // — matchProduct vägrar matcha dem, men UTAN denna vakt skapades de som stubbar.
  const form = classifyForm(normalizeTitle(cleanTitle));
  if (form === "multipack" || form === "case" || form === "combo" || form === "event") return null;
  const normalized = normalizeTitle(cleanTitle);
  const match = await matchProduct(normalized);
  let productId = match && match.confidence >= 0.85 ? match.productId : null;
  // Gränsfall 0.55–0.85: matcharen hittade EN kandidat men vågar inte binda den.
  // LLM-domen (samma som veckodedupen) avgör — attach istället för dubblettstub.
  if (!productId && match) {
    const candidate = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { title: true },
    });
    if (candidate) {
      const verdict = await judgeSameProduct(cleanTitle, candidate.title);
      if (verdict?.same) productId = match.productId;
    }
  }
  if (!productId) {
    let slug = slugify(cleanTitle) || `produkt-${Date.now().toString(36)}`;
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const p = await prisma.product.create({
      data: { title: cleanTitle, normalizedTitle: normalized, slug, category, imageUrl: it.imageUrl, language: listingCardLanguage(it.title, it.url) },
      select: { id: true },
    });
    productId = p.id;
  }
  // Offer-språket följer annonsen (japansk annons → JP-offer), inte hårdkodat EN.
  const offerLanguage = listingCardLanguage(it.title, it.url);
  // Butiken kan redan ha en offer för produkten via en ANNAN sida (variant) — kapa
  // inte den offerens URL (varianten spåras i StoreListing-huvudboken). Bara skapa
  // när offer saknas helt; URL:en själv är obelagd (owner-vakten ovan returnerade annars).
  const existing = await prisma.offer.findFirst({
    where: { productId, retailerId: it.retailerId, condition: "SEALED", language: offerLanguage },
    select: { id: true },
  });
  if (!existing) {
    await prisma.offer.create({
      data: { productId, retailerId: it.retailerId, condition: "SEALED", language: offerLanguage, price: it.price, currency: "SEK", stockStatus, url: it.url },
    });
  }
  return productId;
}

/**
 * Lätt restock-skanning av ALLA sealed-produkter som de restock-bevakade butikerna
 * aktivt säljer (ej singlar, ej marknadsplats-only — de kommer från Cardmarket/Tradera
 * som inte är restockWatch-källor). Två faser så Neon hålls vaken minimalt:
 *
 *   1. Hämta alla butikers kataloger PARALLELLT (bara HTTP → Neon sover).
 *   2. Läs befintliga offers EN gång och diffa lagerstatus per URL i minnet; skriv
 *      bara faktiska lagerövergångar (+ restock-alerts). Inga pris-/observationsskrivningar.
 *
 * Detta ersätter den tunga runScrapeJob-loopen för restock-bevakning: den skrev
 * pris + observation per produkt och höll Neon igång ~40 min/körning, vilket
 * tvingade fram 4h-takt. Den här är billig nog att köra varje timme inom free-tier.
 *
 * Nya produkter (ingen offer än) plockas upp av daglig scrape-all och spåras sedan
 * härifrån. Priser uppdateras av scrape-all (denna rör bara lagerstatus).
 */
/**
 * `shouldProcess`: valfri grind som körs efter fas 1 (feed-hämtning) med de hämtade
 * annonserna. Returnerar false → hoppa DB-fasen (Neon förblir sovande). CLI-wrappern
 * skickar in en fingerprint-jämförelse här (fs/crypto bor i scriptet, EJ i denna modul
 * som Next buntar). Utan grind körs allt som vanligt.
 */
/**
 * Vilka offers ska nollställas för att deras URL FÖRSVUNNIT ur feeden? De vars butik
 * hämtades den här körningen (`feedRetailers`, ≥1 produkt) men vars URL saknas i
 * feeden (`freshKeys`). Ren funktion → testbar utan DB/adaptrar.
 *
 * Frånvaro ≠ slutsåld: dessa sätts till UNKNOWN (inte OUT_OF_STOCK). En produkt som
 * försvinner ur feeden är oftast avlistad ELLER bara utroterad (Quickbutik/Swepoke
 * roterar sortimentet) — vi VET inte att den sålde slut. UNKNOWN→IN_STOCK är ingen
 * äkta lagerövergång (isRealStockTransition) → en utroterad produkt som dyker upp
 * igen återställs TYST istället för att spamma "Åter i lager" (23 000 kr-boxen som
 * "restockade" 9 ggr). Äkta slutförsäljning (butikens egen "slut"-flagga i feeden)
 * går via offer-diffen → OUT_OF_STOCK → nästa IN_STOCK är en riktig restock + larm.
 *
 * DEBOUNCE (`graceMs`): ett enda missat besök får inte nollställa — kräv att offern
 * varit borta i minst `graceMs` (senast sedd `lastSeenAt` äldre än så).
 */
export function offersToMarkSoldOut<
  T extends { retailerId: string; url: string; stockStatus: StockStatus; lastSeenAt: Date | null }
>(offers: T[], freshKeys: Set<string>, feedRetailers: Set<string>, now: Date, graceMs: number): T[] {
  return offers.filter(
    (o) =>
      feedRetailers.has(o.retailerId) &&
      o.stockStatus !== StockStatus.OUT_OF_STOCK &&
      o.stockStatus !== StockStatus.UNKNOWN &&
      !freshKeys.has(`${o.retailerId}:${o.url}`) &&
      (o.lastSeenAt == null || now.getTime() - o.lastSeenAt.getTime() >= graceMs)
  );
}

export async function runRestockScan(opts?: {
  // Snabb-fil: begränsa till namngivna butiker (t.ex. ["Manatörsk"]) → fingeravtrycket
  // täcker bara dem, så en tät körning väcker Neon bara när DE flippar. Utelämnas = alla.
  onlySources?: string[];
  // Cachad källista (från förra körningen) — utan denna väcker redan källist-
  // uppslaget Neon på VARJE körning, vilket på 2-min-snabbfilen = aldrig scale-to-zero.
  sources?: RestockSourceInfo[];
  shouldProcess?: (
    fetched: { sourceName: string; items: { url: string; stockStatus: StockStatus } [] }[]
  ) => boolean | Promise<boolean>;
}): Promise<RestockScanResult> {
  let sources: RestockSourceInfo[];
  if (opts?.sources?.length) {
    sources = opts.sources;
  } else {
    const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
    sources = active
      .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
      .map((s) => ({
        name: s.name,
        type: s.type,
        baseUrl: s.baseUrl,
        rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
      }));
  }
  if (opts?.onlySources?.length) {
    const only = new Set(opts.onlySources);
    sources = sources.filter((s) => only.has(s.name));
  }
  if (sources.length === 0) {
    console.log("[restock-scan] Inga restock-watch-källor flaggade.");
    return { sources: 0, checked: 0, restocks: 0, newListings: 0, alertsSent: 0, sourceList: [] };
  }

  // Fas 1: parallell katalog-hämtning (ingen DB → Neon sover under tiden).
  const fetched: { sourceName: string; items: FeedItem[] }[] = new Array(sources.length);
  await mapPool(sources, RESTOCK_SCAN_CONCURRENCY, async (source, i) => {
    try {
      const adapter = getAdapter(source.type, source.name);
      const result = await adapter.fetchProducts();
      const items: FeedItem[] = result.products
        .filter((p) => adapter.validateResult(p))
        .map((p) => {
          const n = adapter.normalizeProduct(p);
          return {
            url: n.url,
            stockStatus: n.stockStatus,
            title: p.title,
            price: n.offerPrice ?? n.price ?? null,
            imageUrl: n.imageUrl ?? p.imageUrl ?? null,
            category: n.category ?? null,
          };
        });
      fetched[i] = { sourceName: source.name, items };
    } catch (err) {
      console.error(`[restock-scan] ${source.name} misslyckades:`, err instanceof Error ? err.message : err);
      fetched[i] = { sourceName: source.name, items: [] };
    }
  });

  // Ändringsgrind (kvot-kritisk): väck INTE Neon om grinden säger att inget flippat
  // sedan förra körningen. Låter oss köra tätare (snabbare restock-fångst) utan mer
  // compute. Grinden (fingerprint-jämförelse + fs) skickas in av CLI-wrappern.
  if (opts?.shouldProcess && !(await opts.shouldProcess(fetched))) {
    return {
      sources: sources.length, checked: 0, restocks: 0, newListings: 0, alertsSent: 0,
      skipped: true, sourceList: sources,
    };
  }

  // NEON-UPPVAKNING. Fas 1 ovan rör INTE databasen (med flit — endpointen ska få sova,
  // det är hela poängen med ändringsgrinden). Nästa fråga är därför den första på ~36 s
  // och träffar en SUSPENDERAD Neon-compute. Prisma får då ibland P1017 "Server has
  // closed the connection" i stället för att vänta ut uppvaknandet → HELA skanningen dog
  // och mejlade ett falskt fellarm (2026-07-12 22:40). En trivial fråga med retry väcker
  // endpointen först. Den körs BARA här, efter ändringsgrinden — en oförändrad feed rör
  // fortfarande aldrig DB:n, så scale-to-zero är intakt.
  await withDbRetry(() => prisma.$queryRaw`SELECT 1`);

  // Fas 2 (DB-burst): retailer per källa + alla befintliga offers i EN läsning.
  const retailerByName = new Map<string, string>();
  const rotatingRetailerIds = new Set<string>();
  for (const source of sources) {
    const r = await getRetailerForSource(source.name, source.baseUrl, source.type);
    retailerByName.set(source.name, r.id);
    if (source.rotatingFeed) rotatingRetailerIds.add(r.id);
  }
  const retailerIds = [...new Set(retailerByName.values())];
  // ALLA offers (även gömda kategorier) så matchade URL:er känns igen som matchade
  // och inte felaktigt hamnar i feed-först-grenen. Gömda larmas ändå aldrig (guard nedan).
  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailerIds } },
    select: {
      id: true, url: true, productId: true, retailerId: true, stockStatus: true, lastSeenAt: true,
      product: { select: { category: true } },
    },
  });
  const offerByKey = new Map<string, (typeof offers)[number]>();
  for (const o of offers) offerByKey.set(`${o.retailerId}:${o.url}`, o);

  // Feed-först-huvudbok: rå annonser per URL, BARA för URL:er utan en Offer.
  const listings = await prisma.storeListing.findMany({
    where: { retailerId: { in: retailerIds } },
    select: { id: true, url: true, retailerId: true, stockStatus: true },
  });
  const listingByKey = new Map<string, (typeof listings)[number]>();
  for (const l of listings) listingByKey.set(`${l.retailerId}:${l.url}`, l);
  // Butiker vi aldrig fört huvudbok för seedas TYST (skapa rader, larma ej) — så
  // första körningen (och en nytillagd butik) inte mejlar hela dess katalog som "ny".
  const seededRetailers = new Set(listings.map((l) => l.retailerId));

  // Färsk annons per (retailer, url). IN_STOCK vinner om en URL dyker upp flera ggr.
  const fresh = new Map<string, FeedItem & { retailerId: string }>();
  for (const { sourceName, items } of fetched) {
    const retailerId = retailerByName.get(sourceName);
    if (!retailerId) continue;
    for (const it of items) {
      const key = `${retailerId}:${it.url}`;
      if (fresh.get(key)?.stockStatus === StockStatus.IN_STOCK) continue;
      fresh.set(key, { ...it, retailerId });
    }
  }

  let checked = 0;
  let restocks = 0;
  let newListings = 0;
  for (const [key, it] of fresh) {
    const newStatus = it.stockStatus;
    const offer = offerByKey.get(key);

    // ---- Matchad produkt: beprövad offer-diff (oförändrad logik) ----
    if (offer) {
      checked++;
      // ORDNINGEN ÄR KRITISK: larma FÖRST, flippa lagerstatus SIST. Statusflippen är det
      // som KONSUMERAR övergången — nästa körning diffar mot den. Flippade vi först och
      // dog innan larmet (workflow-cancel, timeout, evict) såg nästa körning ingen
      // övergång alls → restocken förlorades TYST för alltid. Med den här ordningen är
      // värsta utfallet att övergången upptäcks igen nästa körning, och cooldownen i
      // checkRestockAlerts äter dubbletten. Dubbelt larm >> missat larm.
      const ev = netStockEvent(offer.stockStatus, newStatus);
      // Gömda kategorier (pärmar/sleeves/graderat) uppdaterar lager men larmar aldrig.
      const hidden = HIDDEN_CATEGORIES.includes(offer.product.category);
      if (!hidden && ev.emit) {
        await prisma.restockEvent.create({
          data: {
            productId: offer.productId,
            retailerId: offer.retailerId,
            oldStatus: ev.oldStatus,
            newStatus,
            price: null,
          },
        });
        if (ev.isRestock) {
          await checkRestockAlerts(offer.productId, offer.retailerId);
          restocks++;
        }
      }
      if (offer.stockStatus !== newStatus) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: { stockStatus: newStatus, lastSeenAt: new Date() },
        });
      }
      continue;
    }

    // ---- Feed-först: URL utan Offer (ny SKU / art-variant / produkt utanför katalogen) ----
    // Bara sealed — singlar/övrigt skulle spamma (se SEALED_FEED_CATEGORIES).
    if (!SEALED_FEED_CATEGORIES.has(it.category ?? "")) continue;
    // Blockade språk (kinesiska/koreanska) auto-importeras inte "for now" → ingen ny
    // produkt, inget larm. Japanska släpps igenom (sealed → OK). Kolla även URL:en —
    // slugs som "…-kinesisk-version" avslöjar språk som titeln döljer.
    if (isBlockedListingLanguage(it.title, it.url)) continue;
    checked++;
    // Auto-import: skapa/länka katalogprodukt + offer → larmet pekar på VÅR produktsida
    // (in-app), och nästa skanning spårar URL:en via offer-diffen ovan.
    const productId = await ensureListingProduct(it, newStatus);
    const listing = listingByKey.get(key);
    if (!listing) {
      // Aldrig sedd → skapa huvudboksrad. Larma BARA om butiken redan har historik
      // (annars = tyst seedning) och annonsen faktiskt är i lager.
      const created = await prisma.storeListing.create({
        data: {
          retailerId: it.retailerId,
          url: it.url,
          title: it.title,
          price: it.price,
          imageUrl: it.imageUrl,
          stockStatus: newStatus,
        },
      });
      // Larma bara om butiken redan har historik (ej tyst seed). Ny produkt I LAGER
      // = NEW_LISTING; ny produkt i FÖRHANDSBOKNING = PREORDER (köpbar inför release).
      // Roterande feeds (Swepoke) undantas: en "ny" URL där är oftast en URGAMMAL
      // annons som roterat in i synfältet (23 000 kr-boxen larmades som "ny produkt").
      if (seededRetailers.has(it.retailerId) && !rotatingRetailerIds.has(it.retailerId)) {
        if (newStatus === StockStatus.IN_STOCK) {
          await checkListingAlerts({ ...created, productId }, "NEW_LISTING");
          newListings++;
        } else if (newStatus === StockStatus.PREORDER) {
          await checkListingAlerts({ ...created, productId }, "PREORDER");
          newListings++;
        }
      }
      continue;
    }
    // Sedd förut → diffa lagerstatus. Samma kritiska ordning som offer-grenen ovan:
    // larma FÖRST, skriv den nya lagerstatusen SIST (den konsumerar övergången).
    if (isRestock(listing.stockStatus, newStatus)) {
      await checkListingAlerts(
        { id: listing.id, title: it.title, retailerId: it.retailerId, productId },
        "RESTOCK"
      );
      restocks++;
    } else if (
      // Öppnad för förhandsbokning (t.ex. var slut/okänd, nu köpbar inför release).
      newStatus === StockStatus.PREORDER &&
      listing.stockStatus !== StockStatus.PREORDER
    ) {
      await checkListingAlerts(
        { id: listing.id, title: it.title, retailerId: it.retailerId, productId },
        "PREORDER"
      );
      newListings++;
    }
    // Skriv bara vid faktisk ändring (spara Neon-writes). Larmet ovan skapar bara en
    // PENDING Alert-rad — mejlet byggs först i dispatchPendingAlerts() EFTER hela loopen,
    // så raden här hinner bli PREORDER innan buildAlertEmail läser den (preorder-copy).
    if (listing.stockStatus !== newStatus) {
      await prisma.storeListing.update({
        where: { id: listing.id },
        data: {
          stockStatus: newStatus,
          lastSeenAt: new Date(),
          title: it.title,
          price: it.price,
          imageUrl: it.imageUrl,
        },
      });
    }
  }

  // Försvunnen-ur-feeden-försoning: en butik som droppar en slutsåld produkt ur
  // sin katalog slutar skicka dess URL → offer-diffen ovan rör den aldrig och den
  // fryser på senast kända IN_STOCK för evigt (buggen: Speltrollet-box låg kvar
  // "i lager" i 2 v). Fixa: offers vars URL INTE fanns i feeden denna körning →
  // OUT_OF_STOCK. Bara för butiker vars feed faktiskt hämtades (≥1 produkt) så ett
  // nätverksfel/tom feed inte nollar hela butiken.
  // ponytail: sällsynt falskt slutsålt om en butik omkategoriserar en produkt UR
  // alla Pokémon-kollektioner men fortfarande säljer den; bättre än falskt i-lager.
  const feedRetailers = new Set<string>();
  for (const { sourceName, items } of fetched) {
    if (items.length > 0) {
      const rid = retailerByName.get(sourceName);
      if (rid) feedRetailers.add(rid);
    }
  }
  // Bumpa lastSeenAt för alla offers som fanns i feeden denna körning (även oförändrade)
  // så debounce-ankaret hålls färskt → en rullande-men-närvarande offer slutsäljs aldrig.
  // En batch-updateMany (ej per offer) → billigt; Neon är redan vaket i denna fas.
  const freshKeys = new Set(fresh.keys());
  const now = new Date();
  const seenOfferIds = offers.filter((o) => freshKeys.has(`${o.retailerId}:${o.url}`)).map((o) => o.id);
  if (seenOfferIds.length) {
    await prisma.offer.updateMany({ where: { id: { in: seenOfferIds } }, data: { lastSeenAt: now } });
  }
  const graceMs = Number(process.env.RESTOCK_SOLDOUT_GRACE_HOURS ?? 24) * 3600_000;
  let soldOutReconciled = 0;
  for (const o of offersToMarkSoldOut(offers, freshKeys, feedRetailers, now, graceMs)) {
    // UNKNOWN, inte OUT_OF_STOCK: frånvaro ur feeden ≠ känd slutförsäljning.
    // Se offersToMarkSoldOut-kommentaren — dödar falska "Åter i lager" vid rotation.
    await prisma.offer.update({ where: { id: o.id }, data: { stockStatus: StockStatus.UNKNOWN } });
    soldOutReconciled++;
  }

  const { sent } = await dispatchPendingAlerts();
  console.log(
    `[restock-scan] ${sources.length} butiker, ${checked} kollade, ${restocks} restocks, ${newListings} nya, ${soldOutReconciled} slutsåld-försoning, ${sent} alerts.`
  );
  return { sources: sources.length, checked, restocks, newListings, alertsSent: sent, sourceList: sources };
}

/**
 * Katalogbreda uppslagskartor som är LIKA för alla källor i ett pass. Laddas en gång
 * i runAllActiveSources och skickas in — annars skulle var och en av de 15 källorna
 * dra hem hela produkt- och CM-pristabellen igen (~30 MB Neon-egress per pass i
 * onödan; egress har varit ett kostnadsproblem här förut).
 */
export type CatalogMaps = {
  categoryByProduct: Map<string, string>;
  cmPriceByProduct: Map<string, number>;
  matchIndex: MatchIndex;
};

export async function loadCatalogMaps(): Promise<CatalogMaps> {
  const [products, cmOffers, matchIndex] = await Promise.all([
    prisma.product.findMany({ select: { id: true, category: true } }),
    prisma.offer.findMany({
      where: { retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { productId: true, price: true },
    }),
    loadMatchIndex(),
  ]);
  const categoryByProduct = new Map(products.map((p) => [p.id, p.category as string]));
  const cmPriceByProduct = new Map<string, number>();
  for (const o of cmOffers) {
    if (o.price != null && !cmPriceByProduct.has(o.productId)) cmPriceByProduct.set(o.productId, o.price);
  }
  return { categoryByProduct, cmPriceByProduct, matchIndex };
}

export async function runScrapeJob(sourceId: string, maps?: CatalogMaps): Promise<ScrapeJobSummary> {
  const source = await prisma.scrapeSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`Okänd källa: ${sourceId}`);
  // Fristående anrop (admin/CLI) laddar sina egna kartor; passet skickar in delade.
  const { categoryByProduct, cmPriceByProduct, matchIndex } = maps ?? (await loadCatalogMaps());

  const job = await prisma.scrapeJob.create({
    data: { sourceId, status: JobStatus.RUNNING, startedAt: new Date() },
  });

  const logs: string[] = [];
  let itemsFound = 0;
  let itemsUpdated = 0;
  let errorCount = 0;
  let aborted = false;

  try {
    const adapter = getAdapter(source.type, source.name);
    logs.push(`Startar insamling från "${source.name}" (${source.type})`);

    const result = await adapter.fetchProducts();
    itemsFound = result.products.length;
    errorCount += result.errors.length;
    for (const e of result.errors) logs.push(`Adapterfel: ${e}`);

    const retailer = await getRetailerForSource(source.name, source.baseUrl, source.type);

    // Cross-produkt-vakt: en butiks-URL får bara ägas av EN produkt. Utan denna kan
    // matcharen här och restock-auto-importen länka samma URL till olika produkter —
    // så uppstod både dubblettstubbar och fel-serie-länkar (First Partner S1↔S2).
    // Först skriven vinner; scripts/audit-links.ts flaggar innehållsfel veckovis.
    // FÖRLADDNING (kritiskt för körtiden). GitHub-runnern står i us-east och Neon i
    // Frankfurt → varje DB-rundresa kostar ~100 ms. Loopen nedan gjorde tidigare 4
    // frågor PER ANNONS (offer.findFirst, product.findUnique, plus två inuti
    // isPlausibleListingPrice — varav en hämtade EXAKT samma product.category en gång
    // till). Med tiotusentals annonser blev det timmar, och jobbet dunkade i
    // 120-minuterstaket 1,2,3,6,8 juli. Nu: tre frågor per KÄLLA, resten i minnet.
    // (Samma grepp som runRestockScan redan använder — läs en gång, diffa i minnet.)
    const retailerOffers = await prisma.offer.findMany({
      where: { retailerId: retailer.id },
      select: {
        id: true, url: true, productId: true, price: true,
        condition: true, language: true, stockStatus: true,
      },
    });
    const urlOwner = new Map<string, string>(retailerOffers.map((o) => [o.url, o.productId]));
    // Ersätter prisma.offer.findFirst({ productId, retailerId }) per annons. findFirst
    // utan orderBy = godtycklig rad; första i listan bevarar den semantiken.
    const offerByProduct = new Map<string, (typeof retailerOffers)[number]>();
    for (const o of retailerOffers) if (!offerByProduct.has(o.productId)) offerByProduct.set(o.productId, o);

    // categoryByProduct + cmPriceByProduct är förladdade (delade för hela passet) —
    // de ersätter product.findUnique och CM-referensprisfrågan som låg per annons.

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Har butiken skrapats förut? Om inte = första skrapningen → seeda TYST (larma
    // inte hela dess katalog som "nya produkter"). Läs FÖRE vi uppdaterar lastRunAt.
    const scrapedBefore = source.lastRunAt != null;

    // Billigaste annonsen vinner: när flera annonser i samma körning matchar
    // samma produkt ska offerten visa den billigaste, inte den senast bearbetade.
    const bestPriceThisRun = new Map<string, number>();
    // Restock-händelser räknas på NETTO per offer per körning (inte per upsert):
    // startStatus = lagerstatus vid körningens början (null = ny offer), finalState
    // = den billigaste vinnande annonsens status. Annars ger två kolliderande
    // annonser en spök-restock (IN→OUT→IN) varje körning. Se netStockEvent.
    const offerStartStatus = new Map<string, StockStatus | null>();
    const offerFinalState = new Map<
      string,
      { productId: string; newStatus: StockStatus; price: number; category: string | null }
    >();

    for (const rawProduct of result.products) {
      if (errorCount > MAX_ERRORS) {
        aborted = true;
        logs.push(`Avbryter: fler än ${MAX_ERRORS} fel.`);
        break;
      }
      try {
        if (!adapter.validateResult(rawProduct)) {
          errorCount++;
          logs.push(`Ogiltig produktdata: ${rawProduct.externalId}`);
          continue;
        }

        const normalized = adapter.normalizeProduct(rawProduct);

        // Blockade språk (kinesiska/koreanska) ska aldrig in i katalogen — gäller
        // ÄVEN denna matchar-väg (feed-först-vakten täckte bara restock-skanningen;
        // scrape-all släppte annars in koreanska annonser som offers på JP-produkter).
        if (isBlockedListingLanguage(rawProduct.title, normalized.url)) {
          logs.push(`Blockat språk (CN/KR) — hoppar: "${rawProduct.title}"`);
          continue;
        }

        // matchIndex = hela katalogen i minnet → ingen seq-scan per annons (se loadMatchIndex).
        const match = await matchProduct(normalized.normalizedTitle, matchIndex, rawProduct.title);
        if (!match) {
          logs.push(`Ingen produktmatchning: "${rawProduct.title}"`);
          continue;
        }
        const { productId } = match;

        // URL:en ägs redan av en ANNAN produkt → länka inte om (matchare i olika
        // körvägar får inte tävla om samma butikssida). Hoppa hela posten så inte
        // heller pris-/lagerdata bokförs på fel produkt.
        const existingOwner = urlOwner.get(normalized.url);
        if (existingOwner && existingOwner !== productId) {
          logs.push(`URL ägs redan av annan produkt — hoppar: "${rawProduct.title}" (${normalized.url})`);
          continue;
        }

        // Erbjudandepriset (det vi VISAR) kan skilja sig från observationspriset:
        // för Cardmarket är offerPrice lägsta annonspris ("From") medan
        // normalized.price är trend-priset som prishistoriken/grafen bygger på.
        let offerPrice = normalized.offerPrice ?? normalized.price;

        // Rimlighetsvakt mot CM-marknadspriset (gäller alla butiker/marknadsplatser,
        // ej pris-datakällorna själva): för HÖGT = trolig lot/fel variant (Tradera),
        // för LÅGT = felmatchad produkt (t.ex. en 149 kr butikslänk på en 2 333 kr
        // sealed). Skippa helt — priset hör inte till den här produkten.
        const matchedCategory = categoryByProduct.get(productId) ?? null;
        if (
          !CARDMARKET_SOURCE_NAMES.includes(source.name) &&
          !isPlausiblePriceFor(matchedCategory, cmPriceByProduct.get(productId), normalized.price)
        ) {
          logs.push(`Orimligt pris vs marknadspris (trolig lot/felmatch): "${rawProduct.title}" ${normalized.price} öre`);
          continue;
        }

        // Tidigare erbjudande (för pris-/lagerjämförelse) — ur förladdad karta.
        const previousOffer = offerByProduct.get(productId) ?? null;

        // Skick utifrån produktkategori: singlar är NEAR_MINT, övrigt SEALED
        const matchedProduct = matchedCategory ? { category: matchedCategory } : null;

        // Singelkort får bara matcha skrapade singelkort och vice versa
        if (normalized.category && matchedProduct) {
          const isSingleRaw =
            normalized.category === "SINGLE_CARD" || normalized.category === "GRADED_CARD";
          const isSingleProduct =
            matchedProduct.category === "SINGLE_CARD" ||
            matchedProduct.category === "GRADED_CARD";
          if (isSingleRaw !== isSingleProduct) {
            logs.push(`Kategorimismatch (${normalized.category} ↔ ${matchedProduct.category}): "${rawProduct.title}"`);
            continue;
          }
        }
        const condition =
          previousOffer?.condition ??
          (matchedProduct?.category === "SINGLE_CARD" ||
          matchedProduct?.category === "GRADED_CARD"
            ? "NEAR_MINT"
            : "SEALED");
        // Offer-språket följer annonsen (japansk annons → JP-offer). Befintlig
        // offers språk behålls (unik nyckel per språk).
        const language = previousOffer?.language ?? listingCardLanguage(rawProduct.title, normalized.url);

        // pokemontcg.io/TCGdex ger TREND-pris, inte en köpbar annons. För
        // singlar äger CardMarket-RapidAPI (engelska NM-lägsta "From") det
        // visade offer-priset — låt inte trend-källan skriva över ett redan
        // satt singel-pris; seeda bara när priset saknas. Observationen nedan
        // använder fortfarande normalized.price (trend) för grafen.
        const isTrendOnlySource =
          source.name === "Pokémon TCG API" || source.name === "TCGdex API";
        if (
          isTrendOnlySource &&
          matchedProduct?.category === "SINGLE_CARD" &&
          previousOffer?.price != null
        ) {
          offerPrice = previousOffer.price;
        }

        // Billigaste annonsen vinner — har en billigare annons redan skrivit
        // denna offer under körningen behåller vi den (observationen sparas ändå).
        const offerKey = `${productId}:${retailer.id}:${condition}:${language}`;
        const cheaper = bestPriceThisRun.get(offerKey);
        const skipOfferUpdate = cheaper !== undefined && cheaper <= offerPrice;

        if (!skipOfferUpdate) {
          bestPriceThisRun.set(offerKey, offerPrice);

          // Startstatus fångas EN gång (första annonsen för denna offer denna
          // körning) — innan vi skriver något. Senare annonser läser om
          // previousOffer från DB och ser vår egen färska skrivning, så de får
          // INTE användas som "tidigare status".
          if (!offerStartStatus.has(offerKey)) {
            offerStartStatus.set(offerKey, previousOffer?.stockStatus ?? null);
          }
          // Billigaste vinnaren = offerns slutstatus för körningen.
          offerFinalState.set(offerKey, {
            productId,
            newStatus: normalized.stockStatus,
            price: offerPrice,
            category: normalized.category ?? null,
          });

          // Bevara en redan löst engelsk CM-slug: PokemonTcgAdapter emittar en
          // bar prices.pokemontcg.io-redirect som annars skulle skriva över den
          // (och tappa ?language=1) vid varje körning. Behåll den lösta slugen;
          // resolver-jobbet uppgraderar nya redirect-länkar separat.
          const urlToStore =
            isCardmarketRedirect(normalized.url) &&
            isEnglishCardmarketUrl(previousOffer?.url)
              ? (previousOffer!.url as string)
              : normalized.url;

          // Upserta erbjudandet
          await prisma.offer.upsert({
            where: {
              productId_retailerId_condition_language: {
                productId,
                retailerId: retailer.id,
                condition,
                language,
              },
            },
            update: {
              price: offerPrice,
              currency: normalized.currency,
              stockStatus: normalized.stockStatus,
              url: urlToStore,
              lastSeenAt: new Date(),
            },
            create: {
              productId,
              retailerId: retailer.id,
              condition,
              language,
              price: offerPrice,
              currency: normalized.currency,
              stockStatus: normalized.stockStatus,
              url: urlToStore,
            },
          });
          urlOwner.set(urlToStore, productId); // vakten ska se även denna körnings nya länkar
          itemsUpdated++;
          // Restock-händelsen avgörs efter körningen (netto), inte här — se
          // offerStartStatus/offerFinalState ovan och emit-loopen efter loopen.
        }

        // Rå observation — rådata lagras separat från normaliserad data
        await prisma.priceObservation.create({
          data: {
            productId,
            sourceId: source.id,
            price: normalized.price,
            currency: normalized.currency,
            rawData: rawProduct.raw as Prisma.InputJsonValue,
          },
        });

        // Dagligt prissnapshot = marknadspris (endast Cardmarket-källor).
        // Butiks-/Tradera-observationer får ALDRIG blandas in — varierande
        // källsammansättning ger fejkade prisförändringar i trender/badges.
        const agg = await prisma.priceObservation.aggregate({
          where: {
            productId,
            observedAt: { gte: today },
            source: { name: { in: CARDMARKET_SOURCE_NAMES } },
          },
          _min: { price: true },
          _max: { price: true },
          _avg: { price: true },
          _count: { _all: true },
        });
        if (agg._count._all > 0 && agg._avg.price != null) {
          const snapshot = {
            minPrice: agg._min.price ?? Math.round(agg._avg.price),
            maxPrice: agg._max.price ?? Math.round(agg._avg.price),
            avgPrice: Math.round(agg._avg.price),
            volume: agg._count._all,
          };
          await prisma.priceSnapshot.upsert({
            where: { productId_date: { productId, date: today } },
            update: snapshot,
            create: { productId, date: today, ...snapshot },
          });
        }

        // Prisfall → kontrollera bevakningar med målpris (på det visade priset)
        if (previousOffer?.price != null && offerPrice < previousOffer.price) {
          await checkPriceAlerts(productId, offerPrice);
        }
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`Fel vid bearbetning av ${rawProduct.externalId}: ${msg}`);
      }
    }

    // Netto-restock per offer: en händelse per offer, körningens startstatus →
    // billigaste vinnande annonsens status. Eliminerar spök-IN→OUT→IN-flapparna.
    for (const [offerKey, st] of offerFinalState) {
      const start = offerStartStatus.get(offerKey) ?? null;
      const ev = netStockEvent(start, st.newStatus);

      // Ny produkt i lager: en helt ny offer (start=null) som är I LAGER = butiken
      // har börjat sälja något vi katalogför men inte hade en offer för. netStockEvent
      // emittar INTE detta (ingen tidigare status), så vi larmar det separat — samma
      // "Ny produkt i lager" som feed-först ger för okatalogiserade URL:er. Vakter:
      // riktig butik, bara sealed (singlar spammar), och EJ butikens första skrapning
      // (då seedas katalogen tyst). ponytail: en burst är möjlig om matchern plötsligt
      // matchar många nya produkter en körning — sällsynt, samma exponering som restock.
      if (
        isNewInStockArrival(start, st.newStatus) &&
        scrapedBefore &&
        !NON_RETAIL_SOURCE_NAMES.includes(retailer.name) &&
        SEALED_FEED_CATEGORIES.has(st.category ?? "") &&
        // Roterande feeds (Swepoke): en "ny" offer är oftast en urgammal annons som
        // roterat in i synfältet — larma inte den som ny produkt.
        (source.config as { rotatingFeed?: boolean } | null)?.rotatingFeed !== true
      ) {
        await prisma.restockEvent.create({
          data: {
            productId: st.productId,
            retailerId: retailer.id,
            oldStatus: StockStatus.OUT_OF_STOCK,
            newStatus: StockStatus.IN_STOCK,
            price: st.price,
          },
        });
        await checkRestockAlerts(st.productId, retailer.id);
        logs.push(`Ny produkt i lager: ${st.productId} hos ${retailer.name}`);
        continue;
      }

      if (!ev.emit) continue;
      await prisma.restockEvent.create({
        data: {
          productId: st.productId,
          retailerId: retailer.id,
          oldStatus: ev.oldStatus,
          newStatus: st.newStatus,
          price: st.price,
        },
      });
      // Restock-larm BARA för riktiga butiker — aldrig Cardmarket/Tradera.
      if (ev.isRestock && !NON_RETAIL_SOURCE_NAMES.includes(retailer.name)) {
        await checkRestockAlerts(st.productId, retailer.id);
      }
      logs.push(
        `Lagerstatus ändrad för produkt ${st.productId}: ${ev.oldStatus} → ${st.newStatus}`
      );
    }

    const status = aborted ? JobStatus.FAILED : JobStatus.COMPLETED;
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: new Date(),
        itemsFound,
        itemsUpdated,
        logs,
        errorMessage: aborted ? `Avbrutet: fler än ${MAX_ERRORS} fel.` : null,
      },
    });
    await prisma.scrapeSource.update({
      where: { id: source.id },
      data: { lastRunAt: new Date() },
    });

    return { jobId: job.id, status, itemsFound, itemsUpdated, errorCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`Jobbet kraschade: ${msg}`);
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        finishedAt: new Date(),
        itemsFound,
        itemsUpdated,
        logs,
        errorMessage: msg,
      },
    });
    return {
      jobId: job.id,
      status: JobStatus.FAILED,
      itemsFound,
      itemsUpdated,
      errorCount: errorCount + 1,
    };
  }
}

/** Kör alla aktiva källor i sekvens. Returnerar sammanfattningar. */
export async function runAllActiveSources(): Promise<ScrapeJobSummary[]> {
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const summaries: ScrapeJobSummary[] = [];
  const t0 = Date.now();
  // EN gång för hela passet — inte en gång per källa.
  const maps = await loadCatalogMaps();
  console.log(
    `[runner] Katalogkartor laddade: ${maps.categoryByProduct.size} produkter, ${maps.cmPriceByProduct.size} CM-priser.`
  );
  for (const s of sources) {
    // TIDTAGNING PER KÄLLA. Hela passet skrev tidigare bara två rader ("Kör…" och
    // "Klart"), så när körtiden kröp från 60 → 100+ min och började dunka i
    // 120-min-taket gick det inte att se VILKEN källa som var långsam. Nu syns det.
    const s0 = Date.now();
    try {
      const summary = await runScrapeJob(s.id, maps);
      summaries.push(summary);
      console.log(
        `[runner] ${s.name}: ${Math.round((Date.now() - s0) / 1000)}s — ${summary.itemsFound} annonser, ${summary.itemsUpdated} uppdaterade`
      );
    } catch (err) {
      console.error(`[runner] Misslyckades köra källa ${s.name} efter ${Math.round((Date.now() - s0) / 1000)}s:`, err);
    }
  }
  console.log(`[runner] Alla ${sources.length} källor klara på ${Math.round((Date.now() - t0) / 60000)} min.`);
  return summaries;
}
