/**
 * Verkställer ägarens SVAR på katalogsvepningens sektion 2 (2026-08-08, chatten):
 * generiska blister-stubbar in i den karaktärsprodukt ägaren pekat ut, plus två
 * raderingar. Samma mekanik som apply-owner-catalog-cleanup-2026-08-08.ts:
 * dubblettens CM-offer raderas före merge (målet bär rätt CM-länk), raderade
 * produkters butiks-URL:er skrivs ut för import-denylist.ts.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-sweep-answers-2026-08-08.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-sweep-answers-2026-08-08.ts --apply
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");

const MERGES: { dups: string[]; target: string; takeImage?: boolean }[] = [
  {
    dups: ["astral-radiance-checklane-blister-totodile", "pokemon-swsh10-astral-radiance-premium-checklane-blister-pack"],
    target: "astral-radiance-feraligatr-premium-checklane-blister",
  },
  { dups: ["pokemon-sv2-paldea-evolved-3-pack-blister"], target: "paldea-evolved-tinkatink-3-pack-blister" },
  {
    dups: ["mega-evolution-2-pack-blister"],
    target: "zarude-2-pack-blister-version-1",
    takeImage: true, // ägaren: "give it an image"
  },
  {
    dups: [
      "enhanced-2-pack-blister-pack-2026",
      "pokemon-enhanced-2-pack-blister",
      "pokemon-mega-evolutions-perfect-order-enhanced-2-pack-blister",
    ],
    target: "pokemon-tcg-mega-evolution-enhanced-2-pack-blister-vileplume-jqp9q",
  },
  { dups: ["pokemon-mega-evolution-perfect-order-checklane-1-pack-blister"], target: "perfect-order-makuhita-1-pack-blister" },
  { dups: ["pokemon-me02-phantasmal-flames-checklane-blister"], target: "phantasmal-flames-cottonee-1-pack-blister" },
  { dups: ["pokemon-pitch-black-checklane-blister"], target: "pitch-black-slowpoke-1-pack-blister" },
  { dups: ["pokemon-tcg-scarlet-violet-10-destined-rivals-checklane-blister"], target: "destined-rivals-eevee-1-pack-blister" },
  { dups: ["pokemon-tcg-scarlet-violet-journey-together-premium-checklane-blister"], target: "scarlet-violet-gengar-premium-checklane-blister" },
  {
    dups: ["pokemon-pitch-black-3p-blister", "pokemon-mega-evolutions-me05-pitch-black-3-pack-blister-binacle"],
    target: "pitch-black-binacle-3-pack-blister",
  },
  { dups: ["pokemon-mega-evolution-phantasmal-flames-3-pack-blister-sneasel-weavile"], target: "phantasmal-flames-weavile-3-pack-blister" },
  {
    dups: ["pokemon-perfect-order-premium-checklane-blister-clawitzer-steelix-cinderace-or-meganium"],
    target: "perfect-order-clawitzer-stage-1-blister",
  },
  { dups: ["pokemon-mega-evolution-perfect-order-premium-checklane-1-pack-blister"], target: "perfect-order-cinderace-premium-checklane-blister" },
  { dups: ["astral-radiance-checklane-blister-mudkip"], target: "astral-radiance-swampert-premium-checklane-blister" },
  { dups: ["pokemon-sv1-base-set-checklane-blister-pack"], target: "scarlet-violet-espathra-1-pack-blister" },
];

const DELETES: { slug: string; why: string }[] = [
  { slug: "pokemon-scarlet-violet-prismatic-evolutions-tech-sticker-collection-3-pack-blister", why: "ägaren: radera" },
  { slug: "pokemon-tcg-2-pack-blister-2024", why: "ägaren: radera" },
];

const pick = {
  id: true, title: true, imageUrl: true, setId: true, category: true,
  offers: { select: { id: true, url: true, retailerId: true, condition: true, language: true, retailer: { select: { name: true } } } },
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
      const dupImage = dup.imageUrl;
      if (dupCm.length) await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
      await mergeStubInto(dup.id, target.id, () => {});
      if (g.takeImage && dupImage) {
        await prisma.product.update({ where: { id: target.id }, data: { imageUrl: dupImage } });
        console.log("     🖼 målets bild satt från dubbletten");
      }
      merged++;
      console.log("     ✓ hopslagen");
    }
  }

  console.log("\n════════ DELETES ════════");
  for (const d of DELETES) {
    const prod = await prisma.product.findUnique({ where: { slug: d.slug }, select: pick });
    if (!prod) { console.log(`  · redan borta: ${d.slug}`); continue; }
    console.log(`\n  [${prod.category}] ${prod.title}   (${d.why})`);
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
