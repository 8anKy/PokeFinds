/**
 * STÄDNING AV WAVE 5-KOHORTEN (2026-08-13) — de två BEVISADE klasserna.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-new-product-cleanup-2026-08-13.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-new-product-cleanup-2026-08-13.ts --apply
 *
 * Bakgrund: täckningsrevisionen + wave 5 lät auto-importen skapa 898 katalogprodukter
 * på en natt. Revisionen (`scripts/audit-new-products.ts`) hittade tre klasser; det
 * här skriptet verkställer bara de två där beviset är MEKANISKT, inte en bedömning:
 *
 *   A. BLOCKERAT SPRÅK (118) — 81 koreanska "(KOR)" + 37 kinesiska "[S-CHN]/[T-CHN]".
 *      Detektorn kände bara "(KR)" respektive "cn|ch|tw|hk", så de importerades med
 *      language: EN och blev restock-bevakade. Vakten är lagad (listing-language.ts,
 *      testad), men en lagad vakt raderar ingen befintlig rad — den blockerar bara
 *      återimport. Raderingen körs därför av det befintliga `purge-blocked-language.ts`,
 *      som grindar på EXAKT samma funktion (aldrig på `language`-kolumnen — den ljuger
 *      just här, se skriptets egen historik).
 *
 *   B. IDENTISK STÄDAD TITEL (171 grupper / 172 rader) — samma SKU två gånger. Två
 *      källor: Rogerz listar varje begagnad vara under BÅDA danska momsordningarna
 *      ("… / Brugtmoms" och "… / Alm. moms"), och Aquitaz har enstaka självdubbletter
 *      på två URL:er. `cleanListingTitle` städar numera bort momstaggen, så framtida
 *      import länkar i stället för att skapa — men de 172 som redan ligger inne måste
 *      slås ihop för hand.
 *
 * ⛔ VAD SKRIPTET INTE GÖR: de 74 par som BARA en LLM-domare kallar dubbletter, och
 *    de 41 rader där bara en av källorna flaggar. En felaktig LÄNK syns och rättas;
 *    en felaktig SAMMANSLAGNING raderar en katalogpost. De listorna kräver ägarens
 *    blick (se rapporten) — samma regel som `merge-verified-duplicates.ts` bär.
 *
 * ⛔ BEVISET TAS PÅ RÅTITELN, inte på Dice-poängen. `dedupe-catalog.ts` godkände en
 *    gång "Mega Charizard X ex Tin" == "Mega Charizard Y ex Tin" på 1,00. Här krävs
 *    att titlarna är TECKEN FÖR TECKEN lika sedan känt butiksbrus (momstagg,
 *    omslagskonst) och accenter fällts — kontrollerat 2026-08-13: 168 grupper var
 *    exakt lika, 3 skilde bara på "Pokémon"/"Pokemon".
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { normalizeTitle } from "../src/lib/utils";
import { cleanListingTitle } from "../src/scrapers/matching";
import { detectListingLanguage, isBlockedListingLanguage } from "../src/lib/listing-language";
import { isDeniedListingUrl } from "../src/scrapers/import-denylist";
import { orphanedOfferUrls } from "./lib/owner-decisions";

const APPLY = process.argv.includes("--apply");
const SINCE = new Date("2026-08-13T00:00:00.000Z");

/** Känt butiksbrus som INTE är produktidentitet — måste matcha LISTING_TITLE_JUNK. */
const KNOWN_JUNK = /\s*[-–—/|]\s*(?:brugtmoms|alm\.?\s*moms)\b|\([^)]*\b(?:artwork|art)\b[^)]*\)/gi;
/** Råtitel utan känt brus, accenter eller skiftläge — beviskravet för en merge. */
const bareTitle = (s: string) =>
  s
    .replace(KNOWN_JUNK, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  console.log(`DB: ${db} — ${APPLY ? "APPLY (skriver)" : "DRY-RUN"}\n`);

  const products = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true,
      title: true,
      slug: true,
      language: true,
      createdAt: true,
      offers: {
        select: { url: true, retailerId: true, condition: true, language: true, retailer: { select: { name: true } } },
      },
      _count: { select: { priceSnapshots: true, watchlistItems: true, collectionItems: true } },
    },
  });
  const isNew = (p: (typeof products)[number]) => p.createdAt >= SINCE;
  console.log(`${products.length} sealed-produkter, varav ${products.filter(isNew).length} skapade ≥ ${SINCE.toISOString().slice(0, 10)}.\n`);

  // ── A. BLOCKERAT SPRÅK ─────────────────────────────────────────────────────
  console.log("═".repeat(70));
  console.log("A. BLOCKERAT SPRÅK (katalogen är EN + JP)");
  console.log("═".repeat(70));
  const blocked = products.filter(
    (p) => isBlockedListingLanguage(p.title) || p.offers.some((o) => isBlockedListingLanguage(p.title, o.url))
  );
  const byLang = new Map<string, typeof blocked>();
  for (const p of blocked) {
    const l = detectListingLanguage(p.title, p.offers[0]?.url ?? null);
    byLang.set(l, [...(byLang.get(l) ?? []), p]);
  }
  for (const [l, ps] of byLang) {
    const held = ps.filter((p) => p._count.watchlistItems + p._count.collectionItems > 0);
    console.log(`  ${l}: ${ps.length} produkter${held.length ? `  ⚠ ${held.length} i någons bevakning/samling` : ""}`);
    for (const p of ps.slice(0, 4)) console.log(`     ${p.title}`);
    if (ps.length > 4) console.log(`     … ${ps.length - 4} till`);
  }
  console.log(
    `\n  → Raderas INTE här. Kör det befintliga verktyget, som grindar på samma funktion:\n` +
      `    node scripts/with-prod-db.mjs npx tsx scripts/purge-blocked-language.ts          (visa)\n` +
      `    node scripts/with-prod-db.mjs env APPLY=1 npx tsx scripts/purge-blocked-language.ts  (radera)`
  );

  // ── B. IDENTISK STÄDAD TITEL ───────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("B. BEVISADE DUBBLETTER (identisk städad titel)");
  console.log("═".repeat(70));
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const k = normalizeTitle(cleanListingTitle(p.title));
    if (k.length < 4) continue;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  type Merge = { drop: (typeof products)[number]; keep: (typeof products)[number] };
  const merges: Merge[] = [];
  const skipped: { group: typeof products; why: string }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Bara grupper som RÖR kohorten — vi städar inte om hela katalogen på köpet.
    if (!group.some(isNew)) continue;
    // ⛔ BEVISKRAVET: råtitlarna måste vara lika sedan känt brus fällts.
    if (new Set(group.map((p) => bareTitle(p.title))).size !== 1) {
      skipped.push({ group, why: "råtitlarna skiljer sig — kräver mänsklig blick" });
      continue;
    }
    // Behåll den rikaste posten: historik > offers > äldst (en gammal slug är publicerad).
    const sorted = [...group].sort(
      (x, y) =>
        y._count.priceSnapshots - x._count.priceSnapshots ||
        y.offers.length - x.offers.length ||
        x.createdAt.getTime() - y.createdAt.getTime()
    );
    const keep = sorted[0];
    // ⛔ Behåll aldrig en NY stub framför en äldre post: slugen på den gamla är
    //    publicerad och kan ligga i sökmotorer, bevakningar och Discord-inlägg.
    const older = sorted.find((p) => !isNew(p));
    const winner = older ?? keep;
    for (const drop of sorted) if (drop.id !== winner.id) merges.push({ drop, keep: winner });
  }

  console.log(`  ${merges.length} rader ska slås ihop (${new Set(merges.map((m) => m.keep.id)).size} mål).`);
  const held = merges.filter((m) => m.drop._count.watchlistItems + m.drop._count.collectionItems > 0);
  const withHistory = merges.filter((m) => m.drop._count.priceSnapshots > 0);
  console.log(`  varav ${held.length} har bevakning/samling (följer med till målet) och ${withHistory.length} har prishistorik.`);
  if (skipped.length) {
    console.log(`\n  ⚠ ${skipped.length} grupp(er) HOPPAS ÖVER (beviskravet ej uppfyllt):`);
    for (const s of skipped.slice(0, 10)) {
      console.log(`     ${s.why}`);
      for (const p of s.group) console.log(`        ${isNew(p) ? "NY " : "old"} ${JSON.stringify(p.title)}`);
    }
  }
  // ⛔ HERRELÖSA URL:er (upptäckt 2026-08-13 av apply-owner-decisions.ts torrkörning).
  //    `Offer` är unik på (produkt, butik, skick, språk), så stubbens offer RADERAS av
  //    mergen när målet redan har en från samma butik. Rogerz momstvillingar har olika
  //    `?variant=`-URL:er och olika pris — den förlorande URL:en matchar efter
  //    titeltvätten numera MÅLET, så nästa skrapning skriver över målets offer och
  //    länk/pris börjar växla mellan de två listningarna vid varje körning.
  const orphans: { url: string; store: string; from: string }[] = [];
  for (const m of merges) {
    const dropKeys = m.drop.offers.map((o) => ({ ...o, retailerName: o.retailer.name }));
    for (const url of orphanedOfferUrls(dropKeys, m.keep.offers)) {
      orphans.push({ url, store: m.drop.offers.find((o) => o.url === url)?.retailer.name ?? "—", from: m.drop.title });
    }
  }
  const needDeny = orphans.filter((o) => !isDeniedListingUrl(o.url));
  if (needDeny.length) {
    console.log(`\n  ⚠ ${needDeny.length} butiks-URL blir herrelös av mergen och måste denylistas.`);
    console.log(`     Skriv in dem med scripts/apply-owner-decisions.ts --write-denylist, eller`);
    console.log(`     acceptera att länk/pris växlar mellan momsvarianterna på de produkterna.`);
    for (const o of needDeny.slice(0, 5)) console.log(`     ${o.store}: ${o.url}`);
    if (needDeny.length > 5) console.log(`     … ${needDeny.length - 5} till`);
  }

  console.log("");
  for (const m of merges.slice(0, 25)) {
    console.log(`  ✗ ${m.drop.title}`);
    console.log(`    → ${m.keep.title}  [${m.keep._count.priceSnapshots} snap, ${m.keep.offers.length} offer]`);
  }
  if (merges.length > 25) console.log(`  … ${merges.length - 25} till`);

  // ── C. TVÄTTA BORT MOMSTAGGEN UR DE ÖVERLEVANDE TITLARNA ───────────────────
  // Efter mergen står "Jungle Booster Pack - Unlimited - Scyther / Alm. moms" kvar
  // som KATALOGNAMN på en svensk sajt — dansk momsadministration som produktnamn.
  // ⛔ Bara momstaggen strippas, inte hela cleanListingTitle: den fäller även
  //    TCG-prefix och omslagsparenteser, och en bred omtvätt av befintliga titlar är
  //    en annan ändring än den här.
  // ⛔ Slugen rörs ALDRIG (publicerade URL:er) — samma regel som adoptCmName.
  const VAT_ONLY = /\s*[-–—/|]\s*(?:brugtmoms|alm\.?\s*moms)\b/gi;
  const survivors = products.filter(
    (p) => !merges.some((m) => m.drop.id === p.id) && VAT_ONLY.test(p.title)
  );
  const retitles = survivors
    .map((p) => ({ p, title: p.title.replace(VAT_ONLY, " ").replace(/\s{2,}/g, " ").replace(/[\s,/|–—-]+$/g, "").trim() }))
    .filter((r) => r.title.length >= 4 && r.title !== r.p.title);
  console.log("\n" + "═".repeat(70));
  console.log(`C. TVÄTTA MOMSTAGGEN UR ${retitles.length} KVARVARANDE KATALOGNAMN (slug orörd)`);
  console.log("═".repeat(70));
  for (const r of retitles.slice(0, 8)) console.log(`  "${r.p.title}"\n   → "${r.title}"`);
  if (retitles.length > 8) console.log(`  … ${retitles.length - 8} till`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — ingenting skrivet. --apply kör B + C (A körs separat, se ovan).`);
    return;
  }

  let ok = 0;
  for (const m of merges) {
    try {
      await mergeStubInto(m.drop.id, m.keep.id, () => {});
      ok++;
      if (ok % 25 === 0) process.stdout.write(`  ${ok}/${merges.length}\r`);
    } catch (err) {
      console.error(`  FEL vid merge av ${m.drop.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n🔀 ${ok}/${merges.length} sammanslagna.`);

  let renamed = 0;
  for (const r of retitles) {
    // Produkten kan ha mergats bort i loopen ovan — hoppa tyst över den då.
    const still = await prisma.product.findUnique({ where: { id: r.p.id }, select: { id: true } });
    if (!still) continue;
    await prisma.product.update({
      where: { id: r.p.id },
      data: { title: r.title, normalizedTitle: normalizeTitle(r.title) },
    });
    renamed++;
  }
  console.log(`🏷  ${renamed} katalognamn tvättade (slug orörd).`);
  console.log(
    `   Kör därefter: node scripts/with-prod-db.mjs npx tsx scripts/recompute-price-cache.ts\n` +
      `   och exportera om ruttabellen (scripts/export-restock-routes.ts) så Discord-lanen\n` +
      `   inte pekar på raderade produkt-id:n.`
  );
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
