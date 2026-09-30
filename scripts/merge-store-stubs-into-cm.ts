/**
 * Butiksskapade produkter → deras Cardmarket-produkt (2026-09-30).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-store-stubs-into-cm.ts           (torrkörning)
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-store-stubs-into-cm.ts --apply
 *
 * Sedan 2026-09-30 skapar butiker inga produkter; katalogen föds ur Cardmarket. Men
 * butikerna HADE skapat produkter i två månader (inkl. hela deck-/Build & Battle-linjen
 * som CM-importen inte kände till), och ägaren gömde dubbletterna — med deras
 * butikspriser kvar på den gömda raden, osynliga. Det här skriptet för över dem.
 *
 * Domen är DETERMINISTISK — samma som butiksimportens länkning, utan LLM:
 * `matchProduct` ≥ 0,85 eller identisk identitet, mot BARA synliga CM-produkter,
 * samma språk och samma kategori.
 *
 * Riktning:
 *  - GÖMD butiksprodukt ⇒ `mergeStubInto` (butikslänkar + bevakningar flyttas till CM-produkten).
 *  - SYNLIG butiksprodukt ⇒ den ÖVERLEVER och får CM-identiteten (CM-offern flyttas hit,
 *    CM-namnet adopteras) om CM-produkten är tom (inga bevakningar/samlingsposter/historik).
 *    Prishistoriken byggs bara framåt — den får aldrig kastas för att en tom rad kom senare.
 *    Annars rapporteras paret och ingenting görs.
 */
import { prisma } from "../src/lib/db";
import { cleanListingTitle, identicalIdentity, loadMatchIndex, matchProduct } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { adoptCmName } from "../src/jobs/adopt-cm-name";

const APPLY = process.argv.includes("--apply");
const NOT_THE_PRODUCT = /ej samlarskick|\bb[- ]?grade\b|ripped|skadad|damaged|trasig|öppnad|opened|\(\s*\d+\s*(?:pack|st|pcs)\s*\)/i;
/** Ett olöst "A / B"-val (resolveVariantPick hittade inget valt alternativ) — vilken av dem vet vi inte. */
const UNRESOLVED_CHOICE = /[A-Za-zé]{3,}\s*\/\s*[A-Za-zé]{3,}/;

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket saknas");
  const sealed = { cardId: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] as never[] } };
  const stubs = await prisma.product.findMany({
    where: { ...sealed, offers: { none: { retailerId: cm.id } } },
    select: { id: true, title: true, category: true, language: true, hiddenAt: true },
  });
  const cmProducts = await prisma.product.findMany({
    where: { ...sealed, hiddenAt: null, offers: { some: { retailerId: cm.id } } },
    select: {
      id: true, title: true, category: true, language: true,
      _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
    },
  });
  const cmById = new Map(cmProducts.map((p) => [p.id, p]));
  const index = (await loadMatchIndex()).filter((p) => cmById.has(p.id));

  // Vilken CM-produkt blev redan övertagen av en synlig stubb i den här körningen?
  const survivorFor = new Map<string, string>();
  let merged = 0, adopted = 0, reported = 0, none = 0;
  // Synliga först, så de hinner bli överlevare innan gömda slås ihop in i dem.
  stubs.sort((a, b) => Number(!!a.hiddenAt) - Number(!!b.hiddenAt));

  let skippedCondition = 0;
  for (const s of stubs) {
    // Skadade/öppnade exemplar och flerpack är inte produkten — deras pris får aldrig bli
    // produktens lägsta pris. De förblir gömda.
    if (NOT_THE_PRODUCT.test(s.title)) { skippedCondition++; continue; }
    const clean = cleanListingTitle(s.title);
    if (UNRESOLVED_CHOICE.test(clean.replace(/display\s*\/\s*booster/gi, ""))) { skippedCondition++; continue; }
    const norm = normalizeTitle(clean);
    const m = await matchProduct(norm, index, clean);
    let targetId: string | null = null;
    if (m) {
      const t = cmById.get(m.productId)!;
      if (m.confidence >= 0.85 || identicalIdentity(norm, normalizeTitle(t.title))) targetId = t.id;
    }
    if (!targetId) { none++; continue; }
    const t = cmById.get(targetId)!;
    if (t.language !== s.language || t.category !== s.category) {
      reported++;
      console.log(`  ⚠️ språk/kategori skiljer: "${s.title}" [${s.language}/${s.category}] ≈ "${t.title}" [${t.language}/${t.category}]`);
      continue;
    }
    const survivor = survivorFor.get(targetId) ?? targetId;

    if (s.hiddenAt || survivor !== targetId) {
      merged++;
      console.log(`  🔀 ${s.hiddenAt ? "gömd " : "synlig"} "${s.title}"  →  "${survivor === targetId ? t.title : "(övertagen rad)"}"`);
      if (APPLY) await mergeStubInto(s.id, survivor, () => {});
      continue;
    }
    // Synlig stubb: den överlever om CM-raden är tom.
    const empty = t._count.watchlistItems === 0 && t._count.collectionItems === 0 && t._count.priceSnapshots === 0;
    if (!empty) {
      reported++;
      console.log(`  ⚠️ båda har historik/användare — granska: "${s.title}"  ≈  "${t.title}"`);
      continue;
    }
    adopted++;
    survivorFor.set(targetId, s.id);
    console.log(`  🏷️ synlig "${s.title}" tar över CM-identiteten från "${t.title}"`);
    if (APPLY) {
      // CM-offern flyttas FÖRST: mergeStubInto raderar med flit marknadsplatslänkar i
      // stället för att flytta dem (de är ogranskade påståenden) — här ÄR länken beviset.
      await prisma.offer.updateMany({ where: { productId: t.id, retailerId: cm.id }, data: { productId: s.id } });
      const cmProduct = await prisma.product.findUnique({ where: { id: t.id }, select: { setId: true, imageUrl: true } });
      await mergeStubInto(t.id, s.id, () => {});
      // CM-radens set-etikett och CM-bild är bättre än butikens foto (ägarens preferens).
      await prisma.product.update({
        where: { id: s.id },
        data: { ...(cmProduct?.setId ? { setId: cmProduct.setId } : {}), ...(cmProduct?.imageUrl ? { imageUrl: cmProduct.imageUrl } : {}) },
      });
      await adoptCmName(s.id, t.title);
    }
  }
  console.log(
    `\n${stubs.length} butiksskapade produkter utan CM-länk: ${merged} slås ihop, ${adopted} tar över CM-identiteten, ` +
      `${reported} att granska, ${none} utan säker CM-motsvarighet, ${skippedCondition} skadade/flerpack orörda.${APPLY ? "" : " (torrkörning)"}`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
