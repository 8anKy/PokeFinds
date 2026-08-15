/**
 * Kör ett insamlingsjobb för en källa: hämtar produkter via adapter,
 * matchar mot katalogen, uppdaterar erbjudanden, skapar prisobservationer
 * (rådata separat i rawData), dagliga prissnapshots, restock-händelser
 * och triggar alerts.
 *
 * Säkerhetsregler: jobbet avbryts automatiskt om felräknaren passerar 20.
 */
import { JobStatus, SourceType, StockStatus, type Prisma, type ProductCategory } from "@prisma/client";
import { prisma, ensureDbAwake } from "@/lib/db";
import { normalizeTitle, slugify } from "@/lib/utils";
import { MockAdapter } from "@/scrapers/adapters/mock-adapter";
import { PokemonTcgAdapter } from "@/scrapers/adapters/pokemontcg-adapter";
import { SpelexpertenAdapter } from "@/scrapers/adapters/spelexperten-adapter";
import { WebhallenAdapter } from "@/scrapers/adapters/webhallen-adapter";
import { AlphaspelAdapter } from "@/scrapers/adapters/alphaspel-adapter";
import { TraderaAdapter } from "@/scrapers/adapters/tradera-adapter";
import { CardmarketPriceGuideAdapter } from "@/scrapers/adapters/cardmarket-adapter";
import {
  // Basklassen: `instanceof ShopifyAdapter` avgör vilka källor som får
  // köpbarhetskollen (se confirmIncomingStock) — nya Shopify-butiker klassas
  // automatiskt, precis som Discord-lanens artighetsnivå redan gör.
  ShopifyAdapter,
  SpeltrolletAdapter,
  SamlarhobbyAdapter,
  GoblinenAdapter,
  DragonsLairAdapter,
  ManatorskAdapter,
  TcgStoreAdapter,
  BeamCardshopAdapter,
  HobbykortAdapter,
  PoketalkAdapter,
  KantoVaultAdapter,
  PokemurreAdapter,
  AuroraDexAdapter,
  TinyMistersAdapter,
  CardlevelsAdapter,
  KortarkivetAdapter,
  RahTechAdapter,
  CardClubAdapter,
  BlindboxAdapter,
  RgbKingzAdapter,
  MiniatureMetropolisAdapter,
  PokexclusiveAdapter,
  SpelgalaxenAdapter,
  AquitazAdapter,
  RogerzAdapter,
  YonkoTcgAdapter,
  FiregamesAdapter,
} from "@/scrapers/adapters/shopify-adapter";
import {
  SwepokeAdapter,
  ShinycardsAdapter,
  CardGameAdapter,
  MysteryShackAdapter,
  PacksOnPacksAdapter,
  SpelkortsbutikenAdapter,
} from "@/scrapers/adapters/quickbutik-adapter";
import {
  FantasiaNorthAdapter,
  TheSwedishFishAdapter,
  PocketmonstersAdapter,
} from "@/scrapers/adapters/woocommerce-adapter";
import {
  LeksaksaffarenAdapter,
  NordicTcgAdapter,
} from "@/scrapers/adapters/prestashop-adapter";
import { CoolcardAdapter } from "@/scrapers/adapters/starweb-adapter";
import { MaxGamingAdapter } from "@/scrapers/adapters/maxgaming-adapter";
import {
  classifyForm,
  cleanListingTitle,
  identicalIdentity,
  wrapperArtSameProduct,
  isAccessoryListing,
  isStoreBundleListing,
  isOtherFranchiseListing,
  hasPokemonTitleSignal,
  isMerchandiseListing,
  isSingleCardListing,
  isUnspecifiedCharacterListing,
  nearestCatalogCandidate,
  isPlausiblePriceFor,
  loadMatchIndex,
  matchProduct,
  type MatchIndex,
} from "@/scrapers/matching";
import { judgeSameProduct } from "@/lib/same-product";
import { fetchListingFacts, fetchListingGtin } from "@/scrapers/gtin-source";
import { fetchShopifyPurchasable, statusAfterVerify, verifyStockForUrl } from "@/scrapers/stock-verify";
import { gtinConflict, isPokemonManufacturerGtin } from "@/lib/gtin";
import { isDeniedListingUrl, setDynamicDenylist, dynamicDenylistSize } from "@/scrapers/import-denylist";
import { netStockEvent, isRestock, isNewInStockArrival } from "@/scrapers/restock";
import { isCardmarketRedirect, isEnglishCardmarketUrl } from "@/lib/marketplace-urls";
import { isPlaceholderListingPrice } from "@/lib/listing-plausibility";
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
  // ---- Wave 4 (2026-08-07): 23 nya butiker på tre återanvända plattformar ----
  // Nyckeln HÄR måste vara exakt samma sträng som ScrapeSource.name och adapterns
  // `name` — getAdapter slår upp på källans namn, och en glidning ger "Ingen
  // scraper-adapter för …" mitt i en nattkörning. tests/unit/adapter-registry.test.ts
  // vaktar att de tre stämmer överens.
  "TCG Store": TcgStoreAdapter,
  "Beam Cardshop": BeamCardshopAdapter,
  Hobbykort: HobbykortAdapter,
  Pokétalk: PoketalkAdapter,
  "Kanto Vault": KantoVaultAdapter,
  Pokemurre: PokemurreAdapter,
  AuroraDex: AuroraDexAdapter,
  "Tiny Misters": TinyMistersAdapter,
  Cardlevels: CardlevelsAdapter,
  Kortarkivet: KortarkivetAdapter,
  RahTech: RahTechAdapter,
  "Card Club": CardClubAdapter,
  Blindbox: BlindboxAdapter,
  "RGB Kingz": RgbKingzAdapter,
  "Miniature Metropolis": MiniatureMetropolisAdapter,
  Pokexclusive: PokexclusiveAdapter,
  Spelgalaxen: SpelgalaxenAdapter,
  CardGame: CardGameAdapter,
  "Mystery Shack": MysteryShackAdapter,
  "Packs on Packs": PacksOnPacksAdapter,
  "Fantasia North": FantasiaNorthAdapter,
  "The Swedish Fish": TheSwedishFishAdapter,
  Pocketmonsters: PocketmonstersAdapter,
  // ---- Wave 5 (2026-08-13): 4 Shopify + 1 Quickbutik + PrestaShop (delad) + Starweb ----
  Aquitaz: AquitazAdapter,
  Rogerz: RogerzAdapter,
  "Yonko TCG": YonkoTcgAdapter,
  Firegames: FiregamesAdapter,
  Spelkortsbutiken: SpelkortsbutikenAdapter,
  Leksaksaffären: LeksaksaffarenAdapter,
  NordicTCG: NordicTcgAdapter,
  Coolcard: CoolcardAdapter,
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
  /**
   * Hur många offer-lösa feed-URL:er som fick en Offer denna körning (auto-import).
   * CLI-wrappern exporterar om Discord-lanens ruttabell när talet är > 0 — annars är
   * en NY SKU:s första restock "okänd URL" i upp till ett dygn (Samlarhobbys Paradox
   * Rift-booster 2026-08-12 postades aldrig av exakt det skälet).
   */
  offersCreated?: number;
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

/**
 * Hur många butiker som hämtas parallellt.
 *
 * Höjt 4 → 8 när restock-bevakningen gick från 11 till 34 butiker (2026-08-08). Talet
 * styr WALL-CLOCK, inte artighet: `politeFetch` håller sin fördröjning PER VÄRD, och
 * varje butik är en egen värd — åtta parallella hämtningar är alltså åtta olika
 * servrar med en förfrågan i taget var, precis som förut.
 *
 * MÄTT mot alla 34 butikers riktiga feedar (2026-08-08): **107 s vid 4, 57 s vid 8**.
 * Båda ryms alltså med god marginal i tiominuterstakten — höjningen var HEADROOM, inte
 * en nödvändighet. Det är värt att veta om någon senare vill sänka den igen: det kostar
 * ~50 s, inte en trasig lane.
 *
 * Marginalen finns för att lanen har `cancel-in-progress: false` i workflowet — en
 * körning som drar över tiotaget KÖAR i stället för att ersättas, så backlogen växer
 * i stället för att självläka. Feedarna växer dessutom med sortimentet.
 * ⛔ Höj inte vidare "för säkerhets skull": fas 1 håller alla butikers feedar i minnet
 *    samtidigt, och den enda vinsten därutöver är sekunder vi inte saknar.
 *
 * Env-styrbar sedan 2026-08-13: butikslistan växer förbi 40 och Discord-lanen (som
 * kör tätast) vill åt wall-clock = långsammaste ENSKILDA butik i stället för
 * summan-per-worker. Talet styr fortfarande bara parallellitet MELLAN butiker —
 * politeFetch håller sin fördröjning per värd precis som förut.
 */
const RESTOCK_SCAN_CONCURRENCY = Math.max(1, Number(process.env.RESTOCK_SCAN_CONCURRENCY ?? 8));

/**
 * Tak för hur många lagerövergångar per körning som får slås upp mot butikens EGEN
 * produktsida innan de skrivs och larmas (se fetchShopifyPurchasable).
 *
 * Övergångarna är få i drift — mätt 12–27 per dygn över ALLA butiker — men första
 * körningen efter en cache-förlust, eller en butik som byter feed, kan ge hundratals
 * på en gång. Taket gör att en sådan körning inte drar hundratals produktsidor.
 * ⛔ ÖVER TAKET LITAR VI PÅ FEEDEN (fail open). Ett uteblivet uppslag är ingen ny
 *    upplysning, och att tolka det som "slutsåld" hade tystat äkta påfyllningar —
 *    samma regel som statusAfterVerify redan bär.
 */
const RESTOCK_BUY_CHECK_MAX = Math.max(0, Number(process.env.RESTOCK_BUY_CHECK_MAX ?? 25));

/**
 * Golv för att ens FRÅGA LLM-domaren om en annons matcharen inte ville binda
 * (se nearestCatalogCandidate). Inte ett bevis — ett filter mot att fråga om
 * orelaterade varor.
 *
 * 0,75 valt på de uppmätta dubbletterna: de tre Wave 4 skapade låg på 0,858, 0,913 och
 * 0,945, medan det fjärde fallet ("Storm Emerald Booster Box" mot vår japanska post,
 * 0,565) med flit hamnar UNDER — där är annonsen och katalogposten oense om språket och
 * en gissning skulle länka en förhandsbokning till fel utgåva.
 */
const SECOND_CHANCE_MIN_SCORE = 0.75;

/** En normaliserad annons från en butiksfeed, med det som ett feed-först-larm behöver. */
export type FeedItem = {
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
 * hellre ett öres-anrop än en dubblettprodukt. ⛔ ÄR DOMAREN OTILLGÄNGLIG (ingen
 * nyckel/slut på kvot) SKAPAS INGENTING: den gamla policyn ("skapa en stub som
 * veckodedupen städar") var exakt så Wave 4-importen fyllde katalogen med dubbletter
 * (ägarens genomgång 2026-08-08 hittade 75). Annonsen väntar i stället till nästa
 * körning med fungerande domare — en fördröjd länk är billigare än en dubblett.
 * Upsertar butikens offer så URL:en får ett Offer → nästa skanning går via den
 * beprövade offer-diffen. Returnerar productId (null om avvisad/uppskjuten).
 */
/**
 * Kända setnamn (normaliserade, ≥3 tecken) för den positiva Pokémon-vakten.
 * Laddas EN gång per process — jobben är kortlivade, och ~220 rader är en
 * försumbar fråga som bara ställs när en NY produkt är på väg att skapas.
 */
let setNamesCache: Promise<Set<string>> | null = null;
function knownSetNames(): Promise<Set<string>> {
  setNamesCache ??= prisma.cardSet.findMany({ select: { name: true } }).then((rows) => {
    const out = new Set<string>();
    for (const r of rows) {
      // JP-set bär koden i namnet ("Wild Force (SV5K)") — butikstiteln gör det
      // sällan, så BÅDA formerna läggs in (med och utan parentes).
      for (const variant of [r.name, r.name.replace(/\(.*?\)/g, " ")]) {
        const n = normalizeTitle(variant);
        if (n.length >= 3) out.add(n);
      }
    }
    return out;
  });
  return setNamesCache;
}

export async function ensureListingProduct(
  it: { title: string; url: string; price: number | null; imageUrl: string | null; retailerId: string; category: string | null; sourceName?: string },
  stockStatus: StockStatus,
  /**
   * Katalogen i minnet. Utan den går matchningen via DB-vägen, som filen själv
   * dokumenterar som opålitlig (`take: 200` utan `orderBy` = godtycklig delmängd →
   * rätt kandidat föll ofta utanför). Anroparen laddar den EN gång och delar den.
   */
  index?: MatchIndex
): Promise<string | null> {
  const category = (it.category ?? null) as ProductCategory | null;
  if (!category) return null;
  // Blockade språk (kinesiska/koreanska) får ALDRIG bli katalogprodukter — kolla
  // även butiks-URL:en (DL:s "…-kinesisk-version"-slug avslöjade en latinsk titel).
  if (isBlockedListingLanguage(it.title, it.url)) return null;
  // Ägar-denylist: URL:er som ALDRIG ska bli produkter (tillbehör/generiska sortiment
  // ägaren tagit bort). Utan detta återskapar nästa import den raderade produkten.
  if (isDeniedListingUrl(it.url)) return null;
  // ---- MEMO: har vi redan avgjort vad URL:en är? ----
  // ⛔ UTAN DETTA BETALAS SAMMA LLM-DOM 144 GÅNGER OM DYGNET. Vakten nedan frågar
  // "har URL:en en Offer?", och för en URL som ALDRIG kan få en egen offer är svaret
  // alltid nej: butiken har redan en offer på produkten via en ANNAN variant-URL, och
  // Offer är unik på (produkt, butik, skick, språk) → `upsertListingOffer` skriver
  // ingenting. Alltså matchades, dömdes och band vi om samma annons var 10:e minut i
  // evighet. MÄTT 2026-08-14: 5 listningar × 144 körningar = 720 Haiku-anrop/dygn för
  // domar vi redan hade (~$18/mån = ~90 % av appens Anthropic-nota). Rogerz listar
  // varje begagnad vara under BÅDA danska momsordningarna på samma sida — den ena
  // varianten fick offern, den andra kunde per konstruktion aldrig få en.
  //
  // Domen är stabil, så den skrivs ner (se memo-skrivningen sist i funktionen) och
  // läses här. Jämförelsen mot RÅTITELN är cache-invalideringen (samma regel som
  // DedupeVerdict.titleA/B): byter butiken titel gäller inte domen längre.
  //
  // ⛔ LIGGER EFTER språk- och denylist-vakterna med flit — en URL admin nekat får
  //    aldrig återuppstå ur cachen.
  // ⛔ Kortsluter INTE offer-skrivningen: memot sparar det DYRA (butikens produktsida
  //    via HTTP + LLM-domen), aldrig garantin att en offer skapas när den GÅR att
  //    skapa. Misslyckades offer-skrivningen en gång ska nästa körning försöka igen.
  const ledger = await prisma.storeListing.findUnique({
    where: { retailerId_url: { retailerId: it.retailerId, url: it.url } },
    select: { productId: true, productMatchTitle: true, gtin: true },
  });
  if (ledger?.productId && ledger.productMatchTitle === it.title) {
    await upsertListingOffer(it, ledger.productId, stockStatus, ledger.gtin);
    return ledger.productId;
  }
  // Cross-produkt-vakt: ägs URL:en redan av en produkt (t.ex. länkad av scrape-all-
  // matcharen) → använd DEN länken. Skapa aldrig en andra produkt/offer för samma
  // butikssida — det var så dubblettstubbarna uppstod (34 delade URL:er, städat 07-07).
  const owner = await prisma.offer.findFirst({
    where: { retailerId: it.retailerId, url: it.url },
    select: { productId: true },
  });
  if (owner) {
    await rememberListingProduct(it, owner.productId);
    return owner.productId;
  }
  // ---- EN hämtning av butikens produktsida ger BÅDA nycklarna ----
  // Aldrig i restock-lanens feed-hämtning (den kör var 2:a minut) — bara här, för NYA
  // butiks-URL:er. Se gtin-source.ts för varför.
  const facts = it.sourceName
    ? await fetchListingFacts(it.sourceName, it.url)
    : { gtin: null, name: null };
  const gtin = facts.gtin;

  // Butiks-skräp ("MAX 1 per kund", "förhandsbokning", "(kopia)") bort INNAN
  // matchning/namnsättning — annars blir samma SKU från olika butiker
  // dubblettprodukter med skräpiga katalogtitlar.
  //
  // Butikens schema.org-`name` går FÖRE feedens titel när den finns: skräpet ligger i
  // `description`, inte i `name` (MaxGaming: name = "Pokémon Mega Evolution Elite Trainer
  // Box", description börjar "Observera: Max 2 boxar per kund."). Det tar bort
  // dubblett-orsakande brus vid KÄLLAN. cleanListingTitle() körs ändå ovanpå — andra
  // försvarslinjen, och enda linjen för butiker utan strukturerad data.
  const cleanTitle = cleanListingTitle(facts.name ?? it.title);
  // Lot-/kombo-annonser ("Booster Pack x4", "ETB + bundle") är inte katalogprodukter
  // — matchProduct vägrar matcha dem, men UTAN denna vakt skapades de som stubbar.
  const form = classifyForm(normalizeTitle(cleanTitle));
  if (form === "multipack" || form === "case" || form === "combo" || form === "event") return null;
  // TILLBEHÖR (akrylfodral, spelmatta, sleeves, pärm UTAN booster) är inte katalogprodukter.
  // Vakten fanns redan i productsConflict() — men INTE här, i den enda kodväg som SKAPAR
  // produkter. Katalogrevisionen 2026-07-14 hittade 15 sådana: "Acrylic Booster Box Display",
  // fyra Evoretro-fodral, en tärningspåse, en playmat-bundle. Raderade vi dem utan den här
  // raden skapade nästa restock-skanning om dem inom minuter.
  //
  // Sedan 2026-08-08 räknas även pärm/portfolio MED booster som tillbehör —
  // ägarbeslut, andra gången de rensades ur katalogen (07-18 via denylist, 08-08 via
  // kataloggenomgången). Undantaget som släppte in dem är borttaget ur vakten.
  if (isAccessoryListing(cleanTitle)) return null;
  // BUTIKSEGNA BUNDLES (mystery boxes, "alla fem tins") är butikens egen hopsättning
  // och saknar både streckkod och motsvarighet hos andra butiker — de går alltså inte
  // att prisjämföra, vilket är hela kataloges syfte. Ägarbeslut 2026-08-07.
  if (isStoreBundleListing(cleanTitle)) return null;
  // ANNAN TCG-FRANCHISE (One Piece/Lorcana/MTG …): butikernas Pokémon-kollektioner
  // läcker ibland grannspel — de blir aldrig katalogprodukter (och därmed aldrig larm,
  // se productId-grinden i skanningsloopen).
  if (isOtherFranchiseListing(cleanTitle)) return null;
  // ENSKILDA KORT (2026-08-07). Vakten fanns sedan länge i productsConflict() — men
  // aldrig HÄR, i den enda kodväg som SKAPAR produkter. Det gick an så länge butikerna
  // vi hämtade sålde nästan bara sealed. De nya gör inte det: Pokétalk har 113
  // Pokémon-kollektioner varav flera är löskort och graderade kort, Pocketmonsters
  // 1 592 poster under "pokemonkort". En singel bär sällan formord ⇒ guessCategory
  // landar på OTHER, som med flit räknas som sealed ⇒ varje singel hade blivit en egen
  // katalogprodukt bredvid den riktiga (som prissätts av Cardmarket, aldrig av butik).
  if (isSingleCardListing(cleanTitle)) return null;
  // MERCH (gosedjur, figurer, affischer, kläder) — samma hål, samma väg in.
  if (isMerchandiseListing(cleanTitle)) return null;
  const normalized = normalizeTitle(cleanTitle);

  // ---- GTIN-först: tillverkarens streckkod är en EXAKT nyckel, inte en gissning ----
  // 73% av butikernas sealed-utbud publicerar den (mätt). Saknas den faller vi tillbaka på
  // titelmatchningen precis som förut — frånvaro är normalt, inte ett fel.
  // BARA tillverkarkoder får joina: en distributör-EAN (73…) är butikens/distributörens
  // egen kod och kan delas mellan SKU:er → exakt join på den vore en gissning i förklädnad.
  if (gtin && isPokemonManufacturerGtin(gtin)) {
    const byGtin = await prisma.product.findFirst({ where: { gtin }, select: { id: true } });
    if (byGtin) {
      // Exakt träff: hoppa över BÅDE fuzzy-poängen och LLM-domen. Samma streckkod =
      // samma tillverkar-SKU, oavsett hur olika butikerna formulerar titeln
      // ("Ascended Heroes Bundle" == "Mega Evolution - Ascended Heroes Booster Bundle").
      await upsertListingOffer(it, byGtin.id, stockStatus, gtin);
      return byGtin.id;
    }
  }

  const match = await matchProduct(normalized, index, cleanTitle);
  // GTIN-KONFLIKT = MERGE-VAKT. Har både annonsen och kandidaten en kod och de skiljer sig
  // åt är det bevisat OLIKA tillverkar-SKU:er (påse 4521329432267 ≠ display 4521329432274).
  // Vi BLOCKERAR DÅ SAMMANSLAGNINGEN — aldrig länken: annonsen blir en egen produkt med
  // egen sida. En falskt blockerad länk är värre än en felmatch, för den syns aldrig.
  let candidateGtin: string | null = null;
  if (match && gtin) {
    const candidate = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { gtin: true },
    });
    candidateGtin = candidate?.gtin ?? null;
  }
  const blockedByGtin = gtinConflict(gtin, candidateGtin);
  if (blockedByGtin) {
    console.log(`[gtin] Blockerar merge: "${cleanTitle}" (${gtin}) ≠ kandidat (${candidateGtin}) — skapar egen produkt.`);
  }

  let productId = !blockedByGtin && match && match.confidence >= 0.85 ? match.productId : null;
  // Gränsfall 0.55–0.85: matcharen hittade EN kandidat men vågar inte binda den enbart
  // på Dice-poängen. Vid GTIN-konflikt frågar vi inte ens — streckkoden har redan svarat.
  if (!productId && match && !blockedByGtin) {
    const candidate = await prisma.product.findUnique({
      where: { id: match.productId },
      select: { title: true, normalizedTitle: true },
    });
    if (candidate) {
      // 1) DETERMINISTISKT FÖRST, GRATIS: är identitets-ordmängderna identiska i BÅDA
      //    riktningarna (era-namn/set-koder/formord borträknade) och alla tvåsidiga vakter
      //    redan passerade — då är det samma vara, och ingen LLM behöver tillfrågas.
      //    Detta är också det ENDA som fungerar när Anthropic-kvoten är slut: då returnerar
      //    judgeSameProduct null och HELA 0.55–0.85-bandet blev tidigare dubblettstubbar.
      //    ("Pokémon, Mega Evolutions, ME04: Chaos Rising, Display / Booster Box" = 0.789.)
      if (
        identicalIdentity(normalized, candidate.normalizedTitle) ||
        // Omslagskonst: "…, 1 Booster (Charizard Y Artwork)" ÄR setets baspack. Samma SKU,
        // annan packbild. Deterministisk och gratis — måste ligga FÖRE LLM-domen, för utan
        // Anthropic-kvot returnerar den null och hela bandet blev dubblettstubbar.
        wrapperArtSameProduct(facts.name ?? it.title, candidate.title)
      ) {
        productId = match.productId;
      } else {
        // 2) Annars: låt LLM-domen avgöra (samma som veckodedupen).
        //    ⛔ null = domaren OTILLGÄNGLIG (nyckel/kvot/fel) — inte "olika produkter".
        //    Då skapas INGENTING: en kandidat finns men kan inte prövas, och att gissa
        //    "ny produkt" var exakt så Wave 4 fyllde katalogen med dubbletter (75 st,
        //    ägarens genomgång 2026-08-08). Annonsen prövas om nästa körning.
        const verdict = await judgeSameProduct(cleanTitle, candidate.title);
        if (!verdict) {
          console.log(`[dedup] Domare otillgänglig — skjuter upp "${cleanTitle}" (kandidat: "${candidate.title}")`);
          return null;
        }
        if (verdict.same) productId = match.productId;
      }
    }
  }

  // ---- ANDRA CHANSEN: matcharen sa NULL, men finns varan ändå hos oss? ----
  // `matchProduct` avstår med flit när den inte kan VETA (täckningsgolv, marginalvakt,
  // tvåsidiga vakter) — rätt regel i prisvägen, där en felaktig länk ger fel pris. Här
  // är frågan en annan: "har vi den här varan redan?" Ett falskt nej blir en dubblett.
  // Mätt på Wave 4:s tre första importer skapades 2 dubbletter av 3 nya produkter, alla
  // med en katalogpost på 0,91–0,95 i Dice. Se nearestCatalogCandidate för varje fall.
  //
  // ⛔ Kräver indexet. Utan det (äldre anropare, DB-vägen) hoppas steget över helt —
  //    en katalogbred Dice-svepning per annons mot databasen vore orimlig.
  // ⛔ Domaren avgör, inte poängen. Golvet finns bara för att slippa fråga om
  //    orelaterade varor; att 0,86 är "nästan" betyder ingenting i sig.
  if (!productId && !match && index) {
    const near = nearestCatalogCandidate(normalized, cleanTitle, index, SECOND_CHANCE_MIN_SCORE);
    if (near) {
      const candidate = await prisma.product.findUnique({
        where: { id: near.id },
        select: { title: true, gtin: true },
      });
      // Streckkoden svarar före domaren, precis som ovan: två olika tillverkarkoder är
      // bevisat olika SKU:er och då ska annonsen bli en egen produkt.
      if (candidate && !gtinConflict(gtin, candidate.gtin ?? null)) {
        const verdict = await judgeSameProduct(cleanTitle, candidate.title);
        // Samma regel som i 0.55–0.85-bandet: otillgänglig domare + närliggande
        // kandidat = skapa inget, pröva om nästa körning.
        if (!verdict) {
          console.log(`[dedup] Domare otillgänglig — skjuter upp "${cleanTitle}" (kandidat: "${candidate.title}")`);
          return null;
        }
        if (verdict.same) {
          console.log(`[dedup] Andra chansen band "${cleanTitle}" → "${candidate.title}" (${near.score.toFixed(3)})`);
          productId = near.id;
        }
      }
    }
  }

  if (!productId) {
    // POSITIV POKÉMON-EVIDENS: franchise-blocklistan ovan kan bara stoppa spel den
    // KÄNNER TILL — "KPop Demon Hunters Energy Edition Booster Box" bar inget känt
    // franchisenamn och blev en katalogprodukt (2026-08-08). En NY produkt måste
    // därför bevisa att den är Pokémon: ordet, ett Pokémon-namn, ett känt setnamn
    // eller en Pokémon-exklusiv produktlinje. Länkning till BEFINTLIGA produkter
    // påverkas inte — vakten står bara vid skapandet.
    if (!hasPokemonTitleSignal(cleanTitle, await knownSetNames())) {
      console.log(`[import] Ingen Pokémon-signal — skapar ingen produkt: "${cleanTitle}"`);
      return null;
    }
    // KARAKTÄRSLÖS BLISTER/MINI TIN får ALDRIG bli en ny produkt: karaktären ÄR
    // identiteten för de formerna, så en annons utan karaktär kan inte veta vilken
    // katalogprodukt den är — och att gissa "ny" gav 30+ dubbletter i ägarens
    // genomgång 2026-08-08 ("SV6 Twilight Masquerade Premium Checklane Blister"
    // bredvid "…: Kingdra Premium Checklane Blister"). Vakten ligger HÄR, efter all
    // matchning: en karaktärslös annons som ändå matchat (ägd URL, GTIN, LLM-dom)
    // länkas som vanligt — bara skapandet stoppas.
    if (isUnspecifiedCharacterListing(cleanTitle)) {
      console.log(`[import] Karaktärslös blister/mini tin — skapar ingen produkt: "${cleanTitle}"`);
      return null;
    }
    let slug = slugify(cleanTitle) || `produkt-${Date.now().toString(36)}`;
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const p = await prisma.product.create({
      data: { title: cleanTitle, normalizedTitle: normalized, slug, category, imageUrl: it.imageUrl, language: listingCardLanguage(it.title, it.url), gtin },
      select: { id: true },
    });
    productId = p.id;
  } else if (gtin) {
    // Titelmatchningen band annonsen till en produkt som saknar kod → adoptera koden, men
    // BARA från en stark match. En svag (LLM-räddad) match får inte sätta katalogens nyckel:
    // en felmatch där hade förgiftat produkten för all framtid.
    if (match && match.confidence >= 0.85) {
      await prisma.product.updateMany({
        where: { id: productId, gtin: null },
        data: { gtin },
      });
    }
  }
  await upsertListingOffer(it, productId, stockStatus, gtin);
  await rememberListingProduct(it, productId);
  return productId;
}

/**
 * Skriver ner vilken produkt en butiks-URL löstes till, så nästa körning slipper
 * betala för samma dom igen (se memo-läsningen i ensureListingProduct).
 *
 * ⛔ `updateMany`, inte `update`: huvudboksraden skapas av anroparen EFTER det här
 * anropet första gången URL:en ses. `update` hade kastat P2025 på varje ny annons —
 * i en bakgrundsloop som redan sväljer fel hade det blivit tyst uteblivet memo, dvs
 * exakt buggen vi lagar. Anroparen skriver därför memot direkt i sin `create`.
 *
 * ⛔ Bara POSITIVA domar memoreras. Ett null-svar från domaren betyder "otillgänglig",
 * inte "olika produkter" — cachas det låser vi in ett icke-svar.
 */
async function rememberListingProduct(
  it: { url: string; title: string; retailerId: string },
  productId: string
): Promise<void> {
  await prisma.storeListing.updateMany({
    where: { retailerId: it.retailerId, url: it.url },
    data: { productId, productMatchTitle: it.title },
  });
}

/**
 * Skapar butikens offer för en auto-importerad annons (om den saknas) och sparar
 * annonsens streckkod på offern. Offer.gtin driver konflikt-/dubblettrapporterna
 * (scripts/gtin-report.ts) — två offers på samma produkt med OLIKA gtin är en
 * bevisad felaktig butikslänk, hittad med ren SQL utan en enda LLM-token.
 */
async function upsertListingOffer(
  it: { title: string; url: string; price: number | null; retailerId: string; category?: string | null },
  productId: string,
  stockStatus: StockStatus,
  gtin: string | null
): Promise<void> {
  // Offer-språket följer annonsen (japansk annons → JP-offer), inte hårdkodat EN.
  const offerLanguage = listingCardLanguage(it.title, it.url);
  // PLATSHÅLLARPRIS (1 kr-presale) blir aldrig ett offer-pris: här är enda stället
  // rimlighetsvakten mot CM-facit inte kan skydda (stubben är ny → inget facit än),
  // och det var exakt så Kanto Vaults 1 kr fastnade som pris + "Average price 100 kr".
  const price = isPlaceholderListingPrice(it.price, it.category ?? null) ? null : it.price;
  // Butiken kan redan ha en offer för produkten via en ANNAN sida (variant) — kapa
  // inte den offerens URL (varianten spåras i StoreListing-huvudboken). Bara skapa
  // när offer saknas helt; URL:en själv är obelagd (owner-vakten ovan returnerade annars).
  const existing = await prisma.offer.findFirst({
    where: { productId, retailerId: it.retailerId, condition: "SEALED", language: offerLanguage },
    select: { id: true, gtin: true },
  });
  if (!existing) {
    await prisma.offer.create({
      data: { productId, retailerId: it.retailerId, condition: "SEALED", language: offerLanguage, price, currency: "SEK", stockStatus, url: it.url, gtin },
    });
    return;
  }
  if (gtin && !existing.gtin) {
    await prisma.offer.update({ where: { id: existing.id }, data: { gtin } });
  }
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
 * Vilka offers ska SLÅS UPP mot butikens produktsida för att deras URL försvunnit ur
 * feeden? De vars butik hämtades den här körningen (`feedRetailers`, ≥1 produkt) men
 * vars URL saknas i feeden (`freshKeys`). Ren funktion → testbar utan DB/adaptrar.
 *
 * Frånvaro ≠ slutsåld, och den är inte heller ett mysterium: den GÅR att kolla. Förr
 * nollades de här till UNKNOWN, vilket var ärligt men blint — i pristabellen blev det
 * "Okänd" bredvid ett dagsgammalt pris, och eftersom UNKNOWN→IN_STOCK inte räknas som
 * en äkta övergång larmade en efterföljande restock ALDRIG. Nu frågar vi butikens egen
 * produktsida (verifyStockForUrl) och skriver det riktiga svaret; UNKNOWN står kvar bara
 * när butiken inte kan svara.
 *
 * INGET STATUSFILTER (till skillnad från förr): också redan slutsålda och redan
 * UNKNOWN-nollade offers hör hit. Det är hela poängen — en Speltrollet-vara som är
 * slutsåld ligger inte i deras Pokémon-kollektioner alls, så feeden kan aldrig visa
 * att den kommit tillbaka. Utan uppslaget vore de varorna permanent osynliga för
 * restock-larmen.
 *
 * DEBOUNCE (`graceMs`): ett enda missat besök får inte utlösa uppslag — kräv att offern
 * varit borta i minst `graceMs` (senast sedd `lastSeenAt` äldre än så). Anroparen bumpar
 * `lastSeenAt` efter uppslaget, så varje offer frågas högst en gång per karensfönster
 * hur ofta lanen än kör. Äldst först: taket (RESTOCK_VERIFY_MAX) roterar då rättvist.
 */
export function offersToVerify<
  T extends { retailerId: string; url: string; stockStatus: StockStatus; lastSeenAt: Date | null }
>(offers: T[], freshKeys: Set<string>, feedRetailers: Set<string>, now: Date, graceMs: number): T[] {
  return offers
    .filter(
      (o) =>
        feedRetailers.has(o.retailerId) &&
        !freshKeys.has(`${o.retailerId}:${o.url}`) &&
        (o.lastSeenAt == null || now.getTime() - o.lastSeenAt.getTime() >= graceMs)
    )
    .sort((a, b) => (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0));
}

export async function runRestockScan(opts?: {
  // Snabb-fil: begränsa till namngivna butiker (t.ex. ["Manatörsk"]) → fingeravtrycket
  // täcker bara dem, så en tät körning väcker Neon bara när DE flippar. Utelämnas = alla.
  onlySources?: string[];
  // Cachad källista (från förra körningen) — utan denna väcker redan källist-
  // uppslaget Neon på VARJE körning, vilket på 2-min-snabbfilen = aldrig scale-to-zero.
  sources?: RestockSourceInfo[];
  // Får HELA den normaliserade annonsen (inte bara url+status): Discord-snabbfilen
  // (scripts/discord-restock-run.ts) bygger sina inlägg här och returnerar alltid
  // false, så den kör fas 1 (ren HTTP) och lämnar DB:n orörd. Signaturen speglar
  // därmed vad som FAKTISKT skickas in — den var smalare än verkligheten.
  shouldProcess?: (
    fetched: { sourceName: string; items: FeedItem[] }[]
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
  // ⏱ TIDTAGNING PER BUTIK. Discord-lanens TICK-INTERVALL kan aldrig bli kortare än
  // det här svepet, så "lanen är långsam" är nästan alltid "en butik är långsam" —
  // och fram till nu fanns det ingen logg som sa VILKEN. Ett tak eller en svans som
  // inte syns i loggen är samma sorts tysta gräns som MAX_COLLECTIONS var.
  const sweepStart = Date.now();
  const durations = new Map<string, number>();
  await mapPool(sources, RESTOCK_SCAN_CONCURRENCY, async (source, i) => {
    const started = Date.now();
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
    } finally {
      durations.set(source.name, Date.now() - started);
    }
  });

  // Svepets väggklocka + de fem långsammaste butikerna. Wall-clock är INTE summan:
  // butikerna hämtas `RESTOCK_SCAN_CONCURRENCY` åt gången, och samtidigheten går över
  // OLIKA värdar — varje butiks EGNA requests är fortfarande serialiserade med sin
  // egen paus, så en höjning ökar aldrig lasten mot en enskild butik.
  const slowest = [...durations].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(
    `[restock-scan] Feed-svep: ${((Date.now() - sweepStart) / 1000).toFixed(1)} s för ` +
      `${sources.length} butiker (samtidighet ${RESTOCK_SCAN_CONCURRENCY}). Långsammast: ` +
      slowest.map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)} s`).join(", ")
  );

  // Tom katalog UTAN kastat fel är osynligt annars — och det var precis den tystnaden
  // som gömde flapp-buggen 2026-07-25 (Alphaspel svarade tomt varannan körning). Logga
  // den, så nästa avvikelse syns direkt i körningsloggen.
  const emptySources = fetched.filter((f) => f.items.length === 0).map((f) => f.sourceName);
  if (emptySources.length) {
    console.warn(`[restock-scan] Tom katalog (inget fel kastat) från: ${emptySources.join(", ")}`);
  }

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
  await ensureDbAwake();
  // Admins denylistade URL:er — EFTER ändringsgrinden och ensureDbAwake, av exakt
  // samma skäl som allt annat här: fas 1 ska aldrig röra DB:n. Utan den här raden
  // skulle feed-först-grenen (ensureListingProduct) skapa om precis det admin nyss
  // tagit bort på produktsidan.
  await loadAdminDenylist();

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
  // sourceName följer med: auto-importen behöver veta VILKEN butik annonsen kom från
  // för att välja rätt väg till streckkoden (Shopify-.js / JSON-LD / Webhallen-API).
  const fresh = new Map<string, FeedItem & { retailerId: string; sourceName: string }>();
  for (const { sourceName, items } of fetched) {
    const retailerId = retailerByName.get(sourceName);
    if (!retailerId) continue;
    for (const it of items) {
      const key = `${retailerId}:${it.url}`;
      if (fresh.get(key)?.stockStatus === StockStatus.IN_STOCK) continue;
      fresh.set(key, { ...it, retailerId, sourceName });
    }
  }

  let checked = 0;
  let restocks = 0;
  let newListings = 0;
  let sent = 0;
  let offersCreated = 0;
  // ---- KÖPBARHETSKOLL VID LAGERÖVERGÅNG (2026-08-15) ----
  // Shopifys `available` betyder inte "går att köpa": Kortarkivets Ascended Heroes
  // Booster Bundle stod `available: true` i både products.json och .js medan
  // storefronten visade "Slut i lager" och renderade köpknappen `disabled`. Se
  // purchasableFromShopifyPage för hela utredningen. Slås upp BARA när en offer är på
  // väg IN i lager — det är då svaret spelar roll, och det är få tillfällen.
  //
  // ⛔ MÄTT FÖRE PÅSLAG (2026-08-15) mot 20 Shopify-butikers riktiga produktsidor,
  //    tre i lager + tre slutsålda per butik: 0 fall där detektorn MOTSADE feeden
  //    felaktigt, 1 äkta träff (just den produkten), och 4 butiker där den avstår
  //    (null) för att temat inte renderar ett `/cart/add`-formulär vi kan läsa.
  //    Den egenskapen — håller med eller avstår — är varför den kan användas för
  //    ALLA butiker utan en handhållen lista: `null` betyder "lita på feeden".
  const shopifySources = new Set<string>();
  for (const s of sources) {
    if (s.type !== SourceType.SCRAPER) continue;
    try {
      if (getAdapter(s.type, s.name) instanceof ShopifyAdapter) shopifySources.add(s.name);
    } catch {
      // Okänt källnamn → ingen adapter → ingen köpbarhetskoll. Loggas redan av getAdapter.
    }
  }
  let buyChecks = 0;
  let buyChecksBlocked = 0;
  /** IN_STOCK som butikens egen sida motsäger → behandla som slutsåld. */
  const confirmIncomingStock = async (
    sourceName: string,
    url: string,
    newStatus: StockStatus
  ): Promise<StockStatus> => {
    if (newStatus !== StockStatus.IN_STOCK) return newStatus;
    if (!shopifySources.has(sourceName)) return newStatus;
    if (buyChecks >= RESTOCK_BUY_CHECK_MAX) return newStatus; // fail open, se konstanten
    buyChecks++;
    const purchasable = await fetchShopifyPurchasable(url);
    if (purchasable === false) {
      buyChecksBlocked++;
      console.log(`[restock-scan] ${sourceName}: feeden säger i lager men köpknappen är låst — ${url}`);
      return StockStatus.OUT_OF_STOCK;
    }
    return newStatus;
  };
  /** Lat, delad katalog i minnet — se anropet i feed-först-grenen. */
  let matchIndexForImport: MatchIndex | null = null;
  // TVÅ PASS med flit (2026-08-12): offer-diffen (restock-larmen, det tidskritiska)
  // körs FÖRST och larmen SKICKAS direkt efteråt — feed-först-grenen därunder gör
  // auto-import med LLM-domar och GTIN-uppslag som mätt tar 1–2 min, och innan
  // uppdelningen satt ett färdigt restock-larm och väntade bakom det arbetet.
  const feedFirst: Array<[string, FeedItem & { retailerId: string; sourceName: string }]> = [];
  for (const [key, it] of fresh) {
    let newStatus = it.stockStatus;
    const offer = offerByKey.get(key);
    if (!offer) {
      feedFirst.push([key, it]);
      continue;
    }

    // ---- Matchad produkt: beprövad offer-diff (oförändrad logik) ----
    {
      checked++;
      // Bara vid en ÄKTA övergång in i lager — inte för en offer som redan står där.
      // Annars hade varje körning slagit upp varenda i-lager-produkt.
      if (newStatus === StockStatus.IN_STOCK && offer.stockStatus !== StockStatus.IN_STOCK) {
        newStatus = await confirmIncomingStock(it.sourceName, it.url, newStatus);
      }
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
            price: it.price,
          },
        });
        if (ev.isRestock) {
          await checkRestockAlerts(offer.productId, offer.retailerId, {
            from: ev.oldStatus,
            to: newStatus,
          });
          restocks++;
        } else if (ev.isPreorderOpen) {
          // Slutsåld → går att förhandsboka. Samma mottagare och cooldown som en
          // restock (checkRestockAlerts), egen copy via övergången. Fanns förr bara
          // för HELT nya butiks-URL:er (feed-först) — en butik som redan hade en
          // offer öppnade förhandsbokning helt tyst.
          await checkRestockAlerts(offer.productId, offer.retailerId, {
            from: ev.oldStatus,
            to: newStatus,
          });
          newListings++;
        }
      }
      if (offer.stockStatus !== newStatus) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: {
            stockStatus: newStatus,
            lastSeenAt: new Date(),
            // Larmmejlets pris läses från offern (dispatch körs EFTER loopen). Utan
            // färskt pris här visade "Åter i lager" ett veckogammalt pris — Shinycards
            // roterar sin feed så scrape-all hade inte sett produkten på länge
            // (Charizard ex SC: 699 kr i mejlet, 799 kr i butiken, 2026-07-16).
            // Feeden HAR dagspriset; skriv det i SAMMA write som statusflippen
            // (noll extra Neon-writes — lanen skriver fortfarande bara vid övergångar).
            // Platshållarpris (1 kr-presale) räknas som "pris okänt" — skriv inget.
            ...(it.price != null && !isPlaceholderListingPrice(it.price, it.category)
              ? { price: it.price }
              : {}),
          },
        });
      }
    }
  }

  // Restock-/förhandsbokningslarmen från offer-diffen skickas NU, inte efter
  // hela skanningen: feed-först-passet nedan kan ta minuter, och ett färdigt larm
  // ska inte vänta bakom det. Grindad så en larmlös körning slipper extra fråga.
  if (restocks + newListings > 0) {
    sent += (await dispatchPendingAlerts()).sent;
  }

  // ---- Feed-först: URL utan Offer (ny SKU / art-variant / produkt utanför katalogen) ----
  for (const [key, it] of feedFirst) {
    let newStatus = it.stockStatus;
    // Bara sealed — singlar/övrigt skulle spamma (se SEALED_FEED_CATEGORIES).
    if (!SEALED_FEED_CATEGORIES.has(it.category ?? "")) continue;
    // Blockade språk (kinesiska/koreanska) auto-importeras inte "for now" → ingen ny
    // produkt, inget larm. Japanska släpps igenom (sealed → OK). Kolla även URL:en —
    // slugs som "…-kinesisk-version" avslöjar språk som titeln döljer.
    if (isBlockedListingLanguage(it.title, it.url)) continue;
    checked++;
    // Samma köpbarhetskoll som offer-grenen: en HELT ny annons som feeden säger är i
    // lager blir ett "ny produkt i lager"-larm, och ett falskt sådant är lika fel som
    // ett falskt restock-larm. Grinden ligger EFTER vaktkedjans billiga filter så vi
    // aldrig hämtar en produktsida för en singel eller ett gosedjur.
    newStatus = await confirmIncomingStock(it.sourceName, it.url, newStatus);
    // Auto-import: skapa/länka katalogprodukt + offer → larmet pekar på VÅR produktsida
    // (in-app), och nästa skanning spårar URL:en via offer-diffen ovan.
    // Katalogindexet laddas LAT och delas: bara feed-först-grenen behöver det, och en
    // körning där ingen butik har en okänd URL (det normala) ska inte betala för att
    // läsa ~22k rader ur Neon. Se loadMatchIndex för varför minnesvägen är den enda
    // pålitliga — och nearestCatalogCandidate för vad den används till här.
    matchIndexForImport ??= await loadMatchIndex();
    const productId = await ensureListingProduct(it, newStatus, matchIndexForImport);
    if (productId) offersCreated++;
    const listing = listingByKey.get(key);
    if (!listing) {
      // Aldrig sedd → skapa huvudboksrad. Larma BARA om butiken redan har historik
      // (annars = tyst seedning) och annonsen faktiskt är i lager.
      const created = await prisma.storeListing.create({
        data: {
          retailerId: it.retailerId,
          url: it.url,
          title: it.title,
          // Platshållarpris (1 kr-presale) i huvudboken hade satt "1 kr" i
          // "Ny produkt"-larmmejlet — okänt pris är det ärliga värdet.
          price: isPlaceholderListingPrice(it.price, it.category) ? null : it.price,
          imageUrl: it.imageUrl,
          stockStatus: newStatus,
          // Gratis: ensureListingProduct slog redan upp koden för samma URL och
          // fetchListingGtin memoiserar per körning → ingen extra HTTP-request.
          gtin: await fetchListingGtin(it.sourceName, it.url),
          // Memot skrivs HÄR för en URL vi aldrig sett förut: rememberListingProduct
          // körde innan raden fanns (updateMany → 0 rader). Utan detta hade varje ny
          // annons dömts en andra gång i nästa körning.
          productId,
          productMatchTitle: productId ? it.title : null,
        },
      });
      // Larma bara om butiken redan har historik (ej tyst seed). Ny produkt I LAGER
      // = NEW_LISTING; ny produkt i FÖRHANDSBOKNING = PREORDER (köpbar inför release).
      // Roterande feeds (Swepoke) undantas: en "ny" URL där är oftast en URGAMMAL
      // annons som roterat in i synfältet (23 000 kr-boxen larmades som "ny produkt").
      // productId-GRINDEN: ensureListingProduct är portvakten — null = avvisad som
      // icke-katalogvärdig (tillbehör/lot/annan franchise) och får då ALDRIG larma.
      // Utan grinden mejlades Speltrollets akrylfodral "for One Piece Booster Box"
      // som "Ny produkt i lager" (2026-07-16): vakten stoppade PRODUKTEN men inte LARMET.
      // RESTOCK_SEED_SILENT=1 (2026-08-13): tyst seedning även för butiker MED
      // historik — när en BEFINTLIG butiks feed-täckning utökas (Samlarhobby gick
      // 379 → 975 synliga produkter) är de "nya" URL:erna gammalt sortiment, och utan
      // spaken hade första skanningen mejlat hela utökningen som "Ny produkt i lager".
      // Sätts BARA av engångsimporter (run-wave-import), aldrig i workflowen.
      const silentSeed = process.env.RESTOCK_SEED_SILENT === "1";
      if (productId && !silentSeed && seededRetailers.has(it.retailerId) && !rotatingRetailerIds.has(it.retailerId)) {
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
    // Samma productId-grind som ovan: avvisade annonser (tillbehör/annan franchise)
    // spåras i huvudboken men larmar aldrig.
    if (productId && isRestock(listing.stockStatus, newStatus)) {
      await checkListingAlerts(
        { id: listing.id, title: it.title, retailerId: it.retailerId, productId },
        "RESTOCK",
        { from: listing.stockStatus, to: newStatus }
      );
      restocks++;
    } else if (
      // Öppnad för förhandsbokning (t.ex. var slut/okänd, nu köpbar inför release).
      productId &&
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
  // "i lager" i 2 v). Fixa: offers vars URL INTE fanns i feeden denna körning slås
  // upp mot butikens produktsida. Bara för butiker vars feed faktiskt hämtades
  // (≥1 produkt) så ett nätverksfel/tom feed inte rör hela butiken.
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
  const verifyMax = Number(process.env.RESTOCK_VERIFY_MAX ?? 20);
  const retailerNameById = new Map<string, string>();
  for (const [name, id] of retailerByName) retailerNameById.set(id, name);
  let soldOutReconciled = 0;
  let verified = 0;
  for (const o of offersToVerify(offers, freshKeys, feedRetailers, now, graceMs).slice(0, verifyMax)) {
    // FRÅGA BUTIKEN i stället för att tolka tystnaden. Frånvaro ur feeden betyder
    // olika saker i olika butiker (Speltrollet listar inte slutsålt i sina Pokémon-
    // kollektioner, Swepoke roterar sortimentet) — men produktsidan vet alltid.
    const sourceName = retailerNameById.get(o.retailerId);
    const truth = sourceName ? await verifyStockForUrl(sourceName, o.url) : null;
    // Inget svar → statusAfterVerify behåller det vi redan visste (ett 429 är ingen
    // upplysning); bara ett obackat "i lager" faller till UNKNOWN, precis som förut.
    const newStatus = statusAfterVerify(o.stockStatus, truth);
    if (newStatus === o.stockStatus && truth === null) {
      // Ingen ny kunskap och ingen ändring — bumpa bara ankaret så vi inte frågar
      // samma tysta butik igen inom karensfönstret.
      await prisma.offer.update({ where: { id: o.id }, data: { lastSeenAt: now } });
      soldOutReconciled++;
      continue;
    }

    // Samma larmväg som feed-diffen ovan, med samma KRITISKA ordning (larma först,
    // flippa sist). Riktningen sköter netStockEvent: UNKNOWN→IN_STOCK är ingen äkta
    // övergång och larmar därför inte — så en offer som stått "Okänd" i dagar helas
    // TYST i stället för att mejla ut en restock som aldrig hänt.
    const ev = netStockEvent(o.stockStatus, newStatus);
    const hidden = HIDDEN_CATEGORIES.includes(o.product.category);
    if (!hidden && ev.emit) {
      await prisma.restockEvent.create({
        data: { productId: o.productId, retailerId: o.retailerId, oldStatus: ev.oldStatus, newStatus, price: null },
      });
      if (ev.isRestock || ev.isPreorderOpen) {
        await checkRestockAlerts(o.productId, o.retailerId, { from: ev.oldStatus, to: newStatus });
        if (ev.isRestock) restocks++;
        else newListings++;
      }
    }
    // lastSeenAt bumpas ÄVEN när uppslaget gav null: vi HAR kollat annonsen nu, och utan
    // det ankaret blir samma tysta butik en kandidat varje körning (2-min-lanen → samma
    // URL hundratals gånger per dygn). Med bumpen frågar vi om varje offer högst en gång
    // per karensfönster, oavsett hur ofta lanen kör.
    await prisma.offer.update({
      where: { id: o.id },
      data: { stockStatus: newStatus, lastSeenAt: now },
    });
    if (truth) verified++;
    else soldOutReconciled++;
  }

  sent += (await dispatchPendingAlerts()).sent;
  console.log(
    `[restock-scan] ${sources.length} butiker, ${checked} kollade, ${restocks} restocks, ${newListings} nya, ${verified} verifierade mot produktsidan, ${soldOutReconciled} utan svar (UNKNOWN), ${sent} alerts.`
  );
  if (buyChecks > 0) {
    console.log(
      `[restock-scan] Köpbarhetskoll: ${buyChecks} uppslag, ${buyChecksBlocked} annons(er) ` +
        `omklassade till slut i lager (feeden sa i lager, butikens köpknapp var låst)` +
        (buyChecks >= RESTOCK_BUY_CHECK_MAX ? ` — TAKET (${RESTOCK_BUY_CHECK_MAX}) NÅTT, resten litade på feeden.` : ".")
    );
  }
  return { sources: sources.length, checked, restocks, newListings, alertsSent: sent, sourceList: sources, offersCreated };
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

/**
 * Laddar admins denylistade URL:er (`DeniedListingUrl`) in i minnet.
 *
 * ⛔ EN GÅNG PER KÖRNING, aldrig per annons: `isDeniedListingUrl` anropas i loopar med
 *    tusentals varv, och ett uppslag där hade blivit tusentals frågor. Kallas därför
 *    från jobbens ingångar, där Neon ändå är vaken.
 * ⛔ ETT FEL SVÄLJS INTE TYST utan loggas — utan listan skapar auto-importen om precis
 *    det admin nyss tagit bort, och det felet syns annars först när dubbletten är
 *    tillbaka. Den STATISKA listan gäller ändå.
 */
async function loadAdminDenylist(log?: (m: string) => void): Promise<void> {
  try {
    const rows = await prisma.deniedListingUrl.findMany({ select: { url: true } });
    setDynamicDenylist(rows.map((r) => r.url));
    log?.(`Denylista: ${dynamicDenylistSize()} admin-nekade URL:er laddade.`);
  } catch (err) {
    console.error("[denylist] kunde inte läsa DeniedListingUrl:", err instanceof Error ? err.message : err);
  }
}

export async function runScrapeJob(sourceId: string, maps?: CatalogMaps): Promise<ScrapeJobSummary> {
  await loadAdminDenylist();
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

    // LLM-FÄLLDA TRADERA-PAR ÅTERSKAPAS ALDRIG — INTE HELLER HÄR (2026-08-10).
    // Sweepen och findReplacementListing konsulterar TraderaMatch(ok=false), men den
    // här generiska skrap-loopen gjorde det inte: "Pokémon TCG: Mega Charizard Tin"
    // (738310978, dömd "tom ask" 07-07) skrevs tillbaka som 100 kr-offer VARJE natt i
    // en månad — verifyTraderaMatches nollar bara par den inte redan dömt. Samma
    // nyckel som sweepen: `${itemId}|${productId}`.
    const rejectedTraderaPairs =
      source.name === "Tradera"
        ? new Set(
            (
              await prisma.traderaMatch.findMany({
                where: { ok: false },
                select: { itemId: true, productId: true },
              })
            ).map((m) => `${m.itemId}|${m.productId}`)
          )
        : null;

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

        // Ägar-denylist: URL:er som ALDRIG ska bli/vara en offer. Feed-först-vakten
        // (ensureListingProduct) täckte bara restock-lanen — scrape-all-matcharen
        // fuzzy-matchade annars om samma denylistade URL till en befintlig produkt
        // varje körning, så den raderade offern kom tillbaka dygnet därpå. (DL:s
        // "Lucario ex Battle Deck" ↔ "Mega Lucario ex League Battle Deck".)
        if (isDeniedListingUrl(normalized.url)) {
          logs.push(`Denylistad URL — hoppar: "${rawProduct.title}" (${normalized.url})`);
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

        // Tradera-annons + produkt som en LLM-dom redan fällt → rör den aldrig.
        if (rejectedTraderaPairs) {
          const itemId = normalized.url.match(/\/item\/\d+\/(\d+)/)?.[1];
          if (itemId && rejectedTraderaPairs.has(`${itemId}|${productId}`)) {
            logs.push(`Känd felmatch (TraderaMatch ok=false) — hoppar: "${rawProduct.title}"`);
            continue;
          }
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

        // Platshållarpris (1 kr-presale): inget pris, ingen observation. Rimlighets-
        // vakten ovan kräver ett CM-facit; det här är det facit-fria golvet.
        if (
          !CARDMARKET_SOURCE_NAMES.includes(source.name) &&
          isPlaceholderListingPrice(normalized.price, matchedCategory)
        ) {
          logs.push(`Platshållarpris — hoppar: "${rawProduct.title}" ${normalized.price} öre`);
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
        // Samma övergång som RestockEvent-raden ovan påstår (OUT → IN): en helt ny
        // offer i lager behandlas som en påfyllning. Explicit så cooldownen (som
        // scopar på toStatus) ser den och nästa körnings restock inte dubblerar.
        await checkRestockAlerts(st.productId, retailer.id, {
          from: StockStatus.OUT_OF_STOCK,
          to: StockStatus.IN_STOCK,
        });
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
      // Restock-/förhandsbokningslarm BARA för riktiga butiker — aldrig Cardmarket/
      // Tradera. Samma två övergångar som restock-lanen håller isär (se den).
      if (
        (ev.isRestock || ev.isPreorderOpen) &&
        !NON_RETAIL_SOURCE_NAMES.includes(retailer.name)
      ) {
        await checkRestockAlerts(st.productId, retailer.id, {
          from: ev.oldStatus,
          to: st.newStatus,
        });
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
