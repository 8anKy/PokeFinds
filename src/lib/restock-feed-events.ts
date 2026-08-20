/**
 * Vilka lagerövergångar i en feed-hämtning som ska bli DISCORD-INLÄGG — helt utan DB.
 *
 * Ren funktion. All kunskap som normalt kommer ur databasen skickas in:
 *  - `prev` (förra körningens lagerläge) och `history` (övergångar i dygnsfönstret)
 *    ligger i Actions-cachen i stället för i RestockEvent-tabellen,
 *  - `routes` (butiks-URL → vår produkt/set/serie) exporteras av ett jobb som ändå
 *    väcker Neon, så den här lanen aldrig behöver göra det.
 *
 * ⛔ RUTTABELLEN ÄR ENRIKNING, INTE EN GRIND (2026-08-16). Fram till nu postades
 * INGENTING vars URL saknades i ruttabellen. Det var lanens enda sätt att veta vad en
 * vara var — och samtidigt orsaken till ägarens felrapport: mejl och push kom fram om
 * påfyllningar som Discord teg om, i de flesta butiker. Ruttabellen bär bara URL:er
 * med en Offer eller en bunden huvudboksrad; allt annat butikerna säljer (nya SKU:er,
 * varor katalogen aldrig importerat, URL-varianter som per konstruktion aldrig kan få
 * en egen Offer) var osynligt. Domen tas nu på ANNONSEN, av samma vakter som
 * auto-importen använder — se `src/lib/discord-restock-filter.ts`. Rutten används
 * fortfarande när den finns: snyggare titel, rätt set-/seriekanal, länk till vår
 * produktsida.
 *
 * ⛔ TRE REGLER SOM MÅSTE SPEGLA DB-VÄGEN, annars driver lanarna isär tyst:
 *  1. Blink/flapp döms av `evaluateStockFlap` — SAMMA funktion som checkRestockAlerts,
 *     inte en kopia (därför bor den i @/lib/stock-flap sedan 2026-08-11).
 *  2. Cooldown per (butik, URL) precis som DB-vägens per (produkt, butik).
 *  3. Tom feed = ingen information. `mergeStateMap` äger den regeln; anropa den,
 *     bygg aldrig state ur bara den här körningens feed. Att missa det kostade
 *     23 % → 84 % vaken Neon-tid i juli 2026.
 *
 * ⛔ FRÅNVARO HAR ETT MINNE NU (`absent`, 2026-08-16). `mergeStateMap` GLÖMMER en URL
 * som försvinner ur en levererande feed, och det gav två fel åt var sitt håll:
 *   · ROTERANDE BUTIKER TAPPADE ÄKTA PÅFYLLNINGAR. Shinycards och Swepoke levererar
 *     en roterande delmängd, så en URL som sågs slutsåld, roterade ut och kom
 *     tillbaka I LAGER dök upp som "ABSENT → IN_STOCK" — och rotationsregeln kastar
 *     den (med rätta: en URL som bara dyker upp är inget besked). Det gjorde att två
 *     av de mest aktiva butikerna aldrig kunde ge ett restock-inlägg via den vägen,
 *     medan DB-lanen larmade som vanligt eftersom `Offer.stockStatus` LIGGER KVAR.
 *     Nu minns vi statusen över frånvaron: ett IHÅGKOMMET slutsålt → i lager ÄR en
 *     påfyllning, oavsett om butiken roterar. Rotationen kan inte fabricera den —
 *     ett OUT_OF_STOCK måste faktiskt ha OBSERVERATS.
 *   · FEED-HICKOR BLEV FALSKA PÅFYLLNINGAR. En butik vars feed råkar leverera en
 *     delmängd (Pocketmonsters gjorde det 2026-08-16: 83 "flippar" i ETT tick, allt
 *     från badbyxor till plånböcker) tappade sina URL:er ur minnet och fick dem
 *     tillbaka som nyheter nästa hämtning. Var de borta kortare än blinkfönstret
 *     (`minAwayMinutes`, samma tal som DB-vägen) lämnade varan aldrig hyllan — och
 *     då är det ingen nyhet. Utan den regeln stämplas dessutom cooldown på hundratals
 *     URL:er, vilket kan TYSTA en äkta påfyllning de närmaste två timmarna.
 */
import { actionableChanges, mergeStateMap, type FeedStateMap } from "@/lib/feed-state-diff";
import { evaluateStockFlap, FLAP_WINDOW_HOURS, type FlapPolicy } from "@/lib/stock-flap";
import {
  judgePriceDrop,
  type PriceDropPolicy,
  type PricePostMemory,
  type PriceRejectReason,
} from "@/lib/price-drop";
import type { RestockPost } from "@/lib/discord-restock";
import {
  classifyDiscordListing,
  matchKnownSet,
  type DiscordFilterContext,
  type DiscordRejectReason,
  type KnownSet,
} from "@/lib/discord-restock-filter";
import type { StockStatus } from "@prisma/client";

/** Feed-annonsen med allt inlägget behöver (superset av FeedItemLite). */
export interface FeedItemFull {
  url: string;
  stockStatus: StockStatus;
  title: string;
  price: number | null;
  imageUrl: string | null;
  /** Adapterns formgissning (`guessListingCategory`). Vägs in av vaktkedjan. */
  category?: string | null;
}

export interface FullFeedGroup {
  sourceName: string;
  items: FeedItemFull[];
}

/** En rad i ruttabellen: vad butikens URL är hos OSS. */
export interface RouteEntry {
  title: string;
  slug: string;
  setName: string | null;
  series: string | null;
  /**
   * Produktens språk ("EN"/"JP"). Saknas i äldre cachade ruttabeller → tolkas som EN.
   * Behövs för kanalvalet: JP-set bär samma latinska serienamn som EN-serierna.
   */
  language?: string | null;
  /** Katalogbilden — reserv för embed-miniatyren när butiksfeeden saknar bild. */
  imageUrl?: string | null;
}

export type RouteTable = Record<string, RouteEntry>;

/** En övergång i dygnsfönstret. Kompakta nycklar — kartan ligger i en cache-fil. */
export interface HistoryEntry {
  /** oldStatus */
  o: string;
  /** tidpunkt, ms */
  t: number;
}

/** Sista kända status för en URL som FÖRSVUNNIT ur en levererande feed. */
export interface AbsentEntry {
  /** status när den sågs senast */
  s: string;
  /** när den försvann, ms */
  t: number;
}

export interface DiscordRestockState {
  /** url-nyckel → lagerstatus, exakt formatet feed-state-diff redan använder. */
  stock: FeedStateMap;
  /** url-nyckel → övergångar, nyast först, beskuren till dygnsfönstret. */
  history: Record<string, HistoryEntry[]>;
  /** url-nyckel → när vi senast POSTADE om den (cooldown). */
  posted: Record<string, number>;
  /**
   * url-nyckel → status när URL:en lämnade en LEVERERANDE feed. Se filhuvudet:
   * utan det här minnet kan varken en roterande butiks äkta påfyllning skiljas från
   * rotation, eller en feed-hicka från en riktig nyhet. Saknas i äldre state-filer
   * → tolkas som tom, och lanen beter sig då exakt som förut tills minnet byggts upp.
   */
  absent?: Record<string, AbsentEntry>;
  /**
   * url-nyckel → senast sedda pris i ÖRE, men BARA för annonser vi såg I LAGER
   * (plus de som ligger i `absent`). Baslinjen för prissänkningslarmen.
   *
   * ⛔ AVGRÄNSNINGEN ÄR EN KOSTNADSREGEL, INTE SNÅLHET. `stock` bär alla ~25 000
   * feed-URL:er (~3 MB) och HELA state-filen serialiseras om synkront var 10:e sekund
   * på samma tråd som 42 butikers diff-block. En andra karta över samma nyckelrymd
   * hade fördubblat den stallen för ingenting: en slutsåld annons kan aldrig ge ett
   * prisinlägg, och kommer den tillbaka i lager är PÅFYLLNINGEN nyheten.
   * MÄTT 2026-08-21 (torrkörning, fem butiker): 796 priser mot 2 113 lagerposter =
   * **38 %**, dvs 83 kB mot lagerkartans 237 kB. Filen växer alltså ~⅓, inte dubbelt.
   *
   * ⚠️ Kartan bär också annonser vaktkedjan skulle fälla (gosedjur, sleeves) — med
   * flit. Att filtrera minnet hade krävt ett dussin regexar per annons och varv,
   * dygnet runt, för att spara några tiotals kilobyte. Vakten körs i stället bara på
   * de fåtal annonser som faktiskt föll i pris.
   *
   * Saknas i äldre state-filer → tom karta ⇒ ingen baslinje ⇒ inga prisinlägg första
   * varvet efter en deploy. Det är rätt beteende: utan baslinje finns ingen sänkning.
   */
  price?: Record<string, number>;
  /**
   * url-nyckel → prisnivån vi SENAST postade om, och när. Pendlingsspärr: en butik som
   * växlar 559 ⇄ 450 får annars ett inlägg varje varv. Egen karta, INTE `posted` —
   * delade de nyckelrymd hade ett prisinlägg tystat en riktig PÅFYLLNING i två timmar,
   * och påfyllningen är alltid det värdefullare larmet.
   */
  pricePosted?: Record<string, PricePostMemory>;
}

export function emptyState(): DiscordRestockState {
  return { stock: {}, history: {}, posted: {}, absent: {}, price: {}, pricePosted: {} };
}

/**
 * Läser tillbaka state-filens innehåll. `null` = oanvändbar (saknar lagerläget) →
 * anroparen seedar om.
 *
 * ⛔ LIGGER HÄR, INTE I CLI-SCRIPTET, för att den ska gå att TESTA. Fältet `pending`
 * tappades tyst vid inläsningen mellan 2026-08-13 och 2026-08-15: den rena domen
 * hade tester, men serialiseringen runt den hade inga. En ren funktion utan I/O är
 * skillnaden mellan "testat" och "trodde vi testade" — lägg därför ALDRIG tillbaka
 * fält-för-fält-bygget i scriptet.
 */
export function parseDiscordRestockState(parsed: unknown): DiscordRestockState | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<DiscordRestockState>;
  if (!p.stock || typeof p.stock !== "object") return null;
  const obj = <T>(v: unknown): Record<string, T> =>
    v && typeof v === "object" ? (v as Record<string, T>) : {};
  return {
    stock: p.stock,
    history: obj(p.history),
    posted: obj(p.posted),
    absent: obj(p.absent),
    // ⛔ NYA FÄLT MÅSTE IN PÅ TRE STÄLLEN SAMTIDIGT: här, i den seedade tidiga
    //    returen och i den slutliga returen ur deriveRestockPosts. Missas ett enda
    //    överlever kartan bara i minnet — gröna körningar, tyst död mekanism, exakt
    //    `pending`-regressionen ovan.
    price: obj(p.price),
    pricePosted: obj(p.pricePosted),
  };
}

/**
 * Hur länge vi minns statusen på en URL som lämnat feeden. Bortom det är frånvaron
 * inte längre ett besked om någonting — butiken har helt enkelt slutat sälja varan,
 * och kommer den tillbaka är den en nyhet. Tilltaget i underkant med flit: kartan
 * ligger i en cache-fil som skrivs varje varv.
 */
const ABSENT_MEMORY_HOURS = 48;

const IN_STOCK = "IN_STOCK";
const OUT_OF_STOCK = "OUT_OF_STOCK";
const PREORDER = "PREORDER";

export interface DeriveOptions {
  state: DiscordRestockState | null;
  groups: FullFeedGroup[];
  rotating: Set<string>;
  routes: RouteTable;
  /** Vakternas indata (setnamn för den positiva Pokémon-vakten). */
  filter: DiscordFilterContext;
  /** Katalogens set-taxonomi — kanalval för URL:er som saknar rutt. Valfri. */
  knownSets?: KnownSet[];
  now: Date;
  policy: FlapPolicy;
  /** Timmar mellan två inlägg om samma butik+URL. Speglar RESTOCK_ALERT_COOLDOWN_HOURS. */
  cooldownHours: number;
  baseUrl: string;
  /**
   * Gränserna för prissänkningslarm (`pricePolicy()`). `null`/utelämnad = funktionen
   * avstängd, och då TÖMS prisminnet (`price`/`pricePosted`) i nästa state — en
   * avstängd funktion ska inte bära ~⅓ av state-filens storlek. Priset för det är att
   * ett nytt påslag behöver ETT varv på sig att bygga baslinjen igen; utan baslinje
   * finns ingen sänkning, så det första varvet är tyst med flit.
   */
  priceDrops?: PriceDropPolicy | null;
}

export interface DeriveResult {
  posts: RestockPost[];
  nextState: DiscordRestockState;
  /** Diagnostik för körningsloggen — inte för användaren. */
  stats: {
    changes: number;
    seeded: boolean;
    /** Källor som seedades TYST denna körning (nya i state-filen). */
    seededSources: string[];
    skippedFiltered: number;
    skippedFlap: number;
    skippedCooldown: number;
    /** Frånvaro kortare än blinkfönstret — varan lämnade aldrig hyllan. */
    skippedBlip: number;
    /**
     * Annonser en vakt ville fälla men som har en RUTT, dvs katalogen har redan
     * avgjort att de är riktiga varor. Ett stigande tal betyder att en vakt är för
     * bred för butikernas formuleringar — mät den innan den ändras.
     */
    rescuedByRoute: number;
    /** Hur många som föll på VILKEN vakt. Räknare utan namn går inte att felsöka. */
    filteredReasons: Partial<Record<DiscordRejectReason, number>>;
    /**
     * Ett urval av de fällda annonserna ("källa\turl — orsak"). Utredningen
     * 2026-08-13 (Samlarhobbys Paradox Rift-booster) krävde korsreferens mot
     * DB-lanens loggar bara för att ta reda på VILKEN URL som hoppats. Produktdata,
     * inga hemligheter — säkert i publika loggar.
     */
    filteredSamples: string[];
    /** Prissänkningar som blev inlägg. */
    priceDrops: number;
    /** Hur många prisfall som föll på VILKEN gräns. Räknare utan namn går inte att felsöka. */
    priceRejected: Partial<Record<PriceRejectReason | "burst" | "filtered", number>>;
    /**
     * Ett urval av prisfallen — BÅDE de postade och de avvisade ("källa → url:
     * 559 kr → 450 kr (−19,5 %) [orsak]"). Gränserna är satta i underkant utan att vara
     * mätta på vår egen trafik; utan namngivna exempel går de inte att justera på annat
     * än magkänsla. Produktdata, inga hemligheter — säkert i publika loggar.
     */
    priceSamples: string[];
    /**
     * Butiker vars prisfall fälldes av burst-gränsen, med antalet.
     *
     * ⛔ EGET FÄLT, INTE EN RAD I `priceSamples`. Mätt i torrkörning 2026-08-21: en
     * butik med 106 samtidiga fall fyllde urvalslistans tio platser innan
     * burst-raden hann skrivas — dvs den ENDA rad som pekar ut ett systemfel
     * (valuta/marknad) trängdes undan av exemplen på symptomet. Anroparen loggar det
     * här fältet villkorslöst.
     */
    priceBurstStores: { store: string; count: number }[];
  };
}

/**
 * ⛔ FÖRSTA KÖRNINGEN SEEDAR OCH POSTAR INGENTING. Utan `prev` ser varje vara i lager
 * ut som en nyhet — det hade blivit tusentals inlägg första gången, och igen varje gång
 * Actions-cachen faller ur (GitHub evictar efter 7 dygn utan träff, och LRU vid 10 GB).
 * Samma invariant som DB-vägens "ingen tidigare state → seeda".
 */
export function deriveRestockPosts(opts: DeriveOptions): DeriveResult {
  const {
    state,
    groups,
    rotating,
    routes,
    filter,
    knownSets,
    now,
    policy,
    cooldownHours,
    baseUrl,
    priceDrops,
  } = opts;
  const prev = state ?? emptyState();
  const seeded = state == null || Object.keys(prev.stock).length === 0;

  const nextStock = mergeStateMap(prev.stock, groups);
  const stats: DeriveResult["stats"] = {
    changes: 0,
    seeded,
    seededSources: [],
    skippedFiltered: 0,
    skippedFlap: 0,
    skippedCooldown: 0,
    skippedBlip: 0,
    rescuedByRoute: 0,
    filteredReasons: {},
    filteredSamples: [],
    priceDrops: 0,
    priceRejected: {},
    priceSamples: [],
    priceBurstStores: [],
  };

  // ---- FRÅNVAROMINNET (se filhuvudet) ----
  // Uppdateras ALLTID, också under seedningen: annars vore minnet tomt exakt när
  // det behövs som mest (första körningen efter en cache-förlust).
  const absentCutoff = now.getTime() - ABSENT_MEMORY_HOURS * 3600_000;
  const absent: Record<string, AbsentEntry> = {};
  for (const [k, e] of Object.entries(prev.absent ?? {})) {
    if (e && typeof e.t === "number" && e.t >= absentCutoff) absent[k] = e;
  }
  for (const g of groups) {
    if (g.items.length === 0) continue; // tom feed = ingen information, rör inget
    const prefix = `${g.sourceName}\t`;
    for (const [k, s] of Object.entries(prev.stock)) {
      // Fanns i förra lagerläget, levererades av den här källan, men syns inte nu.
      if (k.startsWith(prefix) && nextStock[k] === undefined) absent[k] = { s, t: now.getTime() };
    }
  }
  for (const k of Object.keys(nextStock)) delete absent[k];

  // ---- PRISMINNET ----
  // Uppdateras ALLTID när funktionen är på, också under seedningen — av samma skäl
  // som frånvarominnet: annars vore baslinjen tom exakt när den behövs som mest.
  const nextPrice = priceDrops ? mergePriceMap(prev.price, groups, absent) : {};
  const pricePosted = priceDrops ? prunePricePosted(prev.pricePosted, now) : {};

  if (seeded) {
    return {
      posts: [],
      nextState: {
        stock: nextStock,
        history: prev.history,
        posted: prev.posted,
        absent,
        price: nextPrice,
        pricePosted,
      },
      stats,
    };
  }

  // ⛔ SEEDNINGEN GÄLLER PER KÄLLA, INTE BARA FÖR HELA FILEN (mätt 2026-08-12: när
  // MaxGaming lades till i butikslistan såg diffen alla dess ~41 lagerförda varor som
  // "ny-i-lager" och POSTADE 11 av dem som restocks — de var bara befintligt
  // sortiment). En källa utan en enda nyckel i förra lagerläget är NY: allt den
  // levererar seedas tyst den här körningen; nästa körning diffas den som vanligt.
  const prevSources = new Set(
    Object.keys(prev.stock).map((k) => k.slice(0, k.indexOf("\t")))
  );
  const freshSources = new Set<string>();
  for (const g of groups) {
    if (g.items.length > 0 && !prevSources.has(g.sourceName)) {
      freshSources.add(g.sourceName);
      stats.seededSources.push(g.sourceName);
    }
  }

  // ⛔ TOM `rotating` MED FLIT. Rotationsregeln tillämpas HÄR i stället, för den
  // behöver frånvarominnet: `actionableChanges` kan bara se att en URL saknades i
  // förra lagerläget, inte att vi en gång SÅG den slutsåld. Se filhuvudet.
  const minAwayMs = policy.minAwayMinutes * 60_000;
  const sourceOf = (key: string) => key.slice(0, key.indexOf("\t"));

  /**
   * Är "URL:en fanns inte förra gången" ett BESKED, eller bara brus?
   *
   * ⛔ MÅSTE AVGÖRAS FÖRE HISTORIKEN, inte i utskicksloopen. Historiken driver
   * flapp-dämpningen, och en roterande butik levererar en NY delmängd varje hämtning
   * — skrivs rotationen som övergångar passerar varje URL sex-övergångarsgränsen inom
   * ett dygn och får då 24 h cooldown, dvs rotationen TYSTAR de äkta påfyllningarna.
   * Samma sak för en källa som seedas tyst: hela dess sortiment hade bokförts som
   * övergångar den körningen. Den gamla koden slapp det genom att låta
   * `actionableChanges` filtrera bort dem; nu när rotationsregeln behöver
   * frånvarominnet måste filtret ligga här i stället — men det måste ligga LIKA
   * TIDIGT. (Upptäckt i ett 100-sekunders röktest: 94 fantomposter i historiken efter
   * tre varv över tre butiker.)
   */
  type AbsentVerdict = "post" | "silent" | "blip";
  const judgeAbsent = (key: string, to: string): AbsentVerdict => {
    const source = sourceOf(key);
    // En KÄLLA vi aldrig fört bok över seedas tyst — hela dess sortiment ser nytt ut.
    if (freshSources.has(source)) return "silent";
    const remembered = absentMemory(prev.absent, key);
    if (rotating.has(source)) {
      // Rotation kan inte fabricera ett OBSERVERAT slutsålt. Allt annat (en URL som
      // bara dyker upp) är brus hos en roterande butik — samma regel som gör att de
      // inte ger "ny produkt"-larm i övrigt.
      return remembered?.s === OUT_OF_STOCK ? "post" : "silent";
    }
    if (remembered && remembered.s === to && now.getTime() - remembered.t < minAwayMs) {
      // Den hade SAMMA status, försvann ur feeden och är tillbaka inom blinkfönstret:
      // en feed-hicka, inte en nyhet. Samma tal som DB-vägens blinkregel.
      // ⛔ VILLKORET ÄR `remembered.s === to`, INTE `=== IN_STOCK`. Fram till att
      //    förhandsbokningar fick sin egen gren gällde regeln bara i lager, för det var
      //    den enda status som kunde nå hit. En PREORDER som blinkar ur feeden ett varv
      //    ska tiga av exakt samma skäl som en i-lager-vara gör det.
      return "blip";
    }
    if (to === PREORDER && remembered && remembered.s !== OUT_OF_STOCK) {
      // ⛔ EN FÖRHANDSBOKNING ÄR BARA EN NYHET OM VI INTE REDAN KUNDE KÖPA VARAN.
      //    Minns vi den i lager är PREORDER en FÖRSÄMRING (samma dom som
      //    `isPreorderOpen`, som bara accepterar OUT_OF_STOCK → PREORDER); minns vi
      //    den redan som förhandsbokning är det ingen förändring alls, bara en URL
      //    som varit borta längre än blinkfönstret.
      return "silent";
    }
    return "post";
  };

  const absentVerdicts = new Map<string, AbsentVerdict>();
  // ⛔ `newUrlPreorder` PÅ HÄR, AV I VÄCKNINGSGRINDEN. En ny Webhallen-förhandsbokning
  //    dyker upp som en URL vi aldrig sett med PREORDER som FÖRSTA status, så
  //    `preorder-open` (OUT_OF_STOCK → PREORDER) kan per konstruktion aldrig fånga den.
  //    Läs kostnadsresonemanget vid ChangeOptions i feed-state-diff.ts.
  const changes = actionableChanges(prev.stock, groups, new Set(), {
    newUrlPreorder: true,
  }).filter((c) => {
    if (c.from !== "ABSENT") return true;
    const v = judgeAbsent(c.key, c.to);
    absentVerdicts.set(c.key, v);
    if (v === "blip") stats.skippedBlip++;
    return v !== "silent";
  });
  stats.changes = changes.length;

  // Alla övergångar (även slutförsäljningar) in i historiken — flapp-fönstret räknar
  // ANTALET övergångar, precis som RestockEvent-tabellen det speglar.
  const history: Record<string, HistoryEntry[]> = {};
  const windowStart = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  for (const [key, entries] of Object.entries(prev.history)) {
    const kept = entries.filter((e) => e.t >= windowStart);
    if (kept.length) history[key] = kept;
  }
  for (const c of changes) {
    // En feed-hicka är ingen övergång — den ska varken larma eller räknas mot
    // flapp-tröskeln. (Den ligger kvar i `changes` bara för att lagerläget ska skrivas.)
    if (absentVerdicts.get(c.key) === "blip") continue;
    // "ABSENT" finns inte som StockStatus. En URL som dyker upp i lager motsvarar
    // DB-vägens nya offer, som skrivs med oldStatus OUT_OF_STOCK (runner.ts) — samma
    // skrivning här, annars dömer blink-regeln på ett tillstånd som inte finns.
    const oldStatus = c.from === "ABSENT" ? OUT_OF_STOCK : c.from;
    history[c.key] = [{ o: oldStatus, t: now.getTime() }, ...(history[c.key] ?? [])];
  }

  // Uppslag från nyckel → feed-annonsen, för titel/pris/bild.
  const itemByKey = new Map<string, { item: FeedItemFull; sourceName: string }>();
  for (const g of groups) {
    for (const it of g.items) itemByKey.set(`${g.sourceName}\t${it.url}`, { item: it, sourceName: g.sourceName });
  }

  // ⛔ LÄSES här, SKRIVS aldrig här. Cooldown-stämpeln sätts av `markPosted` EFTER att
  // Discord kvitterat — stämplar man vid beslutet tystas produkten i två timmar när
  // utskicket misslyckades, dvs precis när larmet inte kom fram.
  const posted = prev.posted;
  const posts: RestockPost[] = [];
  const cooldownMs = cooldownHours * 3600_000;

  const site = baseUrl.replace(/\/$/, "");
  // Discord hämtar miniatyren själv och kan bara följa absoluta URL:er — en handfull
  // katalogbilder är relativa (/api/cm-image/…) och pekas då mot sajten.
  const absoluteImage = (url: string | null | undefined): string | null =>
    !url ? null : url.startsWith("/") ? `${site}${url}` : url;

  for (const c of changes) {
    // Bara påfyllningar och öppnade förhandsbokningar. En slutförsäljning är ingen
    // nyhet för den som vill köpa. (`reason` speglar isRestock/isPreorderOpen, plus
    // `preorder-new` som bara den här lanen ber om — se ChangeOptions.)
    const isPreorderOpen = c.reason === "preorder-open" || c.reason === "preorder-new";
    if (c.to !== IN_STOCK && !isPreorderOpen) continue;
    // Feed-hicka: domen är redan fälld ovan (och räknad), lagerläget skrivs ändå.
    if (absentVerdicts.get(c.key) === "blip") continue;

    const found = itemByKey.get(c.key);
    if (!found) continue;

    // ---- VAKTKEDJAN: är det här en Pokémon-vara vi vill posta? ----
    const route = routes[found.item.url];
    const verdict = classifyDiscordListing(
      { title: found.item.title, url: found.item.url, category: found.item.category },
      filter
    );
    if (!verdict.ok) {
      // ⛔ EN KÄND RUTT ÖVERTRUMFAR VAKTERNA — ANNARS BLIR OMBYGGET EN REGRESSION.
      // Vakterna finns för att döma annonser vi INTE känner igen. Har URL:en en rutt
      // har katalogen redan avgjort att det är en riktig sealed Pokémon-produkt, och
      // fram till 2026-08-16 postades varje sådan URL utan någon vakt alls. Att låta
      // en ordlista rösta ner den hade tagit BORT larm samtidigt som ändringen skulle
      // lägga till dem. MÄTT samma dag: "Starter Deck 100 Japansk" och "Phantsmal
      // Flames Booster Pack" (butikens stavfel) faller båda på "no-pokemon-signal"
      // trots att de är riktiga varor — en ordlista kan aldrig täcka butikernas
      // formuleringar, men katalogen har redan sett dem.
      //
      // ⛔ TVÅ UNDANTAG SOM ALDRIG ÖVERTRUMFAS, för de är POLICY och inte gissningar:
      //    · `language` — kanalerna är EN + JP, punkt (ägarkrav). En felaktigt länkad
      //      kinesisk annons ska tiga även om någon rutt pekar på den.
      //    · `denylist` — ägarens "Ta bort" måste gälla i kanalerna också, annars är
      //      raderingen bara halv.
      const rescued = route && verdict.reason !== "language" && verdict.reason !== "denylist";
      if (!rescued) {
        stats.skippedFiltered++;
        const r = verdict.reason ?? ("unknown-form" as DiscordRejectReason);
        stats.filteredReasons[r] = (stats.filteredReasons[r] ?? 0) + 1;
        if (stats.filteredSamples.length < 10) {
          stats.filteredSamples.push(`${c.key.replace("\t", " → ")} — ${r}`);
        }
        continue;
      }
      stats.rescuedByRoute++;
    }

    const flap = evaluateStockFlap(
      (history[c.key] ?? []).map((e) => ({ oldStatus: e.o as StockStatus, detectedAt: new Date(e.t) })),
      (isPreorderOpen ? PREORDER : IN_STOCK) as StockStatus,
      now,
      policy
    );
    if (flap.blip) {
      stats.skippedFlap++;
      continue;
    }

    const effectiveCooldownMs = Math.max(cooldownMs, flap.cooldownHours * 3600_000);
    const last = posted[c.key];
    if (last != null && now.getTime() - last < effectiveCooldownMs) {
      stats.skippedCooldown++;
      continue;
    }

    posts.push({
      ...buildPostBase({
        key: c.key,
        item: found.item,
        sourceName: found.sourceName,
        route,
        verdict,
        knownSets,
        site,
        absoluteImage,
      }),
      preorder: isPreorderOpen,
    });
  }

  // ---- PRISSÄNKNINGAR ----
  // ⛔ EFTER lagerdomen, med flit: en URL som redan får ett påfyllnings- eller
  //    förhandsbokningsinlägg i samma varv ska inte få ett prisinlägg ovanpå. Det
  //    priset står redan i det första inlägget.
  if (priceDrops) {
    collectPriceDrops({
      groups,
      prev,
      nextPrice,
      pricePosted,
      alreadyPosted: new Set(posts.map((p) => p.key)),
      freshSources,
      routes,
      filter,
      knownSets,
      now,
      policy: priceDrops,
      site,
      absoluteImage,
      posts,
      stats,
    });
  }

  return {
    posts,
    nextState: {
      stock: nextStock,
      history,
      posted: { ...posted },
      absent,
      price: nextPrice,
      pricePosted,
    },
    stats,
  };
}

function absentMemory(
  map: Record<string, AbsentEntry> | undefined,
  key: string
): AbsentEntry | undefined {
  const e = map?.[key];
  return e && typeof e.t === "number" && typeof e.s === "string" ? e : undefined;
}

/**
 * De fält ALLA inlägg delar, oavsett om nyheten är lager, förhandsbokning eller pris.
 *
 * ⛔ EN ENDA DEFINITION, ALDRIG EN KOPIA. Titelvalet, bildreserven, set-/seriegissningen
 * och de två länkarna tillbaka till oss är fyra separata beslut som var och en har
 * kostat en felrapport att få rätt. Byggdes prisinlägget av en egen kopia hade den
 * driftat isär tyst — exakt så flapp-dämpningen en gång driftade mellan lanarna.
 */
function buildPostBase(args: {
  key: string;
  item: FeedItemFull;
  sourceName: string;
  route: RouteEntry | undefined;
  verdict: { title: string; language: "EN" | "JP" };
  knownSets: KnownSet[] | undefined;
  site: string;
  absoluteImage: (url: string | null | undefined) => string | null;
}): Omit<RestockPost, "preorder" | "previousPriceOre"> {
  const { key, item, sourceName, route, verdict, knownSets, site, absoluteImage } = args;
  // Språket: katalogen vet bäst när den känner URL:en, annars annonsen själv.
  const language = route?.language ?? verdict.language;
  // Set/serie: rutten först, annars ett känt setnamn ur butikens egen titel — utan
  // det hade varje URL utanför katalogen hamnat i catch-all och seriekanalerna
  // blivit tomma skal precis när lanen började se mer.
  const guessed =
    route?.setName || !knownSets?.length ? null : matchKnownSet(item.title, knownSets, language);

  return {
    key,
    // Katalogens titel framför butikens fras — butikstitlar bär "MAX 1 per kund",
    // "(kopia)" och liknande skräp. Utan rutt är `verdict.title` samma fras redan
    // tvättad av cleanListingTitle.
    title: route?.title || verdict.title || item.title,
    storeName: sourceName,
    storeUrl: item.url,
    priceOre: item.price,
    // Butikens egen bild först (den visar exakt varan), katalogbilden som reserv —
    // de flesta feedar bär ingen bild alls och embedden stod bildlös.
    imageUrl: item.imageUrl ?? absoluteImage(route?.imageUrl),
    setName: route?.setName ?? guessed?.name ?? null,
    series: route?.series ?? guessed?.series ?? null,
    language,
    productUrl: route ? `${site}/produkter/${route.slug}` : null,
    // ⛔ RESERVLÄNK NÄR PRODUKTSIDAN INTE FINNS (2026-08-16). En URL utan rutt har
    // ingen produktsida att peka på — inlägget stod därför helt utan väg tillbaka
    // till oss, vilket ägaren såg direkt i kanalen. Setet vet vi ändå: det är så
    // inlägget hamnade i rätt kanal.
    //
    // ⛔ SETSIDAN (`/sets/<id>`), INTE KATALOGFILTRET (`/produkter?set=<id>`).
    //    Skälet är KOSTNAD, inte innehåll: `/produkter` är `force-dynamic` med flit
    //    (searchParams), så varje klick från en PUBLIK Discord-kanal hade blivit en
    //    serverrendering med DB-frågor — dvs en väckning av en Neon-compute som
    //    debiteras per vaken tid, minst 300 s per väckning. En länk vi postar
    //    dussintals gånger per dygn i en öppen kanal är en trafikkälla vi inte
    //    styr. `/sets/[id]` är ISR-cachad (`revalidate = 3600` + `generateStaticParams`)
    //    och serveras ur cachen. Samma skäl som håller startsidan och /marknad ISR.
    //    Setsidan saknar dessutom katalogfiltrets pris- och `hiddenAt`-krav, så den
    //    kan inte stå tom för ett FÄRSKT set — vilket är precis det läge där rutten
    //    oftast saknas.
    // ⛔ FRITEXTSÖK (`?q=`) DUGER INTE HELLER: filtret kräver att ALLA ord i frågan
    //    finns i produktens normalizedTitle, och butikstiteln bär prefix ("Pokémon
    //    Mega Evolution: …"), språktaggar ("(ENG)") och ibland stavfel
    //    ("Phantsmal") — en sådan sökning hade landat på NOLL träffar. Den URL-rymden
    //    är dessutom blockerad i robots.txt, dvs medvetet inte delbar.
    setUrl: !route && guessed?.id ? `${site}/sets/${encodeURIComponent(guessed.id)}` : null,
  };
}

/**
 * Nästa varvs prisminne. Speglar `mergeStateMap` fält för fält, med två skillnader
 * som båda är avsiktliga:
 *
 *  1. **BARA ANNONSER I LAGER SKRIVS.** En slutsåld annons kan aldrig ge ett
 *     prisinlägg, och kommer den tillbaka är PÅFYLLNINGEN nyheten. Att ändå bära
 *     dess pris hade femdubblat kartan (5 295 i lager av ~25 000 URL:er) och därmed
 *     den synkrona serialiseringen var 10:e sekund.
 *  2. **URL:er I FRÅNVAROMINNET BEHÅLLER SITT PRIS.** Utan undantaget hade de två
 *     mest aktiva roterande butikerna (Shinycards, Swepoke) aldrig kunnat ge ett
 *     prisinlägg alls: deras URL:er faller ur feeden hela tiden, och en raderad
 *     baslinje betyder "ingen sänkning" varje gång de kommer tillbaka.
 *
 * En källa som svarade TOMT lämnas orörd — tom feed är ingen information, samma
 * invariant som lagerläget vilar på.
 */
export function mergePriceMap(
  prev: Record<string, number> | undefined,
  groups: FullFeedGroup[],
  absent: Record<string, AbsentEntry>
): Record<string, number> {
  const next: Record<string, number> = { ...(prev ?? {}) };
  for (const g of groups) {
    if (g.items.length === 0) continue;
    const prefix = `${g.sourceName}\t`;
    for (const k of Object.keys(next)) {
      if (k.startsWith(prefix) && !absent[k]) delete next[k];
    }
    for (const it of g.items) {
      if (it.stockStatus !== IN_STOCK) continue;
      // ⛔ 0 KR ÄR INGET PRIS. En nolla som baslinje hade gjort varje senare pris till
      //    en "höjning" (tyst), och som nytt pris hade den postat "0 kr" som ett fynd.
      if (typeof it.price !== "number" || !(it.price > 0)) continue;
      next[`${g.sourceName}\t${it.url}`] = it.price;
    }
  }
  return next;
}

/** Hur länge vi minns att vi postat om en prisnivå. Egen klocka — kartan måste gallra. */
const PRICE_POSTED_MEMORY_HOURS = 72;

function prunePricePosted(
  prev: Record<string, PricePostMemory> | undefined,
  now: Date
): Record<string, PricePostMemory> {
  const cutoff = now.getTime() - PRICE_POSTED_MEMORY_HOURS * 3600_000;
  const out: Record<string, PricePostMemory> = {};
  for (const [k, e] of Object.entries(prev ?? {})) {
    if (e && typeof e.t === "number" && typeof e.p === "number" && e.t >= cutoff) out[k] = e;
  }
  return out;
}

/**
 * Prissänkningarna i den här hämtningen → inlägg.
 *
 * ⛔ DEN NUMERISKA DOMEN KOMMER FÖRE VAKTKEDJAN, OCH ORDNINGEN ÄR EN CPU-REGEL.
 * Loopen ser HELA butikens feed varje varv, dygnet runt, i ett jobb som kör 42 sådana
 * loopar parallellt. `classifyDiscordListing` är ett dussin regexar per annons — körd
 * på allt hade den bränt CPU i evighet för att avvisa samma sleeves om och om igen.
 * Två heltalsjämförelser släpper igenom en handfull kandidater per varv; först DE
 * betalar vaktkedjan.
 */
function collectPriceDrops(args: {
  groups: FullFeedGroup[];
  prev: DiscordRestockState;
  nextPrice: Record<string, number>;
  pricePosted: Record<string, PricePostMemory>;
  alreadyPosted: ReadonlySet<string>;
  freshSources: ReadonlySet<string>;
  routes: RouteTable;
  filter: DiscordFilterContext;
  knownSets: KnownSet[] | undefined;
  now: Date;
  policy: PriceDropPolicy;
  site: string;
  absoluteImage: (url: string | null | undefined) => string | null;
  posts: RestockPost[];
  stats: DeriveResult["stats"];
}): void {
  const {
    groups,
    prev,
    alreadyPosted,
    freshSources,
    routes,
    filter,
    knownSets,
    now,
    policy,
    site,
    absoluteImage,
    posts,
    stats,
  } = args;

  const note = (reason: PriceRejectReason | "burst" | "filtered") => {
    stats.priceRejected[reason] = (stats.priceRejected[reason] ?? 0) + 1;
  };
  const sample = (line: string) => {
    if (stats.priceSamples.length < 10) stats.priceSamples.push(line);
  };
  const kr = (ore: number) => `${(ore / 100).toFixed(0)} kr`;

  for (const g of groups) {
    if (g.items.length === 0) continue;
    // En källa vi aldrig fört bok över seedas tyst — precis som lagerläget. Utan
    // raden hade en nyinlagd butik postat varje pris som en "sänkning" den dagen
    // dess första hämtning råkade ge ett lägre tal än den föregående.
    if (freshSources.has(g.sourceName)) continue;

    const candidates: RestockPost[] = [];
    for (const item of g.items) {
      if (item.stockStatus !== IN_STOCK) continue;
      const key = `${g.sourceName}\t${item.url}`;
      // Lagernyheten går först — priset står redan i det inlägget.
      if (alreadyPosted.has(key)) continue;

      const verdictPrice = judgePriceDrop(
        prev.price?.[key],
        item.price,
        args.pricePosted[key],
        now,
        policy
      );
      if (!verdictPrice.post) {
        // "no-baseline"/"not-cheaper"/"no-price" är NORMALTILLSTÅNDET för tiotusentals
        // annonser varje varv — att räkna dem hade gjort loggen oläsbar och sagt
        // ingenting. Bara de fall där ett verkligt fall FÄLLDES är intressanta.
        if (
          verdictPrice.reason === "too-small" ||
          verdictPrice.reason === "implausible" ||
          verdictPrice.reason === "cooldown"
        ) {
          note(verdictPrice.reason);
          if (verdictPrice.reason !== "too-small") {
            sample(
              `${g.sourceName} → ${item.url}: ${kr(prev.price![key])} → ${kr(item.price!)} ` +
                `[${verdictPrice.reason}]`
            );
          }
        }
        continue;
      }

      // ---- SAMMA VAKTKEDJA SOM PÅFYLLNINGARNA, SAMMA RÄDDNINGSREGEL ----
      const route = routes[item.url];
      const verdict = classifyDiscordListing(
        { title: item.title, url: item.url, category: item.category },
        filter
      );
      if (!verdict.ok) {
        const rescued = route && verdict.reason !== "language" && verdict.reason !== "denylist";
        if (!rescued) {
          note("filtered");
          continue;
        }
        stats.rescuedByRoute++;
      }

      candidates.push({
        ...buildPostBase({
          key,
          item,
          sourceName: g.sourceName,
          route,
          verdict,
          knownSets,
          site,
          absoluteImage,
        }),
        preorder: false,
        previousPriceOre: prev.price![key],
      });
      sample(
        `${g.sourceName} → ${item.url}: ${kr(prev.price![key])} → ${kr(item.price!)} ` +
          `(−${verdictPrice.percent.toFixed(1)} %)`
      );
    }

    // ---- BURST-GRÄNSEN ----
    // ⛔ ALLA ELLER INGA, OCH DET ÄR MED FLIT. Faller ett tiotal priser hos SAMMA butik
    //    i SAMMA hämtning är den troligaste förklaringen inte tio reor utan att vi
    //    läser fel tal: Shopifys svenska marknad hänger på en cookie, och utan den
    //    serveras hela butiken EX MOMS (~20 % "sänkning" på allt samtidigt, uppmätt).
    //    Att posta de fem största hade gjort en tyst valutamiss till fem fejkade fynd
    //    i en öppen kanal. Vi tiger och SKRIKER i loggen i stället — kandidaterna
    //    namnges i `priceSamples`, och prisminnet skrivs ändå så samma tal inte
    //    upprepas varje varv.
    if (candidates.length > policy.maxPerStore) {
      stats.priceRejected.burst = (stats.priceRejected.burst ?? 0) + candidates.length;
      stats.priceBurstStores.push({ store: g.sourceName, count: candidates.length });
      continue;
    }
    for (const p of candidates) posts.push(p);
    stats.priceDrops += candidates.length;
  }
}

/**
 * Stämplar cooldown för de larm Discord FAKTISKT tog emot. Anropas med
 * `postRestocks().postedKeys`, aldrig med listan som skulle postas.
 *
 * Rensar samtidigt stämplar äldre än dygnsfönstret — utan det växer kartan i
 * cache-filen i evighet med URL:er butikerna slutat sälja.
 */
export function markPosted(
  state: DiscordRestockState,
  keys: string[],
  now: Date,
  /**
   * De nycklar vars inlägg var en PRISSÄNKNING → priset som postades (öre).
   *
   * ⛔ DE STÄMPLAS I `pricePosted`, ALDRIG I `posted`. Kartorna delar nyckelrymd men
   *    inte betydelse: `posted` är påfyllningarnas cooldown, och hamnade ett prisinlägg
   *    där hade det tystat en RIKTIG påfyllning på samma URL i två timmar — det
   *    värdefullaste larmet offrat för det billigaste.
   */
  pricedKeys?: Record<string, number>
): DiscordRestockState {
  const cutoff = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  const posted: Record<string, number> = {};
  for (const [k, t] of Object.entries(state.posted)) if (t >= cutoff) posted[k] = t;
  const pricePosted = prunePricePosted(state.pricePosted, now);
  for (const k of keys) {
    const p = pricedKeys?.[k];
    if (p != null && p > 0) pricePosted[k] = { p, t: now.getTime() };
    else posted[k] = now.getTime();
  }
  return { ...state, posted, pricePosted };
}
