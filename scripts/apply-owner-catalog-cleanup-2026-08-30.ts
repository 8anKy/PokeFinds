/**
 * Ägarens kataloggenomgång 2026-08-30: nio dubbletter in i rätt produkt, sex poster bort.
 * Varje rad är ETT ägarbeslut (URL-lista i chatten), aldrig en regel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-30.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-30.ts --apply
 *
 * Samma direktiv som 2026-08-10:
 *  - Dubblettens Cardmarket-offer följer ALDRIG med (målet bär redan rätt CM-länk).
 *  - Butiks-URL:er som SLÄPPS (målet har redan butiken) eller RADERAS skrivs i
 *    `DeniedListingUrl` — annars återskapar nästa skrapning produkten. Det är exakt
 *    vad som hände med Pokémon GO-boostern: hopslagen 08-10, tillbaka via Pokétalk,
 *    tillbaka i dagens lista. ⛔ Marknadsplats-URL:er (Cardmarket/Tradera) nekas aldrig.
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";
import { normalizeListingUrl } from "../src/scrapers/import-denylist";
import { isStoreRetailer } from "../src/lib/offer-source";

const APPLY = process.argv.includes("--apply");
const REASON = "ägarens kataloggenomgång 2026-08-30";

const MERGES: { dup: string; target: string }[] = [
  { dup: "pokemon-shining-fates-dragapult-crobat-premium-collection-crobat", target: "shiny-crobat-vmax-collection" },
  { dup: "pokemon-shining-fates-dragapult-crobat-premium-collection-dragapult", target: "shiny-dragapult-vmax-collection" },
  { dup: "pokemon-30th-celebration-booster-pack-japansk-orma", target: "pokemon-30th-celebration-booster-pack-japansk" },
  { dup: "mega-evolution-pitch-black-2-pack-blister-zarude", target: "zarude-2-pack-blister-version-1" },
  { dup: "pokemon-sword-shield-celebrations-25th-anniversary-booster-pack", target: "celebrations-cel25-booster-pack" },
  { dup: "pokemon-sword-shield-pokemon-go-booster-pack", target: "pokemon-go-pgo-booster-pack" },
  { dup: "pokemon-sword-shield-space-juggler-s10p-booster-display-japansk", target: "pokemon-sword-shield-space-juggler-s10p-display-booster-box-japansk" },
  { dup: "pokemon-sword-shield-space-juggler-s10p-booster-japansk", target: "pokemon-space-juggler-booster-s10p-japansk" },
  { dup: "pokemon-mega-evolution-chaos-rising-build-battle-box-4-pack-eng", target: "chaos-rising-build-battle-box" },
];

const DELETES = [
  "pokemon-center-special-box-tohoku-hiroshima-eller-fukuoka",
  "neo-genesis-hotfoot-theme-deck",
  "typhlosion-ex-003-typhlosion-constructed-starter-deck",
  "umbreon-12-25th-anniversary-promo-pack",
  "kyogre-and-groudon-elite-trainer-deck-shield-tin",
  "zarude-2-pack-blister-version-2",
];

const pick = {
  id: true, title: true, slug: true, category: true,
  offers: { select: { id: true, url: true, retailerId: true, condition: true, language: true, retailer: { select: { name: true } } } },
  _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
} as const;
const bySlug = (slug: string) => prisma.product.findUnique({ where: { slug }, select: pick });

async function deny(url: string, productId: string, retailer: string) {
  if (!APPLY) return;
  const norm = normalizeListingUrl(url);
  await prisma.deniedListingUrl.upsert({
    where: { url: norm },
    update: {},
    create: { url: norm, reason: REASON, productId, retailer },
  });
}

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");
  let problems = 0, merged = 0, deleted = 0, denied = 0;

  console.log("════════ MERGES ════════");
  for (const g of MERGES) {
    const [dup, target] = await Promise.all([bySlug(g.dup), bySlug(g.target)]);
    if (!target) { console.log(`\n⛔ MÅL SAKNAS: ${g.target}`); problems++; continue; }
    if (!dup) { console.log(`\n  · redan borta: ${g.dup}`); continue; }
    console.log(`\n  "${dup.title}" [${dup.category}, ${dup._count.priceSnapshots} snap]\n   → "${target.title}" [${target.category}, ${target._count.priceSnapshots} snap, ${target.offers.length} offers]`);
    if (dup.category !== target.category) console.log(`     ⚠️ olika kategori (${dup.category} → ${target.category}) — mergas ändå per ägarbeslut`);
    const targetKeys = new Set(target.offers.map((o) => `${o.retailerId}|${o.condition}|${o.language}`));
    const dupCm = dup.offers.filter((o) => o.retailer.name === "Cardmarket");
    if (dupCm.length) console.log(`     CM-offer på dubbletten RADERAS: ${dupCm.map((o) => o.url).join(" · ")}`);
    for (const o of dup.offers) {
      if (o.retailer.name === "Cardmarket") continue;
      const dropped = targetKeys.has(`${o.retailerId}|${o.condition}|${o.language}`);
      const store = isStoreRetailer(o.retailer.name);
      console.log(`     ${dropped ? "✂ SLÄPPS (målet har butiken)" : "→ flyttas"}: ${o.retailer.name}: ${o.url}${dropped && store ? "  [denylistas]" : ""}`);
      if (dropped && store) { await deny(o.url, dup.id, o.retailer.name); denied++; }
    }
    if (dup._count.watchlistItems || dup._count.collectionItems)
      console.log(`     flyttar ${dup._count.watchlistItems} bevakningar, ${dup._count.collectionItems} samlingsposter`);
    if (dup._count.priceSnapshots > target._count.priceSnapshots) {
      console.log("     ⚠️ dubbletten har MER historik än målet — fel riktning? HOPPAS ÖVER"); problems++; continue;
    }
    if (!APPLY) continue;
    if (dupCm.length) await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
    await mergeStubInto(dup.id, target.id, () => {});
    merged++;
    console.log("     ✓ hopslagen");
  }

  console.log("\n════════ DELETES ════════");
  for (const slug of DELETES) {
    const prod = await bySlug(slug);
    if (!prod) { console.log(`\n  · redan borta: ${slug}`); continue; }
    console.log(`\n  [${prod.category}] ${prod.title}`);
    for (const o of prod.offers) {
      const store = isStoreRetailer(o.retailer.name);
      console.log(`       ${o.retailer.name}: ${o.url}${store ? "  [denylistas]" : ""}`);
      if (store) { await deny(o.url, prod.id, o.retailer.name); denied++; }
    }
    if (prod._count.collectionItems > 0) { console.log("     ⚠️ ligger i någons samling — hoppas över"); problems++; continue; }
    // Bara marknadsplats-offers (Cardmarket) = produkten kom ur CM:s katalog, och
    // CM-importen skulle kunna skapa om en raderad rad. `hiddenAt` är normalvägen där
    // (se project_catalog_delete_silenced_discord): borta från sajten, kan inte komma
    // tillbaka, och Discord-embeddar som redan pekar hit svarar fortfarande.
    const onlyMarketplace = prod.offers.length > 0 && prod.offers.every((o) => !isStoreRetailer(o.retailer.name));
    if (onlyMarketplace) {
      console.log("     → GÖMS (hiddenAt) i stället för radering: bara Cardmarket-offer, CM-importen hade återskapat den");
      if (APPLY) { await prisma.product.update({ where: { id: prod.id }, data: { hiddenAt: new Date() } }); deleted++; }
      continue;
    }
    if (!APPLY) continue;
    await prisma.traderaMatch.deleteMany({ where: { productId: prod.id } });
    await prisma.dedupeVerdict.deleteMany({ where: { OR: [{ productAId: prod.id }, { productBId: prod.id }] } });
    await prisma.product.delete({ where: { id: prod.id } });
    deleted++;
    console.log("     ✓ raderad");
  }

  if (APPLY) await recomputeProductPriceCache();
  console.log(`\n${APPLY ? "KLART" : "TORRKÖRNING"}: ${merged} hopslagna, ${deleted} raderade, ${denied} butiks-URL:er nekade, ${problems} problem.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
