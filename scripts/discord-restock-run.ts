/**
 * DISCORD-SNABBFILEN — restock-larm till Discord, helt utan databas.
 *
 * ⛔ VARJE BUTIK GÅR I SIN EGEN TAKT (2026-08-16). Fram till nu var lanen ett SVEP:
 * alla butiker hämtades parallellt, och först när den LÅNGSAMMASTE svarat kördes
 * diffen och inläggen gick ut. Mätt i drift samma dag: svepet tog 36 s och sattes av
 * Shinycards (35,9 s) och Swepoke (35,0 s) — så en butik som svarade på 4 s fick ändå
 * 32 s ren väntan påklistrad på varje larm, dygnet runt, för att två ANDRA butiker är
 * långsamma. Ovanpå det låg ett tickintervall på 60 s. Nu har varje butik en egen
 * loop: hämta → diffa → posta, och sedan vänta ut SIN egen takt. Ingen butik väntar
 * längre på någon annan.
 *
 * ⛔ TAKTEN FALLER UT UR ETT ARTIGHETSTAK, DEN VÄLJS INTE (se
 * `pollIntervalMs` i src/lib/restock-poll-interval.ts).
 * Den gamla modellen delade in butikerna i "Shopify varje minut / egna servrar
 * varannan", som om alla feedar kostade lika mycket att hämta. De gör inte det: en
 * butik vars hela feed är två sidhämtningar och en vars feed är trettio
 * kollektionsanrop fick femton gångers skillnad i last utan att någon valt det. Vi
 * mäter i stället FÖRFRÅGNINGARNA per hämtning (räknare i http.ts) och sätter
 * intervallet så att ingen butik får mer än en förfrågan per X sekunder i snitt.
 * Följden: billiga feedar pollas oftare ÄN FÖRUT, dyra feedar mer sällan än förut,
 * och den sammanlagda lasten mot varje enskild butik är känd i stället för gissad.
 *
 * ⛔ RÖR ALDRIG NEON. Ingen kodväg här frågar databasen; källistan, ruttabellen,
 * setnamnen och ägarens denylist kommer från en fil som `export-restock-routes.ts`
 * skrivit i scrape-alls fönster, där Neon ändå var vaken. Saknas filen HOPPAR
 * körningen över — den frågar hellre ingen än väcker databasen, för Neon debiteras
 * per vaken tid och varje väckning köper minst 300 s. Det är hela skälet att lanen är
 * gratis; tas invarianten bort blir den inte det.
 *
 * ⛔ EGEN CACHE-NYCKEL. State-filen ligger i `.discord-restock-cache/`, INTE i
 * `.restock-cache/` som 10-min-lanen äger. Delade de katalog skulle lanarna läsa och
 * skriva varandras lagerläge — den ena hade missat restocks, den andra dubblerat dem,
 * och båda felen är tysta.
 *
 * ⛔ KATALOGEN GRINDAR INTE LÄNGRE (se src/lib/discord-restock-filter.ts). Domen om
 * vad som får postas tas på butiksannonsen med samma vakter som auto-importen; rutten
 * används bara för att göra inlägget snyggare. Det var den gamla ruttgrinden som gjorde
 * att mejl gick ut om påfyllningar Discord teg om.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SourceType } from "@prisma/client";
import { fetchSourceFeed, getAdapter, type FeedItem, type RestockSourceInfo } from "../src/scrapers/runner";
import { ShopifyAdapter } from "../src/scrapers/adapters/shopify-adapter";
import { requestCountSnapshot } from "../src/scrapers/http";
import { setDynamicDenylist } from "../src/scrapers/import-denylist";
import { discordRestockConfig, postRestocks, postTestMessages } from "../src/lib/discord-restock";
import { fetchShopifyPurchasable } from "../src/scrapers/stock-verify";
import {
  deriveRestockPosts,
  markPosted,
  parseDiscordRestockState,
  type DiscordRestockState,
  type RouteTable,
} from "../src/lib/restock-feed-events";
import {
  buildDiscordFilterContext,
  buildKnownSets,
  type DiscordFilterContext,
  type KnownSet,
} from "../src/lib/discord-restock-filter";
import { flapPolicy } from "../src/lib/stock-flap";
import { pollBudget, pollIntervalMs } from "../src/lib/restock-poll-interval";

const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
const stateFile = process.env.DISCORD_RESTOCK_STATE_FILE ?? ".discord-restock-cache/state.json";
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://foilio.se";
const cooldownHours = Number(process.env.RESTOCK_ALERT_COOLDOWN_HOURS ?? 2);

/**
 * Butikerna snabbfilen hämtar när `DISCORD_RESTOCK_STORES` inte är satt. Repo-
 * variabeln står på "all" sedan 2026-08-12 (ägarbeslut); listan här är en klippa, inte
 * en mjuklandning — försvinner variabeln tappar lanen 34 butiker UTAN att något felar.
 * Därför varnas det högljutt nedan.
 */
const DEFAULT_STORES = [
  "Dragon's Lair",
  "Shinycards",
  "Swepoke",
  "Speltrollet",
  "TCG Store",
  "Samlarhobby",
  "Alphaspel",
  "Webhallen",
];

interface RoutesFile {
  at?: number;
  sources?: RestockSourceInfo[];
  routes?: RouteTable;
  setNames?: string[];
  deniedUrls?: string[];
  sets?: { name: string; series: string | null; language: string | null }[];
}

function readRoutes(): RoutesFile | null {
  if (!existsSync(routesFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(routesFile, "utf8")) as RoutesFile;
    if (!Array.isArray(parsed.sources) || !parsed.sources.length) return null;
    if (!parsed.routes || typeof parsed.routes !== "object") return null;
    return parsed;
  } catch (e) {
    console.warn("[discord-restock] Kunde inte läsa ruttabellen:", e instanceof Error ? e.message : e);
    return null;
  }
}

function readState(): DiscordRestockState | null {
  if (!existsSync(stateFile)) return null;
  try {
    // Domen bor i lib (testbar utan filsystem) — se parseDiscordRestockState för
    // varför `pending` tappades tyst i två dygn när tolkningen låg här inne.
    return parseDiscordRestockState(JSON.parse(readFileSync(stateFile, "utf8")));
  } catch (e) {
    console.warn("[discord-restock] Kunde inte läsa state-filen:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Värdnamn utan `www.` — se requestCountSnapshot om varför formen måste luckras upp. */
function bareHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

/**
 * Hur många förfrågningar kostade hämtningen? Jämför två ögonblicksbilder och
 * summerar de värdar som hör till butiken.
 *
 * ⛔ BÅDE `baseUrl` OCH FEEDENS EGNA URL:er. Källans registrerade baseUrl är inte
 *    alltid den värd adaptern hämtar från (Dragon's Lair: `www.dragonslair.se` i
 *    registret, `dragonslair.se` i feeden). Matchas bara baseUrl blir svaret noll,
 *    intervallet fastnar på "omätt" och hela artighetstaket blir verkningslöst —
 *    tyst, och det såg ut att fungera i loggen.
 */
function requestsForSource(
  before: Record<string, number>,
  after: Record<string, number>,
  source: RestockSourceInfo,
  sampleUrl: string | undefined
): number {
  const wanted = new Set([bareHost(source.baseUrl)]);
  if (sampleUrl) wanted.add(bareHost(sampleUrl));
  let n = 0;
  for (const [host, count] of Object.entries(after)) {
    if (wanted.has(host.replace(/^www\./, ""))) n += count - (before[host] ?? 0);
  }
  return n;
}

/** Serveras butikens feed av ett CDN (Shopify) i stället för butikens egen server? */
function isCdnServed(s: RestockSourceInfo): boolean {
  // Webhallen är en storkedja med ett eget produkt-API byggt för volym — den hör
  // till samma nivå som CDN, inte till småbutikernas.
  if (s.name === "Webhallen") return true;
  if (s.type !== SourceType.SCRAPER) return false;
  try {
    return getAdapter(s.type, s.name) instanceof ShopifyAdapter;
  } catch {
    return false;
  }
}

/**
 * `--dry-run`: kör HELA kedjan (hämtning, diff, vaktkedja, kanalval) men postar
 * ingenting och kräver ingen bot-token. Finns för att den enda tidigare vägen att
 * prova en ändring var att deploya den och se om kanalerna fylldes med fel saker —
 * och felet i den här lanen är alltid tyst åt något håll. Skriver till en egen
 * state-fil via DISCORD_RESTOCK_STATE_FILE så driftens minne inte rörs.
 */
const DRY_RUN = process.argv.includes("--dry-run");

/** Startförskjutning mellan butikernas loopar — se kommentaren i storeLoop. */
const STAGGER_MS = Math.max(0, Number(process.env.DISCORD_RESTOCK_STAGGER_MS ?? 400));

async function main() {
  const config = DRY_RUN ? null : discordRestockConfig();
  if (!config && !DRY_RUN) {
    console.log(
      "[discord-restock] Avstängd (DISCORD_RESTOCK_ENABLED != true, eller saknad " +
        "DISCORD_BOT_TOKEN/DISCORD_RESTOCK_CHANNELS) — gör ingenting."
    );
    return;
  }

  // `--test`: posta ett märkt testinlägg i varje kanal och sluta. Rör varken feedar
  // eller state — enda sättet att bevisa att boten FÅR skriva innan en riktig
  // påfyllning inträffar (ett 403 syns annars bara i en logg ingen läser).
  if (config && process.argv.includes("--test")) {
    const { ok, failed } = await postTestMessages(config);
    for (const line of ok) console.log(`[discord-restock][test] OK   ${line}`);
    for (const line of failed) console.error(`[discord-restock][test] FEL  ${line}`);
    console.log(`[discord-restock][test] ${ok.length} kanaler OK, ${failed.length} misslyckades.`);
    if (failed.length) process.exitCode = 1;
    return;
  }

  const routesData = readRoutes();
  if (!routesData) {
    // Medvetet INGEN DB-reserv här. Se filhuvudet: att hämta källistan ur Neon hade
    // väckt computen var 30:e sekund, vilket är precis det den här lanen finns för
    // att undvika. Filen skrivs av scrape-all inom ett dygn.
    console.warn(
      `[discord-restock] Ingen ruttabell (${routesFile}) — hoppar över. ` +
        "Den skrivs av export-restock-routes.ts i scrape-all; första körningen efter " +
        "att den lagts till fyller cachen."
    );
    return;
  }

  const routes = routesData.routes!;
  // ⛔ ÄGARENS "TA BORT" MÅSTE GÄLLA HÄR OCKSÅ. Utan raden postar lanen glatt en URL
  //    som nyss nekats på produktsidan — raderingen vore bara halv.
  setDynamicDenylist(routesData.deniedUrls ?? []);
  const filter: DiscordFilterContext = buildDiscordFilterContext(routesData);
  const knownSets: KnownSet[] = buildKnownSets(routesData);

  const ageH = routesData.at ? (Date.now() - routesData.at) / 3600_000 : null;
  const storesEnv = process.env.DISCORD_RESTOCK_STORES?.trim();
  const onlySources =
    storesEnv === "all"
      ? null
      : (storesEnv ? storesEnv.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_STORES);

  const loopSeconds = Math.max(0, Number(process.env.DISCORD_RESTOCK_LOOP_SECONDS ?? 0));

  const selected = routesData.sources!.filter((s) => !onlySources || onlySources.includes(s.name));

  // ⛔ DEFAULTEN ÄR EN KLIPPA, INTE EN MJUKLANDNING. Repo-variabeln står på "all";
  // försvinner den faller lanen tillbaka på de åtta i DEFAULT_STORES och tappar
  // resten UTAN att något felar — körningen blir grön och larmen bara uteblir. Samma
  // tystnad som när boten förlorade Send Messages 2026-08-12.
  if (!storesEnv) {
    console.warn(
      `[discord-restock] ⚠️ DISCORD_RESTOCK_STORES ÄR OSATT — faller tillbaka på ` +
        `kod-defaulten (${DEFAULT_STORES.length} butiker) medan ruttabellen bär ` +
        `${routesData.sources!.length}. Sätt variabeln till "all" om det inte är avsiktligt.`
    );
  }

  console.log(
    `[discord-restock] Ruttabell: ${Object.keys(routes).length} URL:er` +
      (ageH != null ? `, ${ageH.toFixed(1)} h gammal` : "") +
      `, ${filter.setNames.size} setnamn, ${knownSets.length} set för kanalval, ` +
      `${(routesData.deniedUrls ?? []).length} nekade URL:er. ` +
      `${selected.length} butiker, egen takt per butik` +
      (loopSeconds ? `, loopbudget ${loopSeconds}s.` : ".")
  );

  const rotating = new Set(routesData.sources!.filter((s) => s.rotatingFeed).map((s) => s.name));
  // Butiker vars produktsidor köpbarhetskollen kan läsa (se utskicksgrinden nedan).
  const shopifyStores = new Set(
    selected
      .filter((s) => {
        if (s.type !== SourceType.SCRAPER) return false;
        try {
          return getAdapter(s.type, s.name) instanceof ShopifyAdapter;
        } catch {
          return false;
        }
      })
      .map((s) => s.name)
  );

  // ---- DELAT TILLSTÅND ----
  // ⛔ MUTERAS BARA SYNKRONT. Butikernas loopar kör samtidigt, men JS är entrådigt:
  //    ett synkront block kan inte avbrytas. `deriveRestockPosts` och `markPosted` är
  //    båda rena och synkrona, så "läs state → räkna → skriv state" är atomärt så
  //    länge inget `await` ligger emellan. Lägg ALDRIG in ett await där.
  let state: DiscordRestockState | null = readState();
  let totalPosted = 0;
  let totalFailures = 0;
  let stateDirty = false;
  /** Butiker som redan rapporterat tom feed i det här jobbet — se runStore. */
  const emptyFeedLogged = new Set<string>();

  const writeState = () => {
    if (!state || !stateDirty) return;
    stateDirty = false;
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state));
    } catch (e) {
      console.warn("[discord-restock] Kunde inte skriva state-filen:", e instanceof Error ? e.message : e);
    }
  };
  // Skrivs på timer i stället för efter varje butiksvarv: kartan rymmer alla ~25 000
  // feed-URL:er, och 42 butikers loopar hade annars serialiserat om samma JSON flera
  // gånger i sekunden för ingenting. Jobbets cache-save läser filen efteråt.
  const stateTimer = setInterval(writeState, 10_000);

  const deadline = loopSeconds ? Date.now() + loopSeconds * 1000 : 0;

  /** Ett varv för EN butik: hämta → diffa → posta. Returnerar hämtningens kostnad. */
  const runStore = async (source: RestockSourceInfo): Promise<number> => {
    const before = requestCountSnapshot();
    const items: FeedItem[] = await fetchSourceFeed(source);
    const requests = requestsForSource(before, requestCountSnapshot(), source, items[0]?.url);

    if (items.length === 0) {
      // Tom feed = INGEN INFORMATION, inte "allt försvann". mergeStateMap äger
      // regeln; vi hoppar helt så inte ens frånvarominnet rörs.
      // ⛔ EN GÅNG PER BUTIK OCH JOBB. En permanent trasig butik (Leksaksaffären)
      //    skrev annars raden vid VARJE varv — 18 rader per jobb, ~1 300 per dygn,
      //    som dränker de rader man faktiskt läser loggen för. Att den loggas alls är
      //    poängen (tyst tom feed gömde flapp-buggen 2026-07-25); att den upprepas är
      //    inte det.
      if (!emptyFeedLogged.has(source.name)) {
        emptyFeedLogged.add(source.name);
        console.warn(
          `[discord-restock] Tom katalog från ${source.name} — förra lagerläget behålls ` +
            `(loggas en gång per jobb).`
        );
      }
      return requests;
    }
    emptyFeedLogged.delete(source.name);

    const now = new Date();
    // ---- ATOMÄRT BLOCK: inga await här inne ----
    const derived = deriveRestockPosts({
      state,
      groups: [{ sourceName: source.name, items }],
      rotating,
      routes,
      filter,
      knownSets,
      now,
      policy: flapPolicy(),
      cooldownHours,
      baseUrl,
    });
    state = derived.nextState;
    stateDirty = true;
    // ---- slut atomärt block ----

    const s = derived.stats;
    if (s.seeded) {
      console.log(`[discord-restock] ${source.name}: ingen tidigare state — seedar, postar inget.`);
    } else if (s.seededSources.length) {
      console.log(`[discord-restock] ${source.name}: ny källa i state — seedas tyst.`);
    } else if (s.changes > 0) {
      const reasons = Object.entries(s.filteredReasons)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      console.log(
        `[discord-restock] ${source.name}: ${s.changes} lagerflipp(ar) → ${derived.posts.length} att posta ` +
          `(hoppade: ${s.skippedFiltered} vaktade${reasons ? ` [${reasons}]` : ""}, ` +
          `${s.skippedFlap} blink/flapp, ${s.skippedBlip} feed-hicka, ${s.skippedCooldown} cooldown` +
            `${s.rescuedByRoute ? `; ${s.rescuedByRoute} räddade av rutten` : ""}).`
      );
      for (const sample of s.filteredSamples) console.log(`[discord-restock]   vaktad: ${sample}`);
    }

    if (!derived.posts.length) return requests;

    // ---- KÖPBARHETSKOLL FÖRE UTSKICK ----
    // Shopifys `available` betyder inte "går att köpa" (se purchasableFromShopifyPage).
    // DB-lanen slår upp butikens produktsida vid varje lagerövergång; den här lanen ser
    // samma feed och måste ställa samma fråga, annars postar Discord ett larm som
    // webbplatsen redan vet är fel.
    // ⛔ null = vet inte ⇒ POSTA. Ett uteblivet svar är ingen ny upplysning, och att
    //    tolka det som slutsåld hade tystat äkta påfyllningar vid varje 429.
    const postable: typeof derived.posts = [];
    for (const p of derived.posts) {
      if (!shopifyStores.has(p.storeName)) {
        postable.push(p);
        continue;
      }
      const purchasable = await fetchShopifyPurchasable(p.storeUrl);
      if (purchasable === false) {
        console.log(
          `[discord-restock]   hoppar (köpknappen låst hos butiken): ${p.storeName} → ${p.storeUrl}`
        );
        continue;
      }
      postable.push(p);
    }
    if (!postable.length) return requests;

    if (!config) {
      // --dry-run: visa vad som HADE postats, rör inte Discord.
      for (const p of postable) {
        console.log(
          `[discord-restock][dry] ${p.storeName} → ${p.title} ` +
            `[set ${p.setName ?? "–"} / serie ${p.series ?? "–"} / ${p.language ?? "EN"}` +
            `${p.preorder ? " / FÖRHANDSBOKNING" : ""}] ${p.storeUrl}`
        );
      }
      totalPosted += postable.length;
      return requests;
    }

    const res = await postRestocks(postable, config);
    totalPosted += res.sent;
    totalFailures += res.failed;
    for (const k of res.postedKeys) {
      console.log(`[discord-restock]   postade: ${k.replace("\t", " → ")}`);
    }
    // Bara det som Discord kvitterade får en cooldown-stämpel. Misslyckades
    // utskicket ligger övergången kvar och larmas igen nästa varv.
    // ⛔ Synkront, av samma skäl som blocket ovan.
    if (res.postedKeys.length && state) {
      state = markPosted(state, res.postedKeys, now);
      stateDirty = true;
    }
    return requests;
  };

  /**
   * En butiks egen loop. Kör tills loopbudgeten är slut; väntar ut SIN takt mellan
   * varven. Ett fel i en butik får aldrig stoppa de andra — därav try/catch per varv.
   */
  const storeLoop = async (source: RestockSourceInfo, index: number) => {
    // ⛔ STARTA INTE ALLA SAMTIDIGT. politeFetch fördröjer per VÄRD, så 42 parallella
    //    hämtningar mot 42 olika butiker är i sig artigt — men Shopify svarar 429 när
    //    för många av deras BUTIKER träffas från samma IP i samma ögonblick (mätt:
    //    ett dussin 429-backoffar när svepet startade allt på en gång, exakt samma
    //    symtom som täckningsrevisionen 2026-08-13 råkade ut för). Ett litet
    //    startförskjut sprider dem, och eftersom butikerna sedan går i OLIKA takt
    //    driver de isär av sig själva i stället för att synka upp som svepet gjorde.
    await new Promise((r) => setTimeout(r, index * STAGGER_MS));

    const cdn = isCdnServed(source);
    const budget = pollBudget(cdn);
    let interval = pollIntervalMs(0, budget);
    let logged = false;
    for (;;) {
      const started = Date.now();
      try {
        const requests = await runStore(source);
        if (requests > 0) {
          interval = pollIntervalMs(requests, budget);
          if (!logged) {
            logged = true;
            console.log(
              `[discord-restock] takt ${source.name}: ${requests} förfrågn./hämtning ` +
                `(${cdn ? "CDN" : "egen server"}) → var ${Math.round(interval / 1000)}:e sekund.`
            );
          }
        }
      } catch (e) {
        console.error(
          `[discord-restock] ${source.name} kastade:`,
          e instanceof Error ? e.message : e
        );
      }
      if (!deadline) return;
      const next = started + interval;
      // Sista varvet får STARTA före deadline och löpa klart efter den —
      // `timeout-minutes` i workflowet har marginal för en hel hämtning. Att i
      // stället kräva att hela varvet ryms hade lämnat butiken tyst i upp till ett
      // helt intervall före varje jobbslut, dvs infört ett andra blint glapp
      // ovanpå det jobbytet redan kostar.
      if (next >= deadline) return;
      const wait = next - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  };

  // Alla butiker samtidigt. Det ökar INTE lasten mot någon enskild butik: politeFetch
  // fördröjer per VÄRD, och varje butik är en egen värd. Det tar bara bort köandet
  // MELLAN dem, vilket var hela poängen med att sluta svepa.
  await Promise.all(selected.map((s, i) => storeLoop(s, i)));

  clearInterval(stateTimer);
  writeState();

  console.log(`[discord-restock] Klart: ${totalPosted} larm postade totalt.`);

  // ⛔ NEKADE UTSKICK GÖR KÖRNINGEN RÖD. 2026-08-12 förlorade boten Send Messages i
  // alla sju kanaler och lanen stod tyst i 14 timmar — varenda körning grön, felet
  // bara en loggrad ingen läser. Ett rött jobb är den enda signal som når någon.
  if (totalFailures > 0) {
    console.error(
      `[discord-restock] ${totalFailures} larm NEKADES av Discord — kontrollera att boten ` +
        `har "Visa kanal" + "Skicka meddelanden" + "Bädda in länkar" i kanalerna ` +
        `(kör workflow-dispatch med test=true för en kanal-för-kanal-rapport).`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    // Avsluta EXPLICIT (samma läxa som restock-watch-run.ts 2026-08-11): en kvarhållen
    // HTTP-session räcker för att hålla event-loopen vid liv tills jobbets tak dödar
    // körningen — och en dödad körning sparar ALDRIG sin cache (post-steget hoppas vid
    // cancel), så nästa körning hade seedat om och tappat sin flapp-historik.
    process.exit(process.exitCode ?? 0);
  });
