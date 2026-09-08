/**
 * Mergar EN namngiven produkt in i EN annan. För ägarens granskade merge-lista, där
 * varje par ska kunna kontrolleras innan det skrivs.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-product-pair.ts --from <slug> --to <slug>
 *   ... --apply     # skriver
 *
 * ⛔ MERGEN ÄR OÅTERKALLELIG: `from` RADERAS och dess PriceSnapshot/PriceObservation
 *    kaskaderar med. Torrkör alltid först — rapporten nedan visar vad varje sida bär,
 *    så riktningen går att bedöma innan något skrivs.
 * ⛔ Vakterna körs men STOPPAR INTE en uttrycklig order: ägaren har granskat paret och
 *    kan se saker vakten inte kan (t.ex. att "B Grade – RIPPED SEAL" ska in i den hela
 *    produkten). Vakternas utfall SKRIVS UT och kräver `--force` om någon säger nej —
 *    så att ett nej aldrig kan passera obemärkt.
 */
import { PrismaClient } from "@prisma/client";
import { productsConflict } from "../src/scrapers/matching";
import { mergeStubInto, mergeWouldLoseTrackRecord } from "../src/jobs/dedupe-stubs";

const prisma = new PrismaClient();
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

const SELECT = {
  id: true, slug: true, title: true, category: true, language: true, gtin: true,
  setId: true, cardId: true, imageUrl: true, lowestPriceOre: true, createdAt: true,
  _count: { select: { offers: true, priceSnapshots: true, watchlistItems: true, collectionItems: true } },
} as const;

async function describe(slug: string, label: string) {
  const p = await prisma.product.findUnique({ where: { slug }, select: SELECT });
  if (!p) {
    console.log(`${label}: SAKNAS — ingen produkt med slug "${slug}" (redan mergad?)`);
    return null;
  }
  const cm = await prisma.offer.count({ where: { productId: p.id, retailer: { name: "Cardmarket" } } });
  console.log(
    `${label}: "${p.title}"\n` +
    `   slug=${p.slug}\n` +
    `   kategori=${p.category} språk=${p.language} skapad=${p.createdAt.toISOString().slice(0, 10)}\n` +
    `   offers=${p._count.offers} (Cardmarket: ${cm ? "JA" : "nej"}) snapshots=${p._count.priceSnapshots}\n` +
    `   gtin=${p.gtin ?? "–"} set=${p.setId ? "ja" : "nej"} bild=${p.imageUrl ? "ja" : "NEJ"}\n` +
    `   bevakningar=${p._count.watchlistItems} samlingar=${p._count.collectionItems} lägsta=${p.lowestPriceOre ?? "–"}`
  );
  return p;
}

async function main() {
  const fromSlug = arg("--from");
  const toSlug = arg("--to");
  if (!fromSlug || !toSlug) throw new Error("Ange --from <slug> --to <slug>.");

  const from = await describe(fromSlug, "FRÅN (raderas)");
  console.log();
  const to = await describe(toSlug, "TILL  (behålls)");
  if (!from || !to) {
    console.log("\nAvbryter — båda produkterna måste finnas.");
    return;
  }
  if (from.id === to.id) {
    console.log("\nSamma produkt — inget att göra.");
    return;
  }

  console.log("\n── VAKTER ─────────────────────────────────────────────");
  const conflict = productsConflict(from.title, to.title, to.language);
  const loses = await mergeWouldLoseTrackRecord(from.id, to.id);
  const sameCategory = from.category === to.category;
  console.log(`   productsConflict      : ${conflict ? "JA (titlarna motsäger varandra)" : "nej"}`);
  console.log(`   förlorar meritlista   : ${loses ? "JA (fel riktning?)" : "nej"}`);
  console.log(`   samma kategori        : ${sameCategory ? "ja" : `NEJ (${from.category} → ${to.category})`}`);

  const objections = [conflict && "productsConflict", loses && "meritlista", !sameCategory && "kategori"].filter(Boolean);
  if (objections.length > 0 && !FORCE) {
    console.log(`\n⛔ Vakt säger nej (${objections.join(", ")}). Granska ovan; kör med --force om det ändå är rätt.`);
    return;
  }
  if (objections.length > 0) console.log(`\n⚠ --force: kör trots ${objections.join(", ")}.`);

  if (!APPLY) {
    console.log(`\nTorrkörning — inget skrevs. Lägg till --apply.`);
    console.log(`Skulle flytta ${from._count.offers} offers, ${from._count.watchlistItems} bevakningar, ${from._count.collectionItems} samlingsposter och RADERA "${from.title}".`);
    return;
  }
  await mergeStubInto(from.id, to.id, (m) => console.log(m));
  const after = await prisma.product.findUnique({ where: { slug: toSlug }, select: SELECT });
  console.log(`\nKLART. "${to.title}" har nu ${after?._count.offers} offers, ${after?._count.priceSnapshots} snapshots.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
