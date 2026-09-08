/**
 * Ger en ETABLERAD produkt en NYIMPORTERAD CM-produkts identitet (länk, namn, bild)
 * och raderar dubbletten. För när importen skapat en CM-namngiven tvilling till en
 * produkt vi redan hade under butikens formulering.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/adopt-cm-identity.ts --keep <slug> --drop <slug>
 *   ... --apply
 *
 * ⛔ VARFÖR INTE BARA MERGA: `mergeStubInto` RADERAR stubbens Cardmarket-offer i
 *    stället för att flytta den (NON_STORE_RETAILERS, se catalog-curation.md). Att
 *    merga den nyimporterade in i den etablerade hade alltså kastat bort precis den
 *    CM-länk vi vill åt. Och åt andra hållet fäller `mergeWouldLoseTrackRecord` med
 *    rätta: den etablerade bär prishistoriken (19 snapshots i det fall som drev fram
 *    skriptet), och historik byggs bara FRAMÅT — den går inte att återskapa.
 *
 * ⛔ SLUGEN RÖRS ALDRIG. Den är publicerad; titeln får byta, adressen inte.
 */
import { PrismaClient } from "@prisma/client";
import { productsConflict } from "../src/scrapers/matching";

const prisma = new PrismaClient();
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes("--apply");

async function main() {
  const keepSlug = arg("--keep"), dropSlug = arg("--drop");
  if (!keepSlug || !dropSlug) throw new Error("Ange --keep <slug> --drop <slug>.");

  const SEL = { id: true, slug: true, title: true, category: true, language: true, imageUrl: true, setId: true,
                offers: { select: { id: true, url: true, price: true, stockStatus: true,
                                    retailer: { select: { id: true, name: true } } } },
                _count: { select: { priceSnapshots: true, watchlistItems: true, collectionItems: true } } } as const;
  const keep = await prisma.product.findUniqueOrThrow({ where: { slug: keepSlug }, select: SEL });
  const drop = await prisma.product.findUniqueOrThrow({ where: { slug: dropSlug }, select: SEL });

  const cmOffer = drop.offers.find((o) => o.retailer.name === "Cardmarket");
  if (!cmOffer) throw new Error(`"${drop.title}" har ingen CM-offer att adoptera.`);
  if (keep.offers.some((o) => o.retailer.name === "Cardmarket")) throw new Error(`"${keep.title}" har redan en CM-offer.`);
  if (keep.category !== drop.category) throw new Error(`Olika kategori: ${keep.category} vs ${drop.category}`);
  if (productsConflict(keep.title, drop.title, drop.language)) throw new Error("productsConflict: titlarna motsäger varandra.");
  if (drop._count.watchlistItems || drop._count.collectionItems)
    throw new Error("Dubbletten bär bevakningar/samlingsposter — hantera för hand.");
  if (drop._count.priceSnapshots > keep._count.priceSnapshots)
    throw new Error(`Dubbletten har MER historik (${drop._count.priceSnapshots} > ${keep._count.priceSnapshots}) — fel riktning.`);

  console.log(`BEHÅLLS: "${keep.title}"\n   ${keep.slug}  offers=${keep.offers.length} snapshots=${keep._count.priceSnapshots}`);
  console.log(`RADERAS: "${drop.title}"\n   ${drop.slug}  offers=${drop.offers.length} snapshots=${drop._count.priceSnapshots}`);
  console.log(`\nAdopterar: titel "${drop.title}", bild ${drop.imageUrl?.slice(0, 50)}, CM ${cmOffer.url.match(/idProduct=(\d+)/)?.[1]}`);
  if (!APPLY) { console.log("\nTorrkörning — inget skrevs."); return; }

  await prisma.$transaction([
    // CM-offern FLYTTAS (inte kopieras) — id:t får bara ägas av en produkt.
    prisma.offer.update({ where: { id: cmOffer.id }, data: { productId: keep.id } }),
    prisma.product.update({
      where: { id: keep.id },
      data: {
        title: drop.title,
        normalizedTitle: drop.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        imageUrl: drop.imageUrl ?? keep.imageUrl,
        setId: keep.setId ?? drop.setId,
      },
    }),
  ]);
  // Kvarvarande offers på dubbletten är butikslänkar — flytta dem som en merge gör.
  for (const o of drop.offers.filter((x) => x.id !== cmOffer.id)) {
    const clash = keep.offers.find((k) => k.retailer.id === o.retailer.id);
    if (clash) await prisma.offer.delete({ where: { id: o.id } });
    else await prisma.offer.update({ where: { id: o.id }, data: { productId: keep.id } });
  }
  await prisma.traderaMatch.deleteMany({ where: { productId: drop.id } });
  await prisma.dedupeVerdict.deleteMany({ where: { OR: [{ productAId: drop.id }, { productBId: drop.id }] } });
  await prisma.product.delete({ where: { id: drop.id } });
  console.log(`\nKLART — "${keep.slug}" bär nu CM-länken, namnet och bilden.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
