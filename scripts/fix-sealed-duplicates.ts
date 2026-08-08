/**
 * Åtgärdar de GRANSKADE fynden ur audit-sealed-duplicates.ts + audit-store-links.ts.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-sealed-duplicates.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-sealed-duplicates.ts --apply
 *
 * ⛔ EXPLICIT LISTA, ALDRIG EN REGEL. Samma disciplin som merge-verified-duplicates.ts:
 *    en felaktig LÄNK syns och rättas, en felaktig SAMMANSLAGNING raderar en katalogpost
 *    med prishistorik som inte går att återskapa (grafen byggs bara framåt). Varje rad
 *    här bär därför sitt eget bevis, och bevisen kommer från MINST TVÅ oberoende håll.
 *
 * ⛔ Automatiken som hittade raderna hade fel två gånger innan den blev användbar
 *    (era-namn lästes som set, butikers `<title>` bar reklamtext). Det är precis därför
 *    ingenting slås ihop på en poäng — bara på granskade rader.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");

/**
 * DUBBLETTER — samma vara två gånger.
 * BEVIS för båda: (1) samma Cardmarket-idProduct, (2) samma CM-bild, och (3) Cardmarkets
 * egen sealed-katalog har INGEN "long crimp"-produkt — det finns exakt en
 * `Base Set 2 Booster` (271865) och en `Team Rocket Booster` (271874). "Long crimp" är
 * alltså Samlarhobbys egen beskrivning av skicket, inte en egen SKU.
 * Överlevaren är i båda fallen den med dubbelt så lång prishistorik och setkopplingen.
 */
const MERGE: { stubSlug: string; canonicalSlug: string; proof: string }[] = [
  {
    stubSlug: "pokemon-base-set-2-long-crimp-1-booster",
    canonicalSlug: "base-set-2-base4-booster-pack",
    proof: "båda → CM idProduct 271865; CM har ingen long crimp-produkt; 23 mot 55 snapshots",
  },
  {
    stubSlug: "pokemon-team-rocket-long-crimp-1-booster",
    canonicalSlug: "team-rocket-base5-booster-pack",
    proof: "båda → CM idProduct 271874; CM har ingen long crimp-produkt; 23 mot 55 snapshots",
  },
  {
    stubSlug: "pokemon-sv10-5-black-bolt-white-flare-white-flare-bundle",
    canonicalSlug: "white-flare-booster-bundle",
    proof: "båda → CM idProduct 824108 + samma CM-bild; 32 mot 49 snapshots; kanonisk har 9 butikslänkar",
  },
];

/** Andra omgången — se JUDGE_MERGE nedan. */

/**
 * FELAKTIGA BUTIKSLÄNKAR — sidan säljer bevisligen en ANNAN vara.
 * Varje rad verifierad genom att hämta butikens egen sida och läsa dess produktnamn
 * (Shopifys `.js` / JSON-LD / og:title), och priset pekar åt samma håll.
 */
const JUDGE_MERGE: { stubSlug: string; canonicalSlug: string; cm: string }[] = [
  // ---- LLM-domarens omgång (2026-08-08), ägargodkänd ----
  // Alla tio är butiksstubbar UTAN prishistorik (0 snapshots på minst en sida), och
  // skillnaden är ren formulering: HTML-entiteter, "(Engelsk)", ett era-prefix, eller
  // två stavningar av samma japanska set. Ingenting oersättligt går förlorat.
  // ⛔ Domaren fick INTE bestämma ensam. Den kallade också "(US Version)"-paren och
  //    [GVSE]/[LUJF]-boxkonsten "samma produkt" — båda är dokumenterat OLIKA varor
  //    (regionVersionMismatch respektive project-evolving-skies-eeveelution-tags), och
  //    de är med flit UTELÄMNADE här.
  { stubSlug: "pokemon-mega-evolution-chaos-rising-3-pack-blister", canonicalSlug: "pokemon-mega-evolutions-chaos-rising-3-pack-blister", cm: "domaren: samma; ren stavningsskillnad" },
  { stubSlug: "pokemon-destined-rivals-booster-pack", canonicalSlug: "pokemon-sv10-destined-rivals-booster-pack", cm: "domaren: samma; SV10 är era-prefix, inte en annan vara" },
  { stubSlug: "pokemon-mega-nihil-zero-booster-pack-m3-japansk", canonicalSlug: "pokemon-mega-nullifying-zero-nihil-zero-booster-pack-m3-japansk", cm: "domaren: samma; två översättningar av samma japanska set (M3)" },
  { stubSlug: "pokemon-ascended-heroes-mini-tin-engelsk", canonicalSlug: "pokemon-ascended-heroes-mini-tin", cm: "domaren: samma; '(Engelsk)' är butiksbrus" },
  { stubSlug: "pokemon-enhanced-2-pack-blister-oddish-gloom-038-vileplume", canonicalSlug: "pokemon-enhanced-2-pack-blister-oddish-gloom-vileplume", cm: "domaren: samma; skillnaden är HTML-entiteten &#038;" },
  { stubSlug: "pokemon-heat-wave-arena-booster-box-japanese", canonicalSlug: "heat-wave-arena-booster-box-japansk", cm: "domaren: samma; (Japansk) mot (Japanese)" },
  { stubSlug: "pokemon-prismatic-evolutions-pokemon-center-elite-trainer-box", canonicalSlug: "pokemon-scarlet-violet-pokemon-center-prismatic-evolutions-elite-trainer-box", cm: "domaren: samma; enbart ordföljd" },
  { stubSlug: "pokemon-chaos-rising-booster-pack-2yv6", canonicalSlug: "pokemon-chaos-rising-booster-pack", cm: "domaren: samma; Pokémon mot Pokemon" },
  { stubSlug: "pokemon-classic-collection-box-japansk-o5zu", canonicalSlug: "pokemon-classic-collection-box-japansk", cm: "domaren: samma; IDENTISKA titlar, två rader" },
  { stubSlug: "pokemon-scarlet-violet-151-booster-bundle-mew", canonicalSlug: "pokemon-scarlet-violet-mew-151-booster-bundle", cm: "domaren: samma; enbart ordföljd (MEW)" },
];

const WRONG_LINKS: { urlContains: string; productSlugContains: string; sells: string; proof: string }[] = [
  { urlContains: "hobbykort.se/products/pokemon-scarlet-violet-base-set-booster-pack", productSlugContains: "base-set-2-base4-booster-pack", sells: "Pokémon SV1: Base Set Booster Pack", proof: "79 kr mot CM 3 275 kr (2,4 %); sidan säljer SV1, inte Base Set 2" },
  { urlContains: "hobbykort.se/products/pokemon-scarlet-violet-booster-display", productSlugContains: "base-set-2", sells: "Pokémon SV1: Base Set Booster Box", proof: "2 599 kr mot CM 118 224 kr (2,2 %); sidan säljer SV1" },
  { urlContains: "beamcardshop.com/products/sun-moon-base-booster-pack", productSlugContains: "base-set-2-base4-booster-pack", sells: "Pokémon Sun & Moon Base Set Booster Pack", proof: "197 kr mot CM 3 275 kr (6 %); sidan säljer Sun & Moon" },
  { urlContains: "cardclub.se/products/iron-treads-ex-073", productSlugContains: "iron-treads-ex-tin", sells: "Iron Treads ex 073 (ETT KORT)", proof: "30 kr mot CM 701 kr; sidan säljer ett singelkort, inte en tin" },
  { urlContains: "miniaturemetropolis.se/products/pokemon-tcg-mega-evolution-5-premium-checklane", productSlugContains: "evolving-skies", sells: "Mega Evolution 5 Premium Checklane Luxray", proof: "13 % av CM; sidan säljer Mega Evolution, vår produkt är Evolving Skies" },
  { urlContains: "spelgalaxen.se", productSlugContains: "30th-celebration", sells: "Pokémon Plush Figure Mew 20 cm", proof: "16 % av CM; sidan säljer ett GOSEDJUR, inte en figursamling" },
];

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "TORRKÖRNING — inget skrivs. Kör med --apply.\n");

  console.log("── DUBBLETTER ────────────────────────────────────────────────────────────");
  let merged = 0;
  for (const m of [...MERGE, ...JUDGE_MERGE.map((j) => ({ stubSlug: j.stubSlug, canonicalSlug: j.canonicalSlug, proof: j.cm }))]) {
    const stub = await prisma.product.findUnique({ where: { slug: m.stubSlug }, select: { id: true, title: true, _count: { select: { watchlistItems: true, collectionItems: true } } } });
    const canon = await prisma.product.findUnique({ where: { slug: m.canonicalSlug }, select: { id: true, title: true } });
    if (!stub || !canon) { console.log(`  hoppar (saknas): ${m.stubSlug}`); continue; }
    console.log(`  ${APPLY ? "MERGAR" : "skulle merga"}: "${stub.title}"\n     → "${canon.title}"\n     bevis: ${m.proof}`);
    if (stub._count.watchlistItems || stub._count.collectionItems) {
      console.log(`     (flyttar ${stub._count.watchlistItems} bevakningar + ${stub._count.collectionItems} samlingsposter)`);
    }
    if (APPLY) { await mergeStubInto(stub.id, canon.id, () => {}); merged++; }
  }

  console.log("\n── FELAKTIGA BUTIKSLÄNKAR ────────────────────────────────────────────────");
  let removed = 0;
  for (const w of WRONG_LINKS) {
    const offers = await prisma.offer.findMany({
      where: { url: { contains: w.urlContains }, product: { slug: { contains: w.productSlugContains } } },
      select: { id: true, url: true, price: true, product: { select: { title: true } }, retailer: { select: { name: true } } },
    });
    if (!offers.length) { console.log(`  hoppar (ingen träff): ${w.urlContains}`); continue; }
    for (const o of offers) {
      console.log(`  ${APPLY ? "TAR BORT" : "skulle ta bort"}: ${o.retailer.name} på "${o.product.title}"`);
      console.log(`     sidan säljer: ${w.sells}`);
      console.log(`     bevis: ${w.proof}`);
      if (APPLY) { await prisma.offer.delete({ where: { id: o.id } }); removed++; }
    }
  }

  if (APPLY && (merged || removed)) {
    // GOTCHA (2026-07-13): utan omräkning står rubrikpriset kvar på det borttagna
    // erbjudandets värde. Katalogbred SQL, inga argument.
    await recomputeProductPriceCache();
    console.log(`\nPriscachen omräknad.`);
  }
  console.log(`\n${merged} sammanslagna, ${removed} felaktiga länkar borttagna.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
