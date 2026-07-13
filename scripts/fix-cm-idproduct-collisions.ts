/**
 * EN CARDMARKET-PRODUKT = EN KATALOGPRODUKT.
 *
 * PROBLEMET (mätt 2026-07-14): 16 CM-idProduct ägdes av FLERA av våra produkter. Alla utom
 * en av dem visar då en FRÄMMANDE prisgraf — Cardmarkets kurva för någon annans vara.
 *   idProduct=579732  CM: "Kanto Power Mini Tin 5-Pack Box"
 *      ägdes även av "Pokémon TCG: Kanto Power Mini Tin" → en enskild tin prissatt 1 222 kr.
 * Det bryter mot projektets grundregel: inga fabricerade priser, bara verifierade källor.
 * Orsak: bestSealedMatch (cardmarket-refresh) matchar globalt på namn med GLOBAL_MIN_SCORE
 * 0,72 och har ingen unikhetsvakt — flera titlar kan vinna samma CM-produkt.
 *
 * FACIT ÄR CARDMARKETS EGEN KATALOG. products_nonsingles_6.json ger idProduct → namn,
 * auktoritativt och gratis. Vi GISSAR alltså inte vem som äger vad — vi frågar källan.
 *
 * ÄGARREGEL (i tur och ordning):
 *   1. Ingen tvåsidig vakt får säga att titlarna är olika produkter (productsConflict).
 *   2. FORMEN måste stämma med CM:s namn — "Chaos Rising Booster" är en PÅSE, inte en
 *      checklane. Utan formkravet vann checklane-produkten på Dice-poäng (0,63 mot 0,54),
 *      för Dice straffar den längre titeln. Poäng får aldrig ensam avgöra ägarskap.
 *   3. Högst likhet mot CM:s namn.
 * Blir det oavgjort (ingen kandidat passerar 1+2) rörs INGENTING — då får en människa titta.
 *
 * De som FÖRLORAR ägarskapet får sin CM-offer BORTTAGEN. De behåller sina butikslänkar och
 * sitt riktiga pris; de slutar bara visa någon annans kurva. Att visa INGEN graf är alltid
 * bättre än att visa FEL graf.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-idproduct-collisions.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-cm-idproduct-collisions.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { classifyForm, productsConflict, scoreSimilarity } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const CM_CATALOG = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;
const idFromUrl = (u: string) => u.match(/idProduct=(\d+)/)?.[1] ?? null;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  const res = await fetch(CM_CATALOG);
  if (!res.ok) throw new Error(`CM-katalogen svarade ${res.status}`);
  const raw = (await res.json()) as { products: { idProduct: number; name: string }[] };
  const cmName = new Map<string, string>();
  for (const x of raw.products) cmName.set(String(x.idProduct), x.name);
  console.log(`Cardmarkets katalog: ${cmName.size} produkter (facit).\n`);

  const all = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: {
      id: true,
      title: true,
      offers: { select: { id: true, url: true, retailer: { select: { name: true } } } },
      _count: { select: { priceSnapshots: true } },
    },
  });

  const byCm = new Map<string, { pid: string; title: string; offerId: string; snaps: number }[]>();
  for (const prod of all) {
    for (const o of prod.offers) {
      if (o.retailer.name !== "Cardmarket") continue;
      const id = idFromUrl(o.url);
      if (!id) continue;
      if (!byCm.has(id)) byCm.set(id, []);
      byCm.get(id)!.push({ pid: prod.id, title: prod.title, offerId: o.id, snaps: prod._count.priceSnapshots });
    }
  }

  const collisions = [...byCm.entries()].filter(([, v]) => new Set(v.map((z) => z.pid)).size > 1);
  console.log(`${collisions.length} idProduct ägs av flera produkter.\n`);

  const toDelete: { offerId: string; title: string; id: string }[] = [];
  let unresolved = 0;

  for (const [id, rows] of collisions) {
    const uniq = [...new Map(rows.map((x) => [x.pid, x])).values()];
    const truth = cmName.get(id);

    if (!truth) {
      // idProduct finns inte i CM:s katalog → offern pekar på ingenting. Ta bort ALLA.
      console.log(`\nidProduct=${id}  ⚠ FINNS INTE i CM-katalogen — alla offers är skräp`);
      for (const z of uniq) {
        console.log(`   ta bort  "${z.title.slice(0, 60)}"`);
        toDelete.push({ offerId: z.offerId, title: z.title, id });
      }
      continue;
    }

    const cmForm = classifyForm(normalizeTitle(truth));
    const eligible = uniq
      .filter((z) => !productsConflict(z.title, truth))
      // FORMEN MÅSTE STÄMMA. Utan detta vann "Chaos Rising CHECKLANE Booster" över
      // "Chaos Rising Booster PACK" på Dice-poäng — fast CM:s namn är en påse.
      .filter((z) => cmForm === null || classifyForm(normalizeTitle(z.title)) === cmForm)
      .map((z) => ({ ...z, sim: scoreSimilarity(normalizeTitle(z.title), normalizeTitle(truth)) }))
      .sort((a, b) => b.sim - a.sim);

    console.log(`\nidProduct=${id}  CM: "${truth}"  (form: ${cmForm ?? "okänd"})`);
    if (eligible.length === 0) {
      unresolved++;
      console.log(`   ⚠ INGEN kandidat passerar vakterna/formkravet → RÖRS EJ (människa får avgöra)`);
      uniq.forEach((z) => console.log(`      "${z.title.slice(0, 60)}"`));
      continue;
    }

    const owner = eligible[0];
    console.log(`   ✓ ÄGARE  sim=${owner.sim.toFixed(2)} snaps=${owner.snaps}  "${owner.title.slice(0, 56)}"`);
    for (const z of uniq) {
      if (z.pid === owner.pid) continue;
      console.log(`   ✗ ta bort CM-offern  "${z.title.slice(0, 56)}"  (visar just nu ${owner.title.slice(0, 30)}s kurva)`);
      toDelete.push({ offerId: z.offerId, title: z.title, id });
    }
  }

  console.log(
    `\n${toDelete.length} CM-offers ${APPLY ? "raderas" : "skulle raderas"} · ${unresolved} kollisioner lämnas för granskning.`
  );

  if (!APPLY) {
    await prisma.$disconnect();
    return;
  }
  await prisma.offer.deleteMany({ where: { id: { in: toDelete.map((d) => d.offerId) } } });
  await recomputeProductPriceCache();
  console.log(`✓ ${toDelete.length} främmande CM-offers borttagna. Prisscachen omräknad.`);
  console.log(`  De produkterna behåller sina butikslänkar; de slutar bara visa fel kurva.`);
  console.log(`  cardmarket-refresh kan re-mappa dem korrekt (med unikhetsvakten på plats).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
