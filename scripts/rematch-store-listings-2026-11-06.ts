/**
 * ENGÅNG 2026-11-06: låt nattens import pröva om butiksannonserna med den lagade matcharen.
 *
 * (1) Negativa memon ("ingen träff", `StoreListing.unmatchedAt`) nollas — de sattes av den
 *     gamla matcharen och hade annars gällt upp till 7 dygn till.
 * (2) 30th Celebration UPC-annonser som säger Day eller Night (Speltrollet, Alphaspel) satt på
 *     den GÖMDA butiksstubben "Pokémon 30th Celebration Ultra Premium Collection (ENG)". Deras
 *     offer på stubben tas bort och memot nollas ⇒ de binds till Espeon (Day) / Umbreon (Night).
 *     ⛔ Annonser utan val ("Night or Day", "(ENG)", Beams namnlösa) rörs inte.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/rematch-store-listings-2026-11-06.ts [--apply]
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const HIDDEN_UPC = "Pokémon 30th Celebration Ultra Premium Collection (ENG)";
const PICKS_ONE = /\b(day|night)\b/i;
const NO_PICK = /\b(?:day|night)\b\s*(?:\/|or|eller|&|och|and)\s*\b(?:day|night)\b/i;

async function main() {
  const memos = await prisma.storeListing.count({ where: { productId: null, unmatchedAt: { not: null } } });
  console.log(`Negativa memon att nolla: ${memos}`);

  const stub = await prisma.product.findFirst({ where: { title: HIDDEN_UPC, hiddenAt: { not: null } }, select: { id: true } });
  const bound = stub
    ? await prisma.storeListing.findMany({ where: { productId: stub.id }, select: { id: true, title: true, url: true, retailerId: true } })
    : [];
  const detach = bound.filter((l) => PICKS_ONE.test(l.title) && !NO_PICK.test(l.title));
  console.log(`UPC-annonser på den gömda stubben: ${bound.length}, lossas (säger Day/Night): ${detach.length}`);
  for (const l of detach) console.log(`  ${l.title}  ${l.url}`);

  if (!APPLY) {
    console.log("TORRKÖRNING — inget skrivet. --apply skriver.");
    return;
  }
  await prisma.storeListing.updateMany({
    where: { productId: null, unmatchedAt: { not: null } },
    data: { unmatchedAt: null, productMatchTitle: null },
  });
  for (const l of detach) {
    await prisma.offer.deleteMany({ where: { productId: stub!.id, retailerId: l.retailerId, url: l.url } });
    await prisma.storeListing.update({ where: { id: l.id }, data: { productId: null, productMatchTitle: null, unmatchedAt: null } });
  }
  console.log(`✅ ${memos} memon nollade, ${detach.length} UPC-annonser lossade. Nattens import binder om dem.`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
