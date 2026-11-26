/**
 * Städar Tradera-spåren på "Peelable Ditto"-varianterna (Pokémon GO: Spinarak 6, Numel 13,
 * Bidoof 59). Före 2026-11-26 saknade `listingFitsVariant` en regel för etiketten, så det
 * VANLIGA kortets annons blev variantens offer (3 kr mot ~225 kr hos CardTrader).
 *
 * Tar bort — bara på de produkterna, bara det som inte säger Ditto:
 *   1. Tradera-offern          2. skena-raderna (TraderaListing)
 *   3. Tradera-historikpunkterna (PriceObservation, annonstiteln i rawData)
 *   4. rättar dagssnapshots som bär Tradera-priset som min (räknas om ur CardTrader-punkterna)
 * och räknar sedan om priscachen.
 *
 * Torrkörning som standard:  node scripts/with-prod-db.mjs npx tsx scripts/fix-peelable-ditto-tradera.ts [--apply]
 */
import { prisma } from "../src/lib/db";
import { listingFitsVariant, VARIANT_PEELABLE_DITTO } from "../src/lib/print-variant";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const products = await prisma.product.findMany({
    where: { variantLabel: VARIANT_PEELABLE_DITTO },
    select: {
      id: true, slug: true, lowestPriceOre: true, card: { select: { name: true } },
      offers: { select: { id: true, price: true, url: true, retailer: { select: { name: true } } } },
      traderaListings: { select: { id: true, title: true, price: true } },
    },
  });
  console.log(`${products.length} Peelable Ditto-produkter${APPLY ? "" : "  (TORRKÖRNING — inget skrivs)"}`);

  for (const p of products) {
    const name = p.card?.name ?? null;
    const fits = (title: string) => listingFitsVariant(VARIANT_PEELABLE_DITTO, title, name);
    console.log(`\n== ${p.slug}  (rubrikpris nu: ${p.lowestPriceOre} öre)`);

    // Offerns titel finns inte på raden — URL-sluggen ÄR annonstiteln hos Tradera.
    const badOffers = p.offers.filter((o) => o.retailer.name === "Tradera" && !fits(decodeURIComponent(o.url).replace(/-/g, " ")));
    for (const o of badOffers) console.log(`  offer   ${o.price} öre  ${o.url}`);

    const badRail = p.traderaListings.filter((l) => !fits(l.title));
    console.log(`  skena   ${badRail.length} av ${p.traderaListings.length} rader säger inte Ditto`);

    const obs = await prisma.priceObservation.findMany({
      where: { productId: p.id },
      select: { id: true, price: true, observedAt: true, rawData: true, source: { select: { name: true } } },
    });
    const tradera = obs.filter((o) => o.source?.name === "Tradera");
    const badObs = tradera.filter((o) => {
      const title = (o.rawData as { title?: string } | null)?.title;
      return title ? !fits(title) : false; // okänd härkomst → rör den inte
    });
    const untitled = tradera.filter((o) => !(o.rawData as { title?: string } | null)?.title).length;
    console.log(`  historik ${badObs.length} av ${tradera.length} Tradera-punkter från en annons utan Ditto (${untitled} utan titel lämnas)`);

    // Dagssnapshots: min/max/avg räknas om ur de punkter som blir KVAR den dagen.
    const badIds = new Set(badObs.map((o) => o.id));
    const keptByDay = new Map<string, number[]>();
    for (const o of obs) if (!badIds.has(o.id)) keptByDay.set(day(o.observedAt), [...(keptByDay.get(day(o.observedAt)) ?? []), o.price]);
    const badDays = new Set(badObs.map((o) => day(o.observedAt)));
    const snaps = await prisma.priceSnapshot.findMany({ where: { productId: p.id }, select: { id: true, date: true, minPrice: true, maxPrice: true, avgPrice: true } });
    const fixes: { id: string; date: string; from: number; to: number[] | null }[] = [];
    for (const s of snaps) {
      if (!badDays.has(day(s.date))) continue;
      const kept = keptByDay.get(day(s.date));
      if (kept && Math.min(...kept) === s.minPrice) continue;
      fixes.push({ id: s.id, date: day(s.date), from: s.minPrice, to: kept ?? null });
    }
    console.log(`  snapshots ${fixes.length} av ${snaps.length} dagar bär Tradera-priset`);
    for (const f of fixes.slice(0, 5)) console.log(`     ${f.date}: min ${f.from} → ${f.to ? Math.min(...f.to) : "raderas (ingen annan punkt den dagen)"}`);

    if (!APPLY) continue;
    await prisma.offer.deleteMany({ where: { id: { in: badOffers.map((o) => o.id) } } });
    await prisma.traderaListing.deleteMany({ where: { id: { in: badRail.map((l) => l.id) } } });
    await prisma.priceObservation.deleteMany({ where: { id: { in: [...badIds] } } });
    for (const f of fixes) {
      if (!f.to) await prisma.priceSnapshot.delete({ where: { id: f.id } });
      else
        await prisma.priceSnapshot.update({
          where: { id: f.id },
          data: { minPrice: Math.min(...f.to), maxPrice: Math.max(...f.to), avgPrice: Math.round(f.to.reduce((a, b) => a + b, 0) / f.to.length) },
        });
    }
  }

  if (APPLY) {
    await recomputeProductPriceCache();
    const after = await prisma.product.findMany({ where: { variantLabel: VARIANT_PEELABLE_DITTO }, select: { slug: true, lowestPriceOre: true } });
    console.log("\nEfter:");
    for (const a of after) console.log(`  ${a.slug}: ${a.lowestPriceOre} öre`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
