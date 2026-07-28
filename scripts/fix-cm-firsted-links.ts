/**
 * UTTRYCKLIGT 1st Edition-läge på VARJE Cardmarket-singel-länk.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-firsted-links.ts          # TORRKÖRNING
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-firsted-links.ts --apply
 *
 * VARFÖR: att utelämna `isFirstEd` är INTE "inget filter". Cardmarket lägger
 * filtret i besökarens SESSION och stämplar tillbaka det på nästa produktsida hen
 * öppnar — mätt 2026-07-28: en förfrågan helt utan parametern landade på
 * `.../Alakazam-V1-BS1?…&isFirstEd=N`, och tidigare samma dag fick ett annat kort
 * `&isFirstEd=Y`. Följden i praktiken: den som klickat på EN 1st Edition-länk hos
 * oss såg sedan 1st Edition-annonser även på Unlimited-kortet, alltså en helt
 * annan (och mycket dyrare) vara än den produktsidan handlar om.
 *
 * Regeln: 1st Edition-produkter → `isFirstEd=Y`, alla andra singlar → `isFirstEd=N`.
 * Sealed rörs INTE: CM stämplar in parametern där också, men sealed-sidan har
 * varken skick- eller 1st Edition-filter i sin panel och listan påverkas inte
 * (verifierat: Scarlet & Violet Booster, 3 204 annonser med isFirstEd=N i URL:en).
 *
 * Idempotent — när allt är rätt hittar den 0 rader. De dagliga jobben håller nya
 * länkar rätt (cardmarket-refresh + hot-card-refresh); det här är engångsstädningen
 * av det som redan ligger i databasen.
 */
import { prisma } from "../src/lib/db";
import { withFirstEd } from "../src/lib/marketplace-urls";
import { PRINT_FIRST_EDITION } from "../src/lib/print-variant";

const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

async function main() {
  console.log(`${APPLY ? "SKARP KÖRNING" : "TORRKÖRNING (lägg till --apply för att skriva)"}\n`);
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const offers = await prisma.offer.findMany({
    where: { retailerId: cm.id, product: { category: "SINGLE_CARD" }, url: { contains: "cardmarket.com" } },
    select: { id: true, url: true, product: { select: { title: true, variantLabel: true } } },
  });
  console.log(`${offers.length} CM-singel-offers granskade.`);

  const fixes = offers
    .map((o) => ({
      id: o.id,
      title: o.product.title,
      label: o.product.variantLabel,
      from: o.url,
      to: withFirstEd(o.url, o.product.variantLabel === PRINT_FIRST_EDITION ? "only" : "exclude"),
    }))
    .filter((f) => f.to !== f.from);

  const added = fixes.filter((f) => !/[?&]isFirstEd=/i.test(f.from));
  const flipped = fixes.filter((f) => /[?&]isFirstEd=/i.test(f.from));
  console.log(`  ${fixes.length} länkar behöver ändras: ${added.length} saknade filtret, ${flipped.length} hade FEL läge.\n`);

  if (flipped.length) {
    console.log("Fel läge (dessa visade en annan tryckning än produkten):");
    for (const f of flipped.slice(0, 10))
      console.log(`  ${(f.label ?? "–").padEnd(12)} ${f.title.slice(0, 44).padEnd(44)} ${f.from.slice(-14)} → ${f.to.slice(-14)}`);
    console.log("");
  }
  for (const f of added.slice(0, 5))
    console.log(`  + ${(f.label ?? "–").padEnd(12)} ${f.title.slice(0, 44).padEnd(44)} ${f.to.slice(-12)}`);

  if (!APPLY) {
    console.log("\nTorrkörning klar — inget skrevs. Kör om med --apply.");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (let i = 0; i < fixes.length; i += CHUNK) {
    await Promise.all(
      fixes.slice(i, i + CHUNK).map((f) => prisma.offer.update({ where: { id: f.id }, data: { url: f.to } }))
    );
    done += Math.min(CHUNK, fixes.length - i);
    if (fixes.length > CHUNK) console.log(`  ${done}/${fixes.length}`);
  }
  console.log(`\nKLART: ${done} länkar har nu ett uttryckligt isFirstEd-läge.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
