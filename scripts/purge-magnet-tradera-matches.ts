/**
 * Städar Tradera-rader som hamnat på en "magnet"-produkt (2026-09-23).
 *
 * Katalogens Pokémon GO-, XY- och DP-produkter saknade särskiljande ord ("go"/"xy"/"dp"
 * var för korta och räknades bara på annons-sidan), så varje set-lös annons blev en
 * perfekt träff på dem — t.ex. 17 av 17 sålda "Pokémon GO-ETB:er" var 30th Celebration-
 * ETB:er. Matcharen är lagad (SET_QUALIFIER_WORDS i matching.ts); det här skriptet tar
 * bort de rader som redan skrevs.
 *
 * DOMEN: varje Tradera-rad på en produkt vars titel bär go/xy/dp matchas OM med den
 * lagade matcharen på sin egen annonstitel. Pekar den nya matchningen på en ANNAN
 * produkt (eller ingen) är raden fel och raderas. Raderna flyttas INTE — sålt-svepet
 * och det aktiva svepet hittar dem igen på rätt produkt inom sin lookback, genom
 * samma pris- och kategorivakter som alla andra annonser.
 *
 * Rör: PriceObservation (tradera-sweep + tradera-sold-sweep), TraderaListing (skenan)
 * och Tradera-offers vars URL tillhör en raderad annons. Räknar om priscachen efteråt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-magnet-tradera-matches.ts [--apply]
 */
import { prisma } from "../src/lib/db";
import { distinctiveOverlap, loadMatchIndex, matchProduct } from "../src/scrapers/matching";
import { recomputeProductPriceCache } from "../src/services/products";

/**
 * En produkt var en MAGNET om den, utan go/xy/dp, saknade särskiljande ord — exakt
 * villkoret för felet (distinctiveOverlap gav 1 mot varje set-lös titel).
 * ⛔ Ett bredare urval (varje produkt med "go"/"xy" i titeln) fångade tusentals
 *    KORT-rader från Fas 0, som matchas med matchListingToProduct och inte kan dömas
 *    om med matchProduct här.
 */
const QUALIFIER = /\b(go|xy|dp)\b/g;
const wasMagnet = (normalizedTitle: string) =>
  /\b(go|xy|dp)\b/.test(normalizedTitle) &&
  distinctiveOverlap("", normalizedTitle.replace(QUALIFIER, " ")) === 1;

async function main() {
  const apply = process.argv.includes("--apply");
  const index = await loadMatchIndex();
  const magnets = index.filter((p) => wasMagnet(p.normalizedTitle));
  for (const m of magnets) console.log(`  magnet: ${m.normalizedTitle}`);
  const magnetIds = magnets.map((p) => p.id);
  const titleOf = new Map(index.map((p) => [p.id, p.normalizedTitle]));
  console.log(`${magnets.length} magnet-produkter.\n`);

  // ⛔ En annons som SJÄLV nämner go/xy/dp rör vi inte, även om den lagade matcharen
  //    inte hittar den ("Pokemon go ETB" — förkortningen ETB läses inte, ett separat
  //    och äldre glapp). Felet var set-LÖSA titlar; bara de döms här.
  const stillMatches = async (productId: string, title: string) =>
    /\b(go|xy|dp)\b/i.test(title) || (await matchProduct(title, index, title))?.productId === productId;

  // ── Prisobservationer (aktiva svepet + sålt-svepet) ──
  const obs = await prisma.$queryRawUnsafe<{ id: string; productId: string; title: string; url: string | null; price: number }[]>(
    `SELECT id, "productId", "rawData"->>'title' AS title, "rawData"->>'url' AS url, price
       FROM "PriceObservation"
      WHERE "productId" = ANY($1::text[])
        AND "rawData"->>'source' IN ('tradera-sweep', 'tradera-sold-sweep')
        AND "rawData"->>'title' IS NOT NULL`,
    magnetIds
  );
  const badObs: typeof obs = [];
  for (const o of obs) if (!(await stillMatches(o.productId, o.title))) badObs.push(o);

  // ── Skenan ──
  const rail = await prisma.traderaListing.findMany({
    where: { productId: { in: magnetIds } },
    select: { id: true, productId: true, title: true, url: true, price: true },
  });
  const badRail: typeof rail = [];
  for (const r of rail) if (!(await stillMatches(r.productId, r.title))) badRail.push(r);

  // ── Offers: bara de vars annons-URL vi just dömt ──
  const badUrls = new Set([...badObs.map((o) => o.url), ...badRail.map((r) => r.url)].filter(Boolean) as string[]);
  const offers = await prisma.offer.findMany({
    where: { productId: { in: magnetIds }, retailer: { name: "Tradera" } },
    select: { id: true, productId: true, url: true, price: true },
  });
  const badOffers = offers.filter((o) => o.url && badUrls.has(o.url));

  const byProduct = new Map<string, number>();
  for (const r of [...badObs, ...badRail, ...badOffers]) byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + 1);
  for (const [pid, n] of [...byProduct].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${titleOf.get(pid)}`);
  console.log("\nExempel:");
  for (const o of badObs.slice(0, 15)) console.log(`  [${titleOf.get(o.productId)}] ← "${o.title}" (${o.price / 100} kr)`);
  console.log(
    `\nFel rader: ${badObs.length} av ${obs.length} prisobservationer, ${badRail.length} av ${rail.length} skena-annonser, ` +
      `${badOffers.length} av ${offers.length} Tradera-offers.`
  );

  if (!apply) {
    console.log("Dry run — kör med --apply för att radera.");
    return;
  }
  const o = await prisma.priceObservation.deleteMany({ where: { id: { in: badObs.map((x) => x.id) } } });
  const r = await prisma.traderaListing.deleteMany({ where: { id: { in: badRail.map((x) => x.id) } } });
  const f = await prisma.offer.deleteMany({ where: { id: { in: badOffers.map((x) => x.id) } } });
  console.log(`Raderade ${o.count} observationer, ${r.count} skena-annonser, ${f.count} offers.`);
  if (f.count > 0) {
    await recomputeProductPriceCache();
    console.log("Priscachen omräknad.");
  }
}

main().finally(() => prisma.$disconnect());
