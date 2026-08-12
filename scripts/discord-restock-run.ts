/**
 * DISCORD-SNABBFILEN — restock-larm till Discord var 2:a minut, helt utan databas.
 *
 * ⛔ RÖR ALDRIG NEON. Grinden (`shouldProcess`) returnerar ALLTID false, så
 * `runRestockScan` kör bara fas 1 (parallell feed-hämtning över HTTP) och returnerar
 * innan `ensureDbAwake()`. Källistan och ruttabellen kommer från en fil som
 * `export-restock-routes.ts` skrivit i scrape-alls fönster, där Neon ändå var vaken.
 * Saknas filen HOPPAR körningen över — den frågar hellre ingen än väcker databasen,
 * för Neon debiteras per vaken tid och varje väckning köper minst 300 s.
 * Det här är hela skälet att lanen är gratis; tas invarianten bort blir den inte det.
 *
 * ⛔ EGEN CACHE-NYCKEL. State-filen ligger i `.discord-restock-cache/`, INTE i
 * `.restock-cache/` som 10-min-lanen äger. Delade de katalog skulle lanarna läsa och
 * skriva varandras lagerläge — den ena hade missat restocks, den andra dubblerat dem,
 * och båda felen är tysta.
 *
 * ⛔ FLAPP-DÄMPNING ÄR INTE VALFRI HÄR. Dragon's Lair stod för 46 av 171 restocks de
 * senaste 14 dygnen och togglar heta varor dussintals gånger per dygn. DB-vägens
 * skydd (blink + dygnscooldown) sitter i checkRestockAlerts, som den här lanen aldrig
 * anropar — därför körs SAMMA dom (`evaluateStockFlap`) mot en historik som ligger i
 * cachen. Se src/lib/restock-feed-events.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";
import { discordRestockConfig, postRestocks, postTestMessages } from "../src/lib/discord-restock";
import {
  deriveRestockPosts,
  markPosted,
  type DiscordRestockState,
  type RouteTable,
} from "../src/lib/restock-feed-events";
import { flapPolicy } from "../src/lib/stock-flap";

const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
const stateFile = process.env.DISCORD_RESTOCK_STATE_FILE ?? ".discord-restock-cache/state.json";
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";
const cooldownHours = Number(process.env.RESTOCK_ALERT_COOLDOWN_HOURS ?? 2);

/**
 * Butikerna snabbfilen hämtar. Default är de mest aktiva, MÄTT 2026-08-11 på 14 dygns
 * RestockEvent (restocks/dygn): Dragon's Lair 3,3 · Shinycards 1,9 · Swepoke 1,5 ·
 * Speltrollet 1,3 · TCG Store 0,7 · Samlarhobby 0,6 · Alphaspel 0,4 · Webhallen 0,4.
 * Tillsammans 141 av 171 restocks = 82 %.
 *
 * ⛔ URVALET ÄR EN ARTIGHETSFRÅGA, INTE EN KOSTNADSFRÅGA. Actions-minuter är gratis
 * (publikt repo), men var 2:a minut mot ALLA 34 butiker vore ~24 500 feed-hämtningar
 * per dygn i stället för 10-min-lanens ~4 900 — en femdubblad last på småbutikers
 * servrar, och att bli blockerad av en butik skadar hela produkten, inte bara Discord.
 * Med åtta butiker blir det ~5 800/dygn ovanpå dagens, och 10-min-lanen täcker alla 34
 * som förut. Sätt `DISCORD_RESTOCK_STORES=all` för att köra på hela listan.
 *
 * ⛔ SAMMA RÄKNING ÄR SKÄLET ATT TAKTEN INTE ÄR 1 MINUT: åtta butiker varje minut vore
 * ~11 500 hämtningar/dygn, dvs en full paginerad katalogkrypning av varje butik var
 * 60:e sekund dygnet runt. Det köper ~30 s lägre snittlatens på 12,2 restocks/dygn.
 * (Och 1 minut ligger dessutom UNDER körningstiden — se workflow-filens huvud.)
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
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<DiscordRestockState>;
    if (!parsed.stock || typeof parsed.stock !== "object") return null;
    return {
      stock: parsed.stock,
      history: parsed.history && typeof parsed.history === "object" ? parsed.history : {},
      posted: parsed.posted && typeof parsed.posted === "object" ? parsed.posted : {},
    };
  } catch (e) {
    console.warn("[discord-restock] Kunde inte läsa state-filen:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  const config = discordRestockConfig();
  if (!config) {
    console.log(
      "[discord-restock] Avstängd (DISCORD_RESTOCK_ENABLED != true, eller saknad " +
        "DISCORD_BOT_TOKEN/DISCORD_RESTOCK_CHANNELS) — gör ingenting."
    );
    return;
  }

  // `--test`: posta ett märkt testinlägg i varje kanal och sluta. Rör varken feedar
  // eller state — enda sättet att bevisa att boten FÅR skriva innan en riktig
  // påfyllning inträffar (ett 403 syns annars bara i en logg ingen läser).
  if (process.argv.includes("--test")) {
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
    // väckt computen var 2:a minut, vilket är precis det den här lanen finns för att
    // undvika. Filen skrivs av scrape-all inom ett dygn.
    console.warn(
      `[discord-restock] Ingen ruttabell (${routesFile}) — hoppar över. ` +
        "Den skrivs av export-restock-routes.ts i scrape-all; första körningen efter " +
        "att den lagts till fyller cachen."
    );
    return;
  }

  const ageH = routesData.at ? (Date.now() - routesData.at) / 3600_000 : null;
  const storesEnv = process.env.DISCORD_RESTOCK_STORES?.trim();
  const onlySources =
    storesEnv === "all"
      ? undefined
      : (storesEnv ? storesEnv.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_STORES);

  console.log(
    `[discord-restock] Ruttabell: ${Object.keys(routesData.routes!).length} URL:er` +
      (ageH != null ? `, ${ageH.toFixed(1)} h gammal` : "") +
      `. Butiker: ${onlySources ? onlySources.join(", ") : "alla"}.`
  );

  const rotating = new Set(
    routesData.sources!.filter((s) => s.rotatingFeed).map((s) => s.name)
  );
  let nextState: DiscordRestockState | null = null;
  let posted = 0;
  let postFailures = 0;

  const result = await runRestockScan({
    sources: routesData.sources,
    onlySources,
    // ⛔ RETURNERAR ALLTID FALSE. Allt arbete sker här, i fas 1, och DB-fasen nås aldrig.
    shouldProcess: async (fetched) => {
      const empty = fetched.filter((f) => f.items.length === 0).map((f) => f.sourceName);
      if (empty.length) {
        console.warn(
          `[discord-restock] Tom katalog från: ${empty.join(", ")} — räknas som "ingen ` +
            `information", förra lagerläget behålls.`
        );
      }

      const now = new Date();
      const derived = deriveRestockPosts({
        state: readState(),
        groups: fetched,
        rotating,
        routes: routesData.routes!,
        now,
        policy: flapPolicy(),
        cooldownHours,
        baseUrl,
      });
      nextState = derived.nextState;

      const s = derived.stats;
      if (s.seeded) {
        console.log("[discord-restock] Ingen tidigare state — seedar lagerläget, postar inget.");
      } else {
        if (s.seededSources.length) {
          console.log(
            `[discord-restock] Ny(a) källa(or) i state: ${s.seededSources.join(", ")} — ` +
              "seedas tyst, postar inget för dem denna körning."
          );
        }
        console.log(
          `[discord-restock] ${s.changes} lagerflipp(ar) → ${derived.posts.length} att posta ` +
            `(hoppade: ${s.skippedUnknownUrl} okänd URL, ${s.skippedFlap} blink/flapp, ` +
            `${s.skippedCooldown} cooldown).`
        );
      }

      if (derived.posts.length) {
        const res = await postRestocks(derived.posts, config);
        posted = res.sent;
        postFailures = res.failed;
        // Bara det som Discord kvitterade får en cooldown-stämpel. Misslyckades
        // utskicket ligger övergången kvar och larmas igen nästa körning.
        nextState = markPosted(derived.nextState, res.postedKeys, now);
      }
      return false;
    },
  });

  // Skriv state EFTER utskicket. Dör körningen däremellan ligger övergången kvar och
  // upptäcks igen nästa körning — dubbelt larm är oändligt mycket bättre än ett missat,
  // exakt samma ordningsregel som DB-vägen (larma först, konsumera övergången sist).
  //
  // ⚠️ MEDVETEN BEGRÄNSNING: ett larm som Discord NEKADE (401/403/404) konsumerar ändå
  // sin lagerövergång — det nya lagerläget skrivs oavsett. Cooldown-stämpeln sätts dock
  // inte (se markPosted), så NÄSTA påfyllning larmar normalt. Alternativet — att behålla
  // det gamla lagerläget för nekade larm — ger en återförsökssnurra som matar in falska
  // övergångar i flapp-historiken och därmed kan tysta en ÄKTA påfyllning i ett dygn.
  // Nekade utskick är i praktiken felkonfiguration (fel kanal-id, boten saknar
  // "Send Messages"), syns direkt i loggen ovan, och rättas en gång.
  if (nextState) {
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(nextState));
    } catch (e) {
      console.warn("[discord-restock] Kunde inte skriva state-filen:", e instanceof Error ? e.message : e);
    }
  }

  console.log(`[discord-restock] ${result.sources} butiker hämtade, ${posted} larm postade.`);

  // ⛔ NEKADE UTSKICK GÖR KÖRNINGEN RÖD. 2026-08-12 förlorade boten Send Messages i
  // alla sju kanaler och lanen stod tyst i 14 timmar — varenda körning grön, felet
  // bara en loggrad ingen läser. Ett rött jobb är den enda signal som når någon.
  // (Testläget beter sig redan så; det här är samma regel för driftvägen.)
  if (postFailures > 0) {
    console.error(
      `[discord-restock] ${postFailures} larm NEKADES av Discord — kontrollera att boten ` +
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
