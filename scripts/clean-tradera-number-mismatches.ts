/**
 * STÄDNING: raderar Tradera-offers på SINGLAR där annonsens tryckta kortnummer
 * inte är produktens kort — dvs de som nummer-vakten i matching.ts numera stoppar
 * vid ingång, men som redan hann skrivas innan vakten fanns (2026-07-25).
 *
 * Två klasser (se bareCardNumbers / cardNumberKey i src/scrapers/matching.ts):
 *   A) bokstavssuffix: "Guzma 115/147" (uncommon) satt på produkten Guzma 115a (promo)
 *   B) bart nummer:    "Milotic ex 42 Surging Sparks" satt på specialarten 217
 *
 * Vakterna ÅTERANVÄNDS härifrån — rapporten och ingångsspärren kan inte glida isär.
 * Varje raderad offer får en TraderaMatch(ok=false) så svepet aldrig återskapar den.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/clean-tradera-number-mismatches.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/clean-tradera-number-mismatches.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { normalizeTitle } from "../src/lib/utils";
import { bareCardNumbers, cardNumberKey, printedNumberKey } from "../src/scrapers/matching";
import { recomputeProductPriceCache } from "../src/services/products";
import { findReplacementListing, writeMarketplaceOffer } from "../src/services/marketplace-offers";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const kr = (o: number | null) => (o == null ? "–" : `${(o / 100).toFixed(0)} kr`);

/** Samma dom som matchListingToProduct singel-grenen. null = OK, annars skälet. */
function numberVerdict(listingTitle: string, cardNumber: string): string | null {
  const normalized = normalizeTitle(listingTitle);
  const ourKey = cardNumberKey(cardNumber);
  if (!ourKey) return null;
  const printed = printedNumberKey(normalized);
  if (printed) return printed === ourKey ? null : `annonsen är kort ${printed}, produkten ${ourKey}`;
  const ourNum = parseInt(ourKey.replace(/[a-z]/g, ""), 10);
  if (!Number.isFinite(ourNum)) return null;
  const bare = bareCardNumbers(normalized);
  if (bare.length === 0 || bare.includes(ourNum)) return null;
  return `annonsen nämner ${bare.join("/")}, produkten är ${ourNum}`;
}

async function main() {
  const db = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`DB: ${db[0].current_database}   läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}\n`);

  const tr = await prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } });
  if (!tr) throw new Error("Tradera-retailer saknas");

  const offers = await prisma.offer.findMany({
    where: { retailerId: tr.id, product: { category: "SINGLE_CARD" } },
    select: {
      id: true, url: true, price: true, productId: true,
      product: { select: { slug: true, card: { select: { name: true, number: true, setId: true } } } },
    },
  });
  // Bevis-kolumn: finns annonsens nummer som ett RIKTIGT kort i samma set? Då är
  // annonsen bevisat en annan produkt i vår egen katalog, inte en stavningsvariant.
  const setNumbers = new Map<string, Set<number>>();
  for (const c of await prisma.card.findMany({ select: { setId: true, number: true } })) {
    const key = cardNumberKey(c.number);
    const n = key ? parseInt(key.replace(/[a-z]/g, ""), 10) : NaN;
    if (!Number.isFinite(n)) continue;
    (setNumbers.get(c.setId) ?? setNumbers.set(c.setId, new Set()).get(c.setId)!).add(n);
  }
  const listings = await prisma.traderaListing.findMany({ select: { itemId: true, title: true } });
  const titleByItem = new Map(listings.map((l) => [l.itemId, l.title]));
  const titleOf = (url: string): { title: string; itemId: string | null } => {
    const itemId = url.match(/\/item\/\d+\/(\d+)/)?.[1] ?? null;
    if (itemId && titleByItem.has(itemId)) return { title: titleByItem.get(itemId)!, itemId };
    return { title: decodeURIComponent(url.split("/").pop() ?? "").replace(/-/g, " "), itemId };
  };

  const doomed: { offerId: string; productId: string; itemId: string | null; proven: boolean; line: string }[] = [];
  for (const o of offers) {
    const card = o.product.card;
    if (!card) continue;
    const { title, itemId } = titleOf(o.url);
    const verdict = numberVerdict(title, card.number);
    if (!verdict) continue;
    const inSet = setNumbers.get(card.setId) ?? new Set<number>();
    const claimed = [...verdict.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
    const proven = claimed.some((n) => inSet.has(n));
    doomed.push({
      offerId: o.id, productId: o.productId, itemId, proven,
      line: `  ${proven ? "BEVISAT" : "trolig "}  ${card.name} ${card.number}  ${kr(o.price)}  — ${verdict}\n      /produkter/${o.product.slug}\n      "${title.slice(0, 92)}"`,
    });
  }

  console.log(`Tradera-offers på singlar: ${offers.length}`);
  console.log(`Nummer-krockar att radera: ${doomed.length}`);
  console.log(`  BEVISAT (annonsens nummer finns som eget kort i samma set): ${doomed.filter((d) => d.proven).length}`);
  console.log(`  trolig  (numret finns inte i setet — lot, promo-numrering el. dyl.): ${doomed.filter((d) => !d.proven).length}\n`);
  for (const d of doomed.slice(0, 40)) console.log(d.line);
  if (doomed.length > 40) console.log(`  … ${doomed.length - 40} till`);

  if (!APPLY) {
    console.log(`\nTorrkörning — inget skrivet. Kör med --apply för att radera.`);
    await prisma.$disconnect();
    return;
  }
  if (doomed.length === 0) {
    await prisma.$disconnect();
    return;
  }

  await prisma.offer.deleteMany({ where: { id: { in: doomed.map((d) => d.offerId) } } });
  // Spärra paret så svepet aldrig återskapar annonsen (samma mekanism som LLM-domarna).
  for (const d of doomed) {
    if (!d.itemId) continue;
    await prisma.traderaMatch.upsert({
      where: { itemId_productId: { itemId: d.itemId, productId: d.productId } },
      update: { ok: false, reason: "kortnummer-krock (nummer-vakt 2026-07-25)" },
      create: { itemId: d.itemId, productId: d.productId, ok: false, reason: "kortnummer-krock (nummer-vakt 2026-07-25)" },
    });
    await prisma.traderaListing.deleteMany({ where: { itemId: d.itemId, productId: d.productId } });
  }
  // LYFT FRAM NÄSTA ANNONS. Utan det här steget lämnade städningen 2026-07-25 274
  // produkter med en KARUSELL FULL AV TRADERA-ANNONSER och ingen Tradera-rad i
  // pristabellen — det ser ut som en bugg, och är det: annonserna finns kvar, vi
  // hade bara raderat den vi råkat välja. Kandidaten är redan vaktad av svepet.
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  let promoted = 0;
  for (const productId of new Set(doomed.map((d) => d.productId))) {
    const replacement = await findReplacementListing(productId);
    if (!replacement) continue;
    const p = await prisma.product.findUnique({ where: { id: productId }, select: { category: true } });
    if (!p) continue;
    await writeMarketplaceOffer(productId, tradera.id, p.category, replacement);
    promoted++;
  }
  await recomputeProductPriceCache();
  console.log(`\n✅ ${doomed.length} offers raderade, spärrade, ${promoted} ersatta av nästa annons och priscachen omräknad.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
