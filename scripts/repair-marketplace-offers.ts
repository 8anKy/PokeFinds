/**
 * KARUSELL UTAN PRISRAD — och gamla annonser som dagens matchare inte längre godtar.
 *
 * Symtomet på produktsidan: "Fler annonser på Tradera" visar en rad annonser, men
 * pristabellen har ingen Tradera-rad alls. Orsaken är alltid densamma — en offer
 * städades bort som bevisad felmatch (nummer-städningen 2026-07-25 tog 707 stycken,
 * purge-mismatched-offer tar enstaka) utan att nästa vettiga annons ur SAMMA redan
 * vaktade kandidatlista lyftes fram. Svepet läker det själv nästa gång produkten
 * namn-söks, men rotationen tar dagar och under tiden ser sidan trasig ut.
 *
 * MEN: skena-raderna vaktades av den matchare som fanns när de SKREVS. Ekans · Team
 * Rocket 56/82 hade "Team Rocket's Ekans #112 - Destined Rivals" (5 kr) liggande
 * sedan 2026-07-25 06:36 — timmar innan nummervakten deployades — och det var
 * exakt den annonsen städningen samma dag tog bort som offer. Att bara lyfta
 * "billigaste kvarvarande" hade återskapat den. Därför städas skenan FÖRST, med
 * dagens matchare, och först därefter väljs ersättare.
 *
 * Fyra faser, i den här ordningen:
 *   1. VETA SKENAN   — radera skena-rader som dagens matchare/språkvakt avvisar.
 *   2. LAGA OFFERS   — offers som pekar på en sådan rad tas bort (de är samma
 *                      felmatch, bara i den andra tabellen).
 *   3. ERSÄTT        — produkter med kvarvarande annonser men ingen prissatt
 *                      Tradera-rad får billigaste kandidat som håller.
 *   4. VETA GRAFEN   — Tradera-historikpunkter från en avvisad annons raderas.
 *                      Utan den ligger felmatchens pris kvar som en Tradera-KURVA
 *                      på produktsidan, fast raden är borta ur pristabellen.
 *
 * Dry-run som standard. APPLY=1 skriver.
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-marketplace-offers.ts
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/repair-marketplace-offers.ts
 *
 * Idempotent: när allt är lagat hittar den 0 rader och gör ingenting.
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";
import { findReplacementListing, writeMarketplaceOffer } from "../src/services/marketplace-offers";
import { matchListingToProduct } from "../src/scrapers/matching";
import { listingCardLanguage } from "../src/lib/listing-language";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.env.APPLY === "1";
/** Skena-rader äldre än så visas inte på produktsidan — då finns inget att laga. */
const MAX_AGE_DAYS = 4;
/** Fas 4:s historikfönster. 7 dygn ≈ 24k rader; hela historiken är ~170k. */
const OBS_DAYS = Number(process.env.OBS_DAYS ?? 7);

function itemIdFromUrl(url: string): string | null {
  return url.match(/\/item\/\d+\/(\d+)/)?.[1] ?? null;
}

async function main() {
  console.log(APPLY ? "LÄGE: SKRIVER\n" : "LÄGE: TORRKÖRNING (APPLY=1 för att skriva)\n");
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });

  // ── Fas 1: veta skenan mot DAGENS matchare ────────────────────────────────
  const products = await prisma.product.findMany({
    where: { traderaListings: { some: {} } },
    select: {
      id: true, slug: true, title: true, category: true, normalizedTitle: true, language: true,
      variantLabel: true,
      card: { select: { name: true, number: true } },
      traderaListings: { select: { id: true, itemId: true, title: true, price: true, url: true } },
    },
  });
  const doomed: { id: string; productId: string; itemId: string; title: string; productTitle: string }[] = [];
  let rows = 0;
  for (const p of products) {
    for (const l of p.traderaListings) {
      rows++;
      const sameLanguage = listingCardLanguage(l.title, l.url) === p.language;
      const matches = matchListingToProduct(l.title, {
        normalizedTitle: p.normalizedTitle, card: p.card, variantLabel: p.variantLabel,
      }) != null;
      if (sameLanguage && matches) continue;
      doomed.push({ id: l.id, productId: p.id, itemId: l.itemId, title: l.title, productTitle: p.title });
    }
  }
  console.log(`Fas 1: ${rows} skena-rader granskade, ${doomed.length} avvisas av dagens matchare.`);
  for (const d of doomed.slice(0, 12)) console.log(`   ${d.productTitle}  ←  "${d.title}"`);
  if (doomed.length > 12) console.log(`   … och ${doomed.length - 12} till`);
  if (APPLY && doomed.length > 0) {
    for (let i = 0; i < doomed.length; i += 500) {
      await prisma.traderaListing.deleteMany({ where: { id: { in: doomed.slice(i, i + 500).map((d) => d.id) } } });
    }
  }

  // ── Fas 2: offers som pekar på en avvisad annons ──────────────────────────
  const doomedPairs = new Set(doomed.map((d) => `${d.productId}|${d.itemId}`));
  const traderaOffers = await prisma.offer.findMany({
    where: { retailerId: tradera.id, price: { not: null } },
    select: { id: true, url: true, productId: true, price: true, product: { select: { title: true } } },
  });
  const badOffers = traderaOffers.filter((o) => {
    const itemId = itemIdFromUrl(o.url);
    return itemId != null && doomedPairs.has(`${o.productId}|${itemId}`);
  });
  console.log(`\nFas 2: ${badOffers.length} Tradera-offers pekar på en avvisad annons.`);
  for (const o of badOffers.slice(0, 12))
    console.log(`   ${o.product.title}  ${(o.price! / 100).toFixed(2)} kr  ${o.url.slice(0, 70)}`);
  if (badOffers.length > 12) console.log(`   … och ${badOffers.length - 12} till`);
  if (APPLY && badOffers.length > 0) {
    await prisma.offer.deleteMany({ where: { id: { in: badOffers.map((o) => o.id) } } });
  }

  // ── Fas 3: ersätt där karusellen finns men prisraden saknas ───────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const orphans = APPLY
    ? await prisma.product.findMany({
        where: {
          traderaListings: { some: { lastSeenAt: { gte: cutoff } } },
          offers: { none: { retailerId: tradera.id, price: { not: null } } },
        },
        select: { id: true, slug: true, title: true, category: true },
      })
    : // Torrkörning: Fas 1–2 har inte skrivit, så listan måste räknas fram med de
      // raderingarna påhittade — annars döljs precis de produkter reparationen finns för.
      (
        await prisma.product.findMany({
          where: { traderaListings: { some: { lastSeenAt: { gte: cutoff } } } },
          select: {
            id: true, slug: true, title: true, category: true,
            offers: { where: { retailerId: tradera.id, price: { not: null } }, select: { id: true } },
          },
        })
      )
        .filter((p) => p.offers.every((o) => badOffers.some((b) => b.id === o.id)))
        .map(({ id, slug, title, category }) => ({ id, slug, title, category }));

  console.log(`\nFas 3: ${orphans.length} produkter har karusell men ingen prissatt Tradera-rad.`);
  let fixed = 0, noCandidate = 0;
  const results: { p: (typeof orphans)[number]; replacement: Awaited<ReturnType<typeof findReplacementListing>> }[] = [];
  await mapPool(orphans, 8, async (p) => {
    results.push({ p, replacement: await findReplacementListing(p.id) });
  });
  for (const { p, replacement } of results) {
    if (!replacement) { noCandidate++; continue; }
    if (fixed < 12) console.log(`   ${p.title} → ${(replacement.price / 100).toFixed(2)} kr  "${replacement.title}"`);
    if (APPLY) await writeMarketplaceOffer(p.id, tradera.id, p.category, replacement);
    fixed++;
  }

  console.log(
    `\n${fixed} produkter ${APPLY ? "fick" : "skulle få"} en Tradera-rad. ` +
    `${noCandidate} hade ingen kandidat som håller (lämnas — hellre ingen rad än ett pris vi inte kan försvara).`
  );

  // ── Fas 4: prishistoriken efter en felmatchad annons ──────────────────────
  // Att ta bort offern räcker inte: svepet skriver en PriceObservation per skriven
  // offer, och produktsidans graf ritar en serie PER KÄLLA ur dem. En felmatchad
  // annons lämnar därför en Tradera-kurva kvar på kortet — med precis det pris vi
  // nyss tog bort ur pristabellen. Uppmätt 2026-07-28: 128 sådana punkter på Base
  // tryckningsprodukter, alltså en Tradera-graf på kort där bara Cardmarket har
  // ett pris. Samma dom som Fas 1 (annonstiteln ligger i rawData), och BARA för
  // produkter reparationen redan rört — ingen katalogbred historikläsning.
  //
  // Fönstret är TIDSBASERAT, inte "produkterna vi nyss rörde": Fas 1–2 raderar
  // ju raderna, så en omkörning hade haft noll att gå på och punkterna legat kvar
  // för alltid. OBS_DAYS=7 som standard (~24k rader) — höj vid behov, men skriv
  // aldrig om det till "hela historiken" utan att mäta först (170k rader totalt).
  const obsCutoff = new Date();
  obsCutoff.setDate(obsCutoff.getDate() - OBS_DAYS);
  const observations = await prisma.priceObservation.findMany({
    where: { source: { name: "Tradera" }, observedAt: { gte: obsCutoff } },
    select: { id: true, productId: true, price: true, rawData: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  // Produkter vars ENDA skena-rader nyss raderades finns inte kvar i `products`.
  const missing = [...new Set(observations.map((o) => o.productId))].filter((id) => !productById.has(id));
  for (const p of missing.length
    ? await prisma.product.findMany({
        where: { id: { in: missing } },
        select: {
          id: true, slug: true, title: true, category: true, normalizedTitle: true, language: true,
          variantLabel: true, card: { select: { name: true, number: true } }, traderaListings: { select: { id: true, itemId: true, title: true, price: true, url: true } },
        },
      })
    : []) productById.set(p.id, p);
  const doomedObs = observations.filter((o) => {
    const raw = o.rawData as { title?: string; url?: string } | null;
    const p = productById.get(o.productId);
    if (!raw?.title || !p) return false; // okänd härkomst → rör den inte
    const sameLanguage = listingCardLanguage(raw.title, raw.url ?? "") === p.language;
    const matches = matchListingToProduct(raw.title, {
      normalizedTitle: p.normalizedTitle, card: p.card, variantLabel: p.variantLabel,
    }) != null;
    return !(sameLanguage && matches);
  });
  console.log(`\nFas 4: ${observations.length} Tradera-historikpunkter senaste ${OBS_DAYS} dygnen, ${doomedObs.length} från en avvisad annons (äldre punkter granskas INTE — höj OBS_DAYS).`);
  for (const o of doomedObs.slice(0, 8)) {
    const raw = o.rawData as { title?: string } | null;
    console.log(`   ${productById.get(o.productId)!.title.padEnd(46)} ${(o.price / 100).toFixed(2).padStart(9)} kr  ←  "${raw?.title}"`);
  }
  if (doomedObs.length > 8) console.log(`   … och ${doomedObs.length - 8} till`);
  if (APPLY && doomedObs.length > 0) {
    for (let i = 0; i < doomedObs.length; i += 500) {
      await prisma.priceObservation.deleteMany({ where: { id: { in: doomedObs.slice(i, i + 500).map((o) => o.id) } } });
    }
  }
  if (APPLY && (fixed > 0 || badOffers.length > 0)) {
    await recomputeProductPriceCache();
    console.log("Prischachen omräknad.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
