/**
 * Verkställer ägarens ANDRA svarsomgång på katalogsvepningen (2026-08-08, chatten):
 * vintage-generikerna + kvarvarande enstycksfrågor. Samma mekanik som
 * apply-owner-sweep-answers-2026-08-08.ts.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-sweep-answers-2-2026-08-08.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-sweep-answers-2-2026-08-08.ts --apply
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");

const MERGES: { dups: string[]; target: string }[] = [
  { dups: ["detective-pikachu-checklane-blister"], target: "detective-pikachu-2-pack-blister" },
  { dups: ["brilliant-stars-checklane-blister-3-promos-bagon"], target: "brilliant-stars-salamence-premium-checklane-blister" },
  { dups: ["unbroken-bonds-3-pack-blister"], target: "unbroken-bonds-typhlosion-3-pack-blister" },
  { dups: ["team-up-checklane-blister"], target: "team-up-pikachu-1-pack-blister" },
  { dups: ["pokemon-xy-evolutions-3-pack-blister"], target: "evolutions-black-kyurem-3-pack-blister" },
  { dups: ["checklane-blister-2-pack-fusion-strike"], target: "enhanced-2-pack-blister-genie-trio" },
  { dups: ["brilliant-stars-checklane-blister-3-promos-deino"], target: "brilliant-stars-hydreigon-premium-checklane-blister" },
  { dups: ["pokemon-xy-evolutions-blastoise-elite-trainer-box"], target: "evolutions-xy12-elite-trainer-box" },
  { dups: ["pokemon-scarlet-violet-10-5-black-bolt-white-flare-mini-tin"], target: "black-bolt-white-flare-unova-eelektross-mini-tin" },
  { dups: ["pokemon-enhanced-2-pack-blister-oddish-gloom-vileplume"], target: "pokemon-tcg-mega-evolution-enhanced-2-pack-blister-vileplume-jqp9q" },
];

const DELETES: { slug: string; why: string }[] = [
  { slug: "xy-3-pack-blister-xerneas-xy-breakthrough", why: "ägaren: radera" },
  { slug: "black-bolt-white-flare-booster-box-bundle-japansk", why: "ägaren: radera (butiksbundle av två boxar)" },
  { slug: "black-bolt-white-flare-deluxe-booster-box-bundle-japansk", why: "ägaren: radera (butiksbundle av två boxar)" },
  { slug: "pokemon-mega-charizard-ex-y-x-tin-2026", why: "ägaren: radera (Y & X i samma listning)" },
  { slug: "pokemon-scarlet-violet-black-white-elite-trainer-box", why: "ägaren: radera (säljer BÅDA ETB:erna i samma listning)" },
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

  for (const g of MERGES) {
    const target = await prisma.product.findUnique({ where: { slug: g.target }, select: pick });
    if (!target) { console.log(`⛔ MÅL SAKNAS: ${g.target}`); warned++; continue; }
    for (const dupSlug of g.dups) {
      const dup = await prisma.product.findUnique({ where: { slug: dupSlug }, select: pick });
      if (!dup) { console.log(`  · redan borta: ${dupSlug}`); continue; }
      const dupCm = dup.offers.filter((o) => o.retailer.name === "Cardmarket");
      console.log(`\n  "${dup.title}"  [${dup._count.priceSnapshots} snap]`);
      console.log(`   → "${target.title}"  [${target._count.priceSnapshots} snap, ${target.offers.length} offers${target.setId ? ", set" : ""}]`);
      if (dupCm.length) console.log(`     CM-offer på dubbletten RADERAS: ${dupCm.map((o) => o.url).join(" · ")}`);
      if (dup._count.priceSnapshots > target._count.priceSnapshots) {
        console.log("     ⚠️ dubbletten har MER historik än målet");
        warned++;
      }
      if (!APPLY) continue;
      if (dupCm.length) await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
      await mergeStubInto(dup.id, target.id, () => {});
      merged++;
      console.log("     ✓ hopslagen");
    }
  }

  console.log("\n════════ DELETES ════════");
  for (const d of DELETES) {
    const prod = await prisma.product.findUnique({ where: { slug: d.slug }, select: pick });
    if (!prod) { console.log(`  · redan borta: ${d.slug}`); continue; }
    console.log(`\n  ${prod.title}   (${d.why})`);
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
