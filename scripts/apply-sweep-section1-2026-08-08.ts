/**
 * Verkställer SEKTION 1 (säkra dubbletter) och SEKTION 3 (sortiment/random-tins) ur
 * katalogsvepningen 2026-08-08 (Catalog-sweep-2026-08-08.txt hos ägaren).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-sweep-section1-2026-08-08.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-sweep-section1-2026-08-08.ts --apply
 *
 * Sektion 2 (ägaren väljer mål) och 4 (GTIN-kontaminering) verkställs INTE här.
 * Två par ur sektion 1 är MEDVETET utelämnade i väntan på ägaren:
 *   · "151 Booster Box" → "(Japansk)" — markerad VERIFY i rapporten.
 *   · ME4 Chaos Rising Premium Checklane (GTIN-paret) — delade checklane-koder har
 *     bevisad kontaminering (sektion 4), och dubbletten bär MER historik än målet.
 *
 * Samma mekanik som apply-owner-catalog-cleanup: dubblettens CM-offer raderas aldrig
 * automatiskt HÄR (till skillnad från ägarrundan) — den flyttas bara om målet saknar
 * CM-offer, annars faller den bort i mergeStubInto:s konfliktregel. Stubbarna är
 * butiksskapade och saknar nästan alltid CM ändå; dry-run redovisar varje undantag.
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");

const MERGES: { dup: string; target: string }[] = [
  { dup: "151-pokemon-center-elite-trainer-box-tvo3", target: "151-pokemon-center-elite-trainer-box" },
  { dup: "pokemon-scarlet-violet-ruler-of-the-black-flame-booster-pack-japanskt", target: "pokemon-scarlet-violet-ruler-of-the-black-booster-pack-japansk" },
  { dup: "pokemon-sword-shield-silver-lance-booster-box", target: "pokemon-sword-shield-silver-lance-booster-box-japansk" },
  { dup: "pokemon-scarlet-violet-battle-partner-booster-box", target: "pokemon-scarlet-violet-battle-partners-booster-box-sv9-japansk" },
  { dup: "pokemon-storm-emeralda-booster-box", target: "pokemon-mega-storm-emeralda-booster-box-japansk" },
  { dup: "pokemon-scarlet-violet-paradise-dragona-booster-box", target: "pokemon-scarlet-violet-paradise-dragona-sv7a-display-booster-box-japansk" },
  { dup: "pokemon-scarlet-violet-pokemon-center-prismatic-evolutions-elite-trainer-box", target: "prismatic-evolutions-pokemon-center-elite-trainer-box" },
  { dup: "pokemon-scarlet-violet-pokemon-center-destined-rivals-elite-trainer-box", target: "destined-rivals-pokemon-center-elite-trainer-box" },
  { dup: "pokemon-mega-evolution-pokemon-center-ascended-heroes-elite-trainer-box", target: "ascended-heroes-pokemon-center-elite-trainer-box" },
  { dup: "white-flare-deluxe-booster-box-japansk", target: "pokemon-white-flare-deluxe-booster-box-display-sv11w-japansk" },
  { dup: "black-bolt-deluxe-booster-box-japansk", target: "pokemon-black-bolt-deluxe-booster-box-display-sv11b-japansk" },
  { dup: "black-bolt-booster-pack-japansk", target: "pokemon-scarlet-violet-black-bolt-sv11b-1-booster-pack-japansk" },
  { dup: "pokemon-chaos-rising-sleeved-blister", target: "pokemon-me4-chaos-rising-sleeved-booster-iphuy" },
  { dup: "pokemon-scarlet-violet-base-sleeved-booster-pack", target: "scarlet-violet-sleeved-booster" },
  { dup: "pokemon-chaos-rising-booster-pack", target: "pokemon-tcg-mega-evolution-chaos-rising-booster-pack-iphwo" },
  { dup: "pokemon-destined-rivals-booster-pack-d1ki", target: "pokemon-tcg-scarlet-violet-destined-rivals-booster-pack-iphwl" },
  { dup: "destined-rivals-sv10-booster-pack", target: "pokemon-tcg-scarlet-violet-destined-rivals-booster-pack-iphwl" },
  { dup: "sword-shield-base-set-booster-box", target: "sword-shield-swsh1-booster-box" },
  { dup: "pokemon-scarlet-violet-checklane-blister-pack-espathra", target: "scarlet-violet-espathra-1-pack-blister" },
  { dup: "pokemon-30th-celebration-booster-box-japansk", target: "forbokning-pokemon-30th-anniversary-celebration-m6-mega-booster-box-japansk" },
  { dup: "pokemon-scarlet-violet-base-set-booster-pack-engelska", target: "pokemon-tcg-scarlet-violet-booster-pack" },
  { dup: "pokemon-mega-evolution-mega-brave-booster-box", target: "pokemon-mega-brave-m1l-booster-box-japanese" },
  { dup: "pokemon-mega-evolution-mega-brave-booster-pack", target: "pokemon-tcg-mega-brave-booster-pack-japansk-m1l" },
  { dup: "mega-brave-m1b-booster-pack-japanskt", target: "pokemon-tcg-mega-brave-booster-pack-japansk-m1l" },
  { dup: "shiny-treasure-ex-booster-box-japansk", target: "pokemon-scarlet-violet-shiny-treasure-ex-sv4a-booster-box-japanese" },
  { dup: "shiny-treasure-ex-booster-pack-japansk", target: "pokemon-tcg-scarlet-violet-high-class-pack-shiny-treasure-ex-sv4a-japansk-booster" },
  // Ägarens svar 2026-08-08 på verify-paret: BÅDA 151-boxarna är den japanska sv2a-displayen.
  { dup: "151-booster-box", target: "pokemon-scarlet-violet-pokemon-151-sv2a-display-booster-box-japansk" },
  { dup: "151-booster-box-japansk", target: "pokemon-scarlet-violet-pokemon-151-sv2a-display-booster-box-japansk" },
];

const DELETES: { slug: string; why: string }[] = [
  { slug: "pokemon-ascended-heroes-mini-tin", why: "1st random tin — URL:erna redan denylistade av ägaren" },
  { slug: "crown-zenith-mini-tin", why: "generiskt sortiment (random tin)" },
  { slug: "pokemon-black-white-mini-tin", why: "generiskt sortiment (random tin)" },
  { slug: "pokemon-mega-heroes-mini-tin", why: "generiskt sortiment (random tin ur Mega Heroes-linjen)" },
  { slug: "pokemon-mega-evolution-mega-heroes-mini-tin", why: "generiskt sortiment (random tin)" },
  { slug: "mega-heroes-mini-tin-2-pack", why: "generiskt sortiment (2 random tins)" },
];

const pick = {
  id: true, title: true, setId: true,
  offers: { select: { id: true, url: true, retailer: { select: { name: true } } } },
  _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
} as const;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");
  const denylistUrls: string[] = [];
  let merged = 0, deleted = 0, warned = 0;

  for (const m of MERGES) {
    const [dup, target] = await Promise.all([
      prisma.product.findUnique({ where: { slug: m.dup }, select: pick }),
      prisma.product.findUnique({ where: { slug: m.target }, select: pick }),
    ]);
    if (!dup) { console.log(`  · redan borta: ${m.dup}`); continue; }
    if (!target) { console.log(`  ⛔ MÅL SAKNAS: ${m.target}`); warned++; continue; }
    const dupCm = dup.offers.some((o) => o.retailer.name === "Cardmarket");
    const targetCm = target.offers.some((o) => o.retailer.name === "Cardmarket");
    console.log(`\n  "${dup.title}"  [${dup._count.priceSnapshots} snap${dupCm ? ", CM" : ""}${dup.setId ? ", set" : ""}]`);
    console.log(`   → "${target.title}"  [${target._count.priceSnapshots} snap${targetCm ? ", CM" : ""}${target.setId ? ", set" : ""}, ${target.offers.length} offers]`);
    if (dup._count.priceSnapshots > target._count.priceSnapshots) {
      console.log("     ⚠️ dubbletten har MER historik än målet — granska!");
      warned++;
    }
    if (dupCm && !targetCm) console.log("     ℹ dubblettens CM-offer FLYTTAS till målet (målet saknar CM)");
    if (!APPLY) continue;
    await mergeStubInto(dup.id, target.id, () => {});
    merged++;
    console.log("     ✓ hopslagen");
  }

  console.log("\n════════ DELETES (sortiment) ════════");
  for (const d of DELETES) {
    const prod = await prisma.product.findUnique({ where: { slug: d.slug }, select: { ...pick, category: true } });
    if (!prod) { console.log(`  · redan borta: ${d.slug}`); continue; }
    console.log(`\n  [${prod.category}] ${prod.title}   (${d.why})`);
    console.log(`     offers: ${prod.offers.length}, bevakningar: ${prod._count.watchlistItems}, samlingar: ${prod._count.collectionItems}`);
    for (const o of prod.offers) {
      console.log(`       ${o.retailer.name}: ${o.url}`);
      if (o.url && o.retailer.name !== "Cardmarket" && o.retailer.name !== "Tradera") denylistUrls.push(o.url);
    }
    if (prod._count.collectionItems > 0) { console.log("     ⚠️ ägs i samling — hoppar över"); warned++; continue; }
    if (!APPLY) continue;
    await prisma.traderaMatch.deleteMany({ where: { productId: prod.id } });
    await prisma.dedupeVerdict.deleteMany({ where: { OR: [{ productAId: prod.id }, { productBId: prod.id }] } });
    await prisma.product.delete({ where: { id: prod.id } });
    deleted++;
    console.log("     ✓ raderad");
  }

  console.log(`\n${APPLY ? "Utfört" : "Skulle utföras"}: ${merged} merges, ${deleted} raderingar, ${warned} varningar.`);
  if (denylistUrls.length) {
    console.log("\n── Lägg till i import-denylist.ts ──");
    for (const u of denylistUrls) console.log(`    "${u}",`);
  }
  if (APPLY && (merged > 0 || deleted > 0)) {
    await recomputeProductPriceCache();
    console.log("\nPrisscachen omräknad.");
  }
}

main().finally(() => prisma.$disconnect());
