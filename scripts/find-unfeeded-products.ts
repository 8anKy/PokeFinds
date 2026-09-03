/**
 * HITTA PRODUKTSIDOR SOM BUTIKEN PUBLICERAR MEN ALDRIG INDEXERAR I SIN FEED.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/find-unfeeded-products.ts --q="30th celebration"
 *   node scripts/with-prod-db.mjs npx tsx scripts/find-unfeeded-products.ts --q="30th|celebration" --store=Goblinen
 *
 * ⛔ VARFÖR. Butiksfeedarna är vår enda upptäcktsväg, och de är inte kompletta.
 * Goblinen publicerade 30th Celebration-ETB:n 2026-09-03: produktsidan svarar 200,
 * men URL:en finns varken i kollektions-JSON:en, `/products.json`, sökindexet, i
 * `sitemap_products_1.xml` (1,1 MB produkt-URL:er, noll träffar) eller i Atom-feeden.
 * En konkurrents Discord larmade ändå — alltså kände de URL:en, de hittade den inte.
 *
 * Den här rapporten letar i de index som ligger UTANFÖR adapterns väg — butikens
 * SITEMAP och dess SÖKENDPOINT — och listar träffar som inte redan har en Offer eller
 * en StoreListing hos oss. Utfallet är kandidater till bevakningslistan
 * (`WatchedListing`, admin → Bevakade länkar), inte något som importeras automatiskt:
 * en URL som ingen feed nämner kan vi inte diffa, bara fråga.
 *
 * ⛔ RAPPORT ONLY — rör aldrig databasen. Artigt: politeFetch (robots.txt, fördröjning
 * per värd, FoilioBot-UA, backoff). Sitemaps och sökendpoints är publika index som
 * finns till för att läsas; vi kringgår ingenting.
 *
 * ⚠️ "Saknas i vår katalog" ≠ "butiken döljer den". Den vanligaste förklaringen är att
 * produkten helt enkelt inte finns hos butiken. Läs träffarna, klicka innan du lägger
 * till dem.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { politeFetch } from "../src/scrapers/http";
import { mapPool } from "../src/lib/concurrency";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Söksträngen är en REGEX mot URL:en och (när vi har den) titeln. */
const QUERY = arg("q") ?? "30th.?celebration|30th.?anniversary";
const ONLY_STORE = arg("store");
/** Tak per butik så en felaktig regex inte skriver ut tusentals rader. */
const MAX_PER_STORE = Number(arg("max") ?? 25);

const RE = new RegExp(QUERY, "i");

/**
 * ⛔ MATCHA PÅ SÖKVÄGEN, ALDRIG PÅ QUERYSTRÄNGEN. Shopifys sökresultat bär
 * `?_psq=30th+celebration` i VARJE träff-URL — så en fritextsökning som butiken
 * besvarade med tio helt orelaterade produkter (Dragon's Lair gav "Astral Radiance
 * Build & Battle") såg ut som tio träffar. Frågan stod i länken, inte i produkten.
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.replace(/[?#].*$/, "");
  }
}

/**
 * Butikens språk-/marknadsprefix (`/en/`, `/da/`, `/sv-eu/`) pekar på SAMMA produkt.
 * Utan den här kollapsen rapporterades RGB Kingz sylveon-box tre gånger, och en av
 * dem hade blivit den bevakade — fel URL för en svensk kund.
 */
const LOCALE_PREFIX = /^\/(?:[a-z]{2}|[a-z]{2}-[a-z]{2,3})(?=\/)/i;
function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${pathOf(url).replace(LOCALE_PREFIX, "").replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.toLowerCase();
  }
}

/** Sidor som aldrig är produkter, hur väl de än matchar (bloggposter, hyllor). */
const NOT_A_PRODUCT = /\/(?:blogs?|blogg|collections|kategori|categories|pages)\//i;

/** Sitemap-index kan peka på sitemap-index. Två nivåer räcker för alla plattformar vi har. */
const MAX_SITEMAP_DEPTH = 2;
/** Skyddsräcke: en butik med hundratals sitemaps ska inte kunna göra körningen oändlig. */
const MAX_SITEMAPS_PER_STORE = 25;

/**
 * ⛔ EN MISSLYCKAD HÄMTNING FÅR ALDRIG SE UT SOM "INGA TRÄFFAR". Andra körningen av
 * den här rapporten samma timme fick 429 på nästan varje sitemap — och eftersom
 * `null` bara gav färre URL:er rapporterades sju butiker som "0 träffar, 0 okända"
 * när sanningen var "vi blev utestängda". Exakt samma tysta trunkering som
 * ShopifyAdapterns sidtak (se `fetchProducts`). Felen räknas per butik och skrivs ut.
 */
async function text(url: string, fails?: { n: number; first?: string }): Promise<string | null> {
  try {
    const res = await politeFetch(url, { delayMs: 600 });
    if (!res.ok) {
      if (fails) {
        fails.n++;
        fails.first ??= `HTTP ${res.status} ${url}`;
      }
      return null;
    }
    return await res.text();
  } catch (e) {
    if (fails) {
      fails.n++;
      fails.first ??= `${e instanceof Error ? e.message : String(e)} ${url}`;
    }
    return null;
  }
}

/** `<loc>`-värden ur en sitemap eller ett sitemap-index. */
function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&")
  );
}

/** Sitemap-URL:er ur robots.txt (auktoritativa) + de vanliga gissningarna. */
async function sitemapEntries(baseUrl: string, fails: { n: number; first?: string }): Promise<string[]> {
  const out = new Set<string>();
  const robots = await text(`${baseUrl}/robots.txt`, fails);
  for (const m of (robots ?? "").matchAll(/^\s*sitemap:\s*(\S+)/gim)) out.add(m[1]);
  if (out.size === 0) out.add(`${baseUrl}/sitemap.xml`);
  return [...out];
}

/** Alla produkt-URL:er butiken listar i sina sitemaps (rekursivt, tak enligt konstanterna). */
async function sitemapUrls(baseUrl: string, fails: { n: number; first?: string }): Promise<string[]> {
  const seen = new Set<string>();
  const pages: string[] = [];
  let queue = await sitemapEntries(baseUrl, fails);
  for (let depth = 0; depth <= MAX_SITEMAP_DEPTH && queue.length; depth++) {
    const next: string[] = [];
    for (const sm of queue) {
      if (seen.size >= MAX_SITEMAPS_PER_STORE) break;
      if (seen.has(sm)) continue;
      seen.add(sm);
      const xml = await text(sm, fails);
      if (!xml) continue;
      const isIndex = /<sitemapindex/i.test(xml);
      for (const u of locs(xml)) (isIndex ? next : pages).push(u);
    }
    queue = next;
  }
  return pages;
}

/**
 * Butikens EGET sökindex. Shopify svarar JSON på `/search/suggest.json`; andra
 * plattformar ger HTML, och då plockas produktlänkarna ur svaret. Båda vägarna är
 * samma sökruta en besökare använder.
 */
async function searchUrls(baseUrl: string, q: string, fails: { n: number; first?: string }): Promise<string[]> {
  const out = new Set<string>();
  const suggest = await text(
    `${baseUrl}/search/suggest.json?q=${encodeURIComponent(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10`,
    fails
  );
  if (suggest?.trim().startsWith("{")) {
    try {
      const j = JSON.parse(suggest) as {
        resources?: { results?: { products?: { url?: string; handle?: string }[] } };
      };
      for (const p of j.resources?.results?.products ?? []) {
        if (p.url) out.add(p.url.startsWith("http") ? p.url : `${baseUrl}${p.url}`);
        else if (p.handle) out.add(`${baseUrl}/products/${p.handle}`);
      }
    } catch {
      /* inte JSON trots {} — strunta i det */
    }
  }
  const html = await text(`${baseUrl}/search?q=${encodeURIComponent(q)}`, fails);
  for (const m of (html ?? "").matchAll(/href="([^"]*\/(?:products?|produkt|p)\/[^"?#]+)/gi)) {
    const u = m[1].startsWith("http") ? m[1] : `${baseUrl}${m[1]}`;
    out.add(u.replace(/&amp;/g, "&"));
  }
  return [...out];
}

async function main() {
  const sources = (await prisma.scrapeSource.findMany({ where: { isActive: true } }))
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .filter((s) => !ONLY_STORE || s.name === ONLY_STORE)
    .map((s) => ({ name: s.name, baseUrl: s.baseUrl.replace(/\/+$/, "") }));

  // ALLT vi redan känner till — offers OCH huvudboken. En URL i endera är ingen
  // upptäckt, den är redan bevakad via feeden.
  const known = new Set<string>();
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  for (const o of await prisma.offer.findMany({ select: { url: true } })) known.add(norm(o.url));
  for (const l of await prisma.storeListing.findMany({ select: { url: true } })) known.add(norm(l.url));

  console.log(`[probe] ${sources.length} butiker, regex /${QUERY}/i, ${known.size} kända URL:er\n`);

  const rows: { store: string; url: string; via: string }[] = [];
  /** Butiker vars index vi inte fick läsa färdigt — deras noll betyder ingenting. */
  const incomplete: string[] = [];
  // Samtidighet över OLIKA värdar; politeFetch serialiserar per värd, så en butiks
  // egen takt påverkas inte av talet här.
  await mapPool(sources, 6, async (s) => {
    // Nyckeln är den KANONISKA formen (utan locale-prefix), värdet den URL vi
    // faktiskt rapporterar — den utan prefix vinner när båda formerna dyker upp.
    const hits = new Map<string, { url: string; via: string }>();
    const add = (u: string, via: string) => {
      if (!RE.test(pathOf(u)) || NOT_A_PRODUCT.test(pathOf(u))) return;
      const key = canonicalKey(u);
      const prev = hits.get(key);
      if (prev && LOCALE_PREFIX.test(pathOf(prev.url)) === LOCALE_PREFIX.test(pathOf(u))) return;
      if (prev && !LOCALE_PREFIX.test(pathOf(prev.url))) return;
      hits.set(key, { url: u.replace(/[?#].*$/, ""), via });
    };
    const fails = { n: 0, first: undefined as string | undefined };
    for (const u of await sitemapUrls(s.baseUrl, fails)) add(u, "sitemap");
    for (const u of await searchUrls(s.baseUrl, QUERY.split("|")[0].replace(/\.\?/g, " "), fails)) {
      add(u, "sök");
    }

    let n = 0;
    for (const { url, via } of hits.values()) {
      if (known.has(norm(url))) continue;
      if (n++ >= MAX_PER_STORE) break;
      rows.push({ store: s.name, url, via });
    }
    const unknown = [...hits.values()].filter((h) => !known.has(norm(h.url))).length;
    console.log(
      `  ${s.name.padEnd(22)} ${String(hits.size).padStart(3)} träffar, ${String(unknown).padStart(3)} okända` +
        // ⛔ "0 träffar" och "vi blev utestängda" måste gå att skilja åt.
        (fails.n ? `   ⚠ ${fails.n} hämtning(ar) MISSLYCKADES — ofullständig. Först: ${fails.first}` : "")
    );
    if (fails.n) incomplete.push(s.name);
  });

  rows.sort((a, b) => a.store.localeCompare(b.store) || a.url.localeCompare(b.url));
  console.log(`\n=== ${rows.length} KANDIDATER (finns hos butiken, saknas hos oss) ===`);
  for (const r of rows) console.log(`  [${r.via}] ${r.store}: ${r.url}`);
  if (rows.length === 0) {
    console.log("  (inga — antingen säljer butikerna dem inte, eller så ligger de redan i feeden)");
  }
  if (incomplete.length) {
    console.log(`\n⚠ OFULLSTÄNDIGT för ${incomplete.length} butik(er): ${incomplete.join(", ")}.`);
    console.log("  Deras index gick inte att läsa färdigt (oftast 429 — kör inte rapporten två");
    console.log("  gånger i rad mot samma butiker). Ett '0 okända' för dessa betyder INGENTING.");
  }
}

main()
  .catch((e) => {
    console.error("[probe] Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
