/**
 * GISSA PRODUKT-URL:er SOM INGEN FEED NÄMNER — genom att lära av butikens egna länkar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-store-handles.ts --q="30th Celebration"
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-store-handles.ts --days=30 --store=Goblinen
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-store-handles.ts --q="30th" --apply
 *
 * ⛔ VARFÖR DEN HÄR VÄGEN FINNS. `find-unfeeded-products.ts` letar i butikens INDEX
 * (sitemap, sökendpoint) och hittar bara det butiken publicerar där. Goblinens fem
 * 30th Celebration-produkter står i INGET index — varken i kollektions-JSON:en,
 * `/products.json`, sökindexet, någon av de tre sitemaps:erna eller Atom-feeden — men
 * varje produktsida svarar 200 på sin egen URL. Det enda som fungerar är att GISSA
 * adressen och fråga. Det här skriptet gissar systematiskt.
 *
 * HUR GISSNINGEN LÄRS, INTE HÅRDKODAS: butiken har redan hundratals länkar hos oss.
 * För varje känd (katalogtitel → URL) räknas `slugify(titel)` ut och matchas mot
 * URL:ens sista segment; det som blir över är butikens PREFIX och SUFFIX. Mätt
 * 2026-09-04 ger det t.ex. Goblinen `pokemon-tcg-` + `-max-1-kund`, RGB Kingz
 * `pokemon-` + `-kopia`/`-japansk`, Blindbox både `pokemon-` och tomt. Att hårdkoda
 * en konvention per butik hade varit fel i samma sekund en butik bytte tema.
 *
 * ⛔ EN 200 RÄCKER INTE SOM BEVIS. Många butiker svarar 200 på en död URL (soft-404).
 * Träffen valideras därför med `fetchWatchedListing` — samma funktion bevakningen
 * använder i drift — som kräver att sidan bär läsbar produktdata (titel + lagerstatus).
 * Kan vi inte läsa sidan är den värdelös som bevakning ändå.
 *
 * ⛔ ARTIGHET ÄR ETT TAK, INTE EN FÖRHOPPNING. Gissningar är per definition mest
 * 404:or, så varje butik har ett hårt tak (`--max`, default 60) och politeFetch
 * fördröjer per värd. Kör inte skriptet brett mot alla butiker i onödan — sikta på
 * det som faktiskt saknas (`--q` eller `--days`).
 *
 * Utan `--apply` skrivs INGENTING — bara en rapport.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/utils";
import { mapPool } from "../src/lib/concurrency";
import { fetchWatchedListing } from "../src/scrapers/watched-listing";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes("--apply");
const QUERY = arg("q");
const DAYS = Number(arg("days") ?? 60);
const ONLY_STORE = arg("store");
const MAX_PER_STORE = Number(arg("max") ?? 60);

/** Hur många kända länkar per butik konventionen lärs av. */
const LEARN_SAMPLE = 400;
/** Topp-N prefix och suffix som provas (kombineras: N×N gissningar per produkt). */
const TOP_AFFIXES = 3;

/**
 * KÖPGRÄNS-SUFFIX som INTE går att lära sig ur butikens andra länkar.
 *
 * ⛔ MÄTT 2026-09-04 på Goblinen: fyra av deras fem dolda 30th Celebration-URL:er slutar
 * på `-max-1-kund` / `-max-1st-kund`, medan konventionen som lärdes ur butikens 16 kända
 * länkar gav `∅ / -pack-japansk / -japansk`. Skälet är att gränsen sitter på PRODUKTEN
 * (en het nyhet ransoneras), inte på butiken — så den syns aldrig i det äldre sortiment
 * man lär av. Och det är precis de ransonerade nyheterna man letar efter.
 *
 * Listan är kort och svensk med flit: varje post kostar en gissning per produkt och butik.
 */
const QUANTITY_SUFFIXES = ["-max-1-kund", "-max-1st-kund", "-max-2-kund", "-max-5st-kund"];

interface Convention {
  /** Sökväg före handlet, t.ex. "/products". Vanligaste formen hos butiken. */
  pathPrefix: string;
  prefixes: string[];
  suffixes: string[];
  learnedFrom: number;
}

/** Lär butikens handle-konvention ur dess EGNA befintliga länkar. */
export function learnConvention(pairs: { title: string; url: string }[]): Convention | null {
  const prefix = new Map<string, number>();
  const suffix = new Map<string, number>();
  const paths = new Map<string, number>();
  let learned = 0;

  for (const { title, url } of pairs) {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    const segs = path.split("/").filter(Boolean);
    const seg = segs.pop();
    if (!seg) continue;
    const slug = slugify(title);
    if (slug.length < 8) continue; // för kort för att vara ett säkert fäste
    const i = seg.indexOf(slug);
    // Butikens egen titel skiljer sig ofta från katalogens — då lär vi inget av paret.
    if (i < 0) continue;
    learned++;
    paths.set(`/${segs.join("/")}`, (paths.get(`/${segs.join("/")}`) ?? 0) + 1);
    const p = seg.slice(0, i);
    const s = seg.slice(i + slug.length);
    // Långa "prefix" är butikens set-/serienamn, inte en konvention — de generaliserar
    // inte till andra produkter och hade bara bränt budgeten på omöjliga gissningar.
    if (p.length <= 14) prefix.set(p, (prefix.get(p) ?? 0) + 1);
    if (s.length <= 14) suffix.set(s, (suffix.get(s) ?? 0) + 1);
  }
  if (learned < 3) return null;

  const top = (m: Map<string, number>) =>
    [...m].sort((a, b) => b[1] - a[1]).slice(0, TOP_AFFIXES).map(([k]) => k);
  const pathPrefix = [...paths].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  // Tomt prefix/suffix är alltid värt en gissning även om butiken sällan använder det.
  const prefixes = [...new Set([...top(prefix), ""])];
  // ⛔ ORDNINGEN ÄR BUDGETEN. Gissningarna prövas i affix-ordning (se `rank` nedan), så
  // det som står först är det som faktiskt hinner testas. Köpgränserna läggs DIREKT efter
  // det tomma suffixet — inte sist — eftersom målprodukterna per definition är färska och
  // heta, och det är just de butiken ransonerar. Låg de sist hann de aldrig prövas:
  // Goblinens ETB ligger på `-max-1-kund` och krävde då 518 gissningar i stället för 74.
  const suffixes = [...new Set(["", ...QUANTITY_SUFFIXES, ...top(suffix)])];
  return { pathPrefix, prefixes, suffixes, learnedFrom: learned };
}

async function main() {
  const sources = (await prisma.scrapeSource.findMany({ where: { isActive: true } }))
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .filter((s) => !ONLY_STORE || s.name === ONLY_STORE)
    .map((s) => ({ name: s.name, baseUrl: s.baseUrl.replace(/\/+$/, "") }));

  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const idByName = new Map(retailers.map((r) => [r.name, r.id]));

  // MÅLPRODUKTER: det vi letar efter hos butikerna. Default = färska set (det är där
  // butikerna hinner före oss); `--q` när man jagar något bestämt.
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  const targets = await prisma.product.findMany({
    where: {
      hiddenAt: null,
      language: "EN",
      category: { in: ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] },
      ...(QUERY
        ? { title: { contains: QUERY, mode: "insensitive" as const } }
        : { set: { releaseDate: { gte: since } } }),
    },
    select: { id: true, title: true },
  });
  console.log(
    `[handles] ${targets.length} målprodukter (${QUERY ? `titel ~ "${QUERY}"` : `set släppta senaste ${DAYS} d`}), ` +
      `${sources.length} butiker, tak ${MAX_PER_STORE} gissningar/butik.\n`
  );
  if (targets.length === 0) return;

  const known = new Set<string>();
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  for (const o of await prisma.offer.findMany({ select: { url: true } })) known.add(norm(o.url));
  for (const l of await prisma.storeListing.findMany({ select: { url: true } })) known.add(norm(l.url));
  // ⛔ REDAN BEVAKADE URL:er FILTRERAS INTE BORT — de MARKERAS. Då blir varje körning sin
  // egen självkontroll: hittar skriptet inte tillbaka till de länkar vi REDAN vet finns, är
  // gissningen trasig och nollan nedan betyder ingenting. (Första versionen filtrerade bort
  // dem och rapporterade "0 träffar" mot en butik där rätt svar var fem.)
  const watched = new Set<string>();
  for (const w of await prisma.watchedListing.findMany({ select: { url: true } })) {
    watched.add(norm(w.url));
  }

  const found: {
    store: string; url: string; title: string; status: string; priceOre: number | null; already: boolean;
  }[] = [];

  // Samtidighet över OLIKA butiker; politeFetch serialiserar per värd.
  await mapPool(sources, 5, async (s) => {
    const retailerId = idByName.get(s.name);
    if (!retailerId) return;

    const offers = await prisma.offer.findMany({
      where: { retailerId },
      select: { url: true, productId: true, product: { select: { title: true } } },
      take: LEARN_SAMPLE,
    });
    const conv = learnConvention(offers.map((o) => ({ title: o.product.title, url: o.url })));
    if (!conv) {
      console.log(`  ${s.name.padEnd(22)} för få kända länkar att lära av — hoppar`);
      return;
    }

    // Bara produkter butiken INTE redan har en offer på — resten behöver ingen gissning.
    const covered = new Set(offers.map((o) => o.productId));
    const wanted = targets.filter((t) => !covered.has(t.id));

    // ⛔ BUDGETEN MÅSTE ORDNAS PER SANNOLIKHET, INTE PER PRODUKT. Först genererades
    // alla kombinationer produkt för produkt, så taket (120) tog slut efter fyra av
    // 37 produkter — resten fick aldrig ens sin mest sannolika gissning. `rank` är
    // summan av affix-platserna (0 = butikens vanligaste prefix + inget suffix), och
    // sorteringen gör att VARJE produkt får sitt bästa försök före någon får sitt andra.
    const candidates: { url: string; title: string; rank: number }[] = [];
    for (const t of wanted) {
      const slug = slugify(t.title);
      conv.prefixes.forEach((p, pi) => {
        conv.suffixes.forEach((suf, si) => {
          const url = `${s.baseUrl}${conv.pathPrefix}/${p}${slug}${suf}`;
          if (known.has(norm(url))) return;
          candidates.push({ url, title: t.title, rank: pi + si });
        });
      });
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const budget = candidates.slice(0, MAX_PER_STORE);

    let hits = 0;
    for (const c of budget) {
      // ⛔ En 200 räcker inte — sidan måste bära läsbar produktdata. Se filhuvudet.
      const { item } = await fetchWatchedListing(s.name, c.url);
      if (!item) continue;
      hits++;
      found.push({
        store: s.name,
        url: c.url,
        title: item.title,
        status: item.stockStatus,
        priceOre: item.price,
        already: watched.has(norm(c.url)),
      });
    }
    console.log(
      `  ${s.name.padEnd(22)} konvention: prefix [${conv.prefixes.map((p) => p || "∅").join(", ")}] ` +
        `suffix [${conv.suffixes.map((x) => x || "∅").join(", ")}] (lärt av ${conv.learnedFrom}) ` +
        `→ ${budget.length}/${candidates.length} gissningar, ${hits} träffar`
    );
  });

  const fresh = found.filter((f) => !f.already);
  console.log(
    `\n=== ${found.length} TRÄFFAR — ${fresh.length} nya, ` +
      `${found.length - fresh.length} redan bevakade (självkontroll) ===`
  );
  for (const f of found) {
    const price = f.priceOre != null ? `${(f.priceOre / 100).toFixed(0)} kr` : "–";
    console.log(
      `  ${f.already ? "○" : "●"} ${f.store.padEnd(16)} ${f.status.padEnd(13)} ${price.padStart(8)}  ` +
        f.title.slice(0, 52)
    );
    console.log(`      ${" ".repeat(14)} ${f.url}`);
  }

  if (!APPLY) {
    console.log(`\n(torrkörning — kör om med --apply för att lägga till dem som bevakade länkar)`);
    return;
  }
  for (const f of fresh) {
    const retailerId = idByName.get(f.store);
    if (!retailerId) continue;
    await prisma.watchedListing.upsert({
      where: { retailerId_url: { retailerId, url: f.url } },
      create: {
        retailerId,
        url: f.url,
        note: `Gissad URL (probe-store-handles ${new Date().toISOString().slice(0, 10)}) — finns inte i butikens feed.`,
      },
      update: { isActive: true },
    });
  }
  console.log(`\n✓ ${fresh.length} bevakade länkar tillagda/påslagna.`);
}

main()
  .catch((e) => {
    console.error("[handles] Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
