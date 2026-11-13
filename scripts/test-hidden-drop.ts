/**
 * PROV AV SPELEXPERTENS DOLDA SLÄPP — hela vägen, som ett DM till EN person (2026-11-12).
 *
 * Kör samma kod som lanen (`DropWatcher.fastTick`): svepet i butikens sök → den dolda
 * rotnivåsidan → läsningen → domen → samma embed som kanalinlägget. Det ENDA som är
 * simulerat är lagret: butikens gamla dolda sida (12 oktober) står som slutsåld, så svaret
 * från just den sidan skrivs om till "i lager" på vägen in. Inget postas i någon kanal,
 * inga larm-hits skickas, lanens state rörs inte (egen temporär drops-fil).
 *
 *   railway run npx tsx scripts/test-hidden-drop.ts --user <e-post|discord-namn>            (rapport)
 *   railway run npx tsx scripts/test-hidden-drop.ts --user <e-post|discord-namn> --apply    (skickar DM)
 *   … --discord-id <id>   (hoppar över databasen)
 *   … --page /upc-night.html   (provar streckkodsvägen: 30th UPC, sidan heter inte "POK …")
 *
 * `railway run` = bot-token (+ prod-DB för uppslaget av Discord-id) ur tjänstens variabler.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DropWatcher } from "./lib/drop-watch";
import { SpelexpertenAdapter } from "../src/scrapers/adapters/spelexperten-adapter";
import { buildRestockEmbed, type RestockPost } from "../src/lib/discord-restock";

const STORE = "Spelexperten";
// Vilken dold sida som "fylls på" i provet: --page /upc-night.html (30th UPC, hittas på
// STRECKKODEN — inget "POK" i namnet) eller standard = oktobersidan (hittas på prefixet).
const TEST_PAGE = (() => {
  const i = process.argv.indexOf("--page");
  return i >= 0 ? process.argv[i + 1] : "/pok-30-12-oktober.html";
})();
/** Gör 30th Celebration till ett HETT set, som i lanen (den har postat om setet). */
const HOT_SEED = "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-30th-celebration-ultra-premium-collection-night.html";
const APPLY = process.argv.includes("--apply");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function discordIdFor(user: string): Promise<string> {
  const { prisma, ensureDbAwake } = await import("../src/lib/db");
  await ensureDbAwake();
  const row = await prisma.user.findFirst({
    where: { OR: [{ email: user }, { discordUsername: { equals: user, mode: "insensitive" } }] },
    select: { discordUserId: true, discordUsername: true },
  });
  if (!row?.discordUserId) throw new Error(`Inget kopplat Discord-konto för ${user}.`);
  console.log(`Mottagare: ${row.discordUsername}`);
  return row.discordUserId;
}

async function sendDm(discordUserId: string, embed: unknown): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN saknas (kör via `railway run`).");
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const ch = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!ch.ok) throw new Error(`Kunde inte öppna DM-kanal: ${ch.status} ${await ch.text()}`);
  const { id } = (await ch.json()) as { id: string };
  const res = await fetch(`https://discord.com/api/v10/channels/${id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: "**TEST** — så här ser ett dolt Spelexperten-släpp ut i kanalen. Lagret är simulerat (sidan är slutsåld på riktigt).",
      embeds: [embed],
    }),
  });
  if (!res.ok) throw new Error(`DM nekades: ${res.status} ${await res.text()}`);
}

async function main() {
  const user = arg("user");
  const explicitId = arg("discord-id");
  if (APPLY && !user && !explicitId) throw new Error("Ange --user <e-post|discord-namn> eller --discord-id <id>.");

  // Simulerat lager: BARA den gamla dolda sidans svar skrivs om.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await realFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes(TEST_PAGE) || !res.ok) return res;
    const html = (await res.text()).replace(/schema\.org\/OutOfStock/g, "schema.org/InStock");
    console.log("[test] simulerar lager: den dolda sidans svar omskrivet till InStock");
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;

  console.log("[test] hämtar Spelexpertens vanliga feed (för att peka ut originalsidan)…");
  const feed = await new SpelexpertenAdapter().fetchProducts();
  console.log(`[test] feed: ${feed.products.length} annonser, ${feed.errors.length} fel`);

  const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";
  const routes = existsSync(routesFile) ? (JSON.parse(readFileSync(routesFile, "utf8")).routes ?? {}) : {};
  console.log(`[test] ruttabell: ${Object.keys(routes).length} URL:er${Object.keys(routes).length ? "" : " (saknas lokalt — inlägget blir utan marknadsvärde/produktlänk)"}`);

  const file = join(tmpdir(), `drops-test-${Date.now()}.json`);
  let published: RestockPost[] | null = null;
  const watcher = new DropWatcher({
    file,
    routes,
    posted: () => ({ [`${STORE}	${HOT_SEED}`]: Date.now() }),
    publish: async (posts) => {
      published = posts;
    },
    baseUrl: "https://scoutr.se",
  });
  watcher.noteFeed(
    STORE,
    feed.products.map((p) => ({
      url: p.url,
      title: p.title,
      stockStatus: String(p.stockStatus),
      price: p.price ?? null,
      imageUrl: p.imageUrl ?? null,
    })),
    []
  );

  const started = Date.now();
  while (!published && Date.now() - started < 10 * 60_000) {
    await watcher.fastTick(STORE, 0);
    await new Promise((r) => setTimeout(r, 3000));
  }
  try {
    rmSync(file, { force: true });
  } catch {
    /* temporär fil */
  }
  if (!published) {
    console.error("[test] ❌ Ingen post inom 10 min — svepet hittade inte den dolda sidan eller domen fällde den.");
    process.exitCode = 1;
    return;
  }
  const post = (published as RestockPost[])[0];
  console.log(`[test] ✅ upptäckt → post på ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`[test] rubrik: ${post.title}\n[test] länk:   ${post.storeUrl}\n[test] text:   ${post.drop?.note}`);
  const embed = buildRestockEmbed(post);
  if (!APPLY) {
    console.log(JSON.stringify(embed, null, 2));
    console.log("Torrkörning — lägg till --apply för att skicka DM:et.");
    return;
  }
  const id = explicitId ?? (await discordIdFor(user!));
  await sendDm(id, embed);
  console.log("[test] DM skickat.");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
