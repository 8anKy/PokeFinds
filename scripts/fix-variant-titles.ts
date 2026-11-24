/**
 * VARIANTPRODUKTER MED DET VANLIGA KORTETS TITEL (2026-11-24).
 *
 * `import-tcg-data.ts` döpte om "kortets produkt" utan att fråga VILKEN — för 59 Delta Reign-kort
 * blev det Reverse Holo-produkten: den heter "Hakamo-o · Delta Reign 74/103" medan det vanliga
 * kortet heter "Hakamo-o · Delta Reign 74". Länkarna (Cardmarket, Tradera) sitter rätt — det är
 * NAMNEN som är förväxlade, så katalogen, söket och Discord visar fel tryckning. Importen är lagad;
 * det här skriptet rättar titlarna:
 *   vanliga kortet   → "<namn> · <set> <nummer>/<tryckt total>"
 *   variantprodukten → "<vanliga kortets titel> · <etikett>"
 * Slugen rörs aldrig (publicerade adresser). Bara titel + normalizedTitle.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-variant-titles.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-variant-titles.ts --apply
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { enProductTitle } from "../src/lib/catalog-gap-identity";
import { exitJob } from "../src/lib/job-exit";

const APPLY = process.argv.includes("--apply");

async function main() {
  const variants = await prisma.product.findMany({
    where: { game: "POKEMON", category: "SINGLE_CARD", variantLabel: { not: null }, cardId: { not: null } },
    select: {
      id: true, title: true, variantLabel: true, cardId: true,
      card: { select: { name: true, number: true, set: { select: { name: true, totalCards: true } } } },
    },
  });
  const wrong = variants.filter((v) => !v.title.toLowerCase().includes(v.variantLabel!.toLowerCase()));
  console.log(`${variants.length} variantprodukter, ${wrong.length} med en titel som saknar sin etikett.`);
  let renamedBase = 0, renamedVariant = 0, skipped = 0;
  for (const v of wrong) {
    const base = await prisma.product.findFirst({ where: { cardId: v.cardId, category: "SINGLE_CARD", variantLabel: null }, select: { id: true, title: true } });
    const card = v.card!;
    if (!base) {
      skipped++;
      console.log(`  HOPPAR ${v.title} [${v.variantLabel}] — kortet har ingen etikettlös produkt`);
      continue;
    }
    // Det vanliga kortets titel: den form importen ger (med tryckt total när den är känd).
    const total = card.set.totalCards > 0 ? card.set.totalCards : null;
    const baseTitle = enProductTitle(card.name, card.set.name, card.number, total);
    const variantTitle = `${baseTitle} · ${v.variantLabel}`;
    if (renamedVariant < 8) console.log(`  "${base.title}" → "${baseTitle}"   |   "${v.title}" → "${variantTitle}"`);
    if (base.title !== baseTitle) {
      renamedBase++;
      if (APPLY) await prisma.product.update({ where: { id: base.id }, data: { title: baseTitle, normalizedTitle: normalizeTitle(baseTitle) } });
    }
    renamedVariant++;
    if (APPLY) await prisma.product.update({ where: { id: v.id }, data: { title: variantTitle, normalizedTitle: normalizeTitle(variantTitle) } });
  }
  console.log(`\n${APPLY ? "Rättade" : "Skulle rätta"} ${renamedVariant} variantprodukter och ${renamedBase} vanliga kort · hoppade ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
