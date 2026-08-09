/**
 * NAMNTVÄTT: BUTIKSFRASER → CARDMARKETS KATALOGNAMN (ägarbeslut 2026-08-09).
 *
 * Auto-importerade stubbar bär butikens titel ("FÖRBOKNING! Pokemon 30th
 * Anniversary Celebration M6 MEGA Booster Box (Japansk)") fast produkten
 * sedan länge har en betrodd CM-identitet (idProduct i CM-offerns URL).
 * Skriptet byter titeln till CM:s EGEN katalognamn för exakt de produkterna:
 * "30th Celebration JP Booster Box". Framåt sköts nya stubbar av
 * `adoptCmName()` i cardmarket-refresh (namnet adopteras när identiteten
 * avgörs) — det här städar det som redan ligger i katalogen.
 *
 * FACIT = products_nonsingles_6.json (CM:s publika sealed-katalog, gratis,
 * ingen RapidAPI-kvot). Vi tar namnet från det idProduct VÅR EGEN länk redan
 * bär — ingen fuzzy-matchning, ingen gissning. Är länken fel är det ett fel
 * för fix-cm-idproduct-mismatches.ts, inte för det här skriptet.
 *
 * VAKTER:
 *   - Bara sealed (SINGLE_CARD/GRADED_CARD/ACCESSORY rörs aldrig — singlarnas
 *     namn kommer från pokemontcg.io och är redan rätt).
 *   - KOLLISION: bär en annan produkt (samma språk) redan det normaliserade
 *     namnet skrivs inget — boxart-varianter ([GVSE]/[LUJF]) och medvetet
 *     åtskilda rader får aldrig kollapsa till samma titel.
 *   - Sluggen rörs ALDRIG (publicerade URL:er i Google-index och larm-mejl).
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/adopt-cm-names.ts
 *       node scripts/with-prod-db.mjs npx tsx scripts/adopt-cm-names.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const NONSINGLES =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

async function main() {
  const r = await fetch(NONSINGLES);
  if (!r.ok) throw new Error(`nonsingles-katalog HTTP ${r.status}`);
  const catalog = (await r.json()) as { products: { idProduct: number; name: string }[] };
  const cmNameById = new Map(catalog.products.map((p) => [p.idProduct, p.name.trim()]));
  console.log(`CM-katalog: ${cmNameById.size} sealed-produkter.`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas.");

  const products = await prisma.product.findMany({
    where: {
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
      offers: { some: { retailerId: cm.id, url: { contains: "idProduct=" } } },
    },
    select: {
      id: true, title: true, normalizedTitle: true, language: true,
      offers: { where: { retailerId: cm.id }, select: { url: true } },
    },
  });
  console.log(`${products.length} sealed-produkter med CM-länk (idProduct).`);

  // Kollisionsvakt: normaliserad titel + språk → produkt-id, över HELA katalogen
  // (inte bara urvalet) + de namn som delas ut i den här körningen.
  const allTitles = await prisma.product.findMany({
    select: { id: true, normalizedTitle: true, language: true },
  });
  const taken = new Map<string, string>();
  for (const p of allTitles) taken.set(`${p.language}|${p.normalizedTitle}`, p.id);

  let renames = 0, same = 0, unknownId = 0, collisions = 0;
  const plan: { id: string; title: string; normalizedTitle: string; old: string }[] = [];

  for (const p of products) {
    const m = p.offers.map((o) => o.url?.match(/idProduct=(\d+)/)).find(Boolean);
    if (!m) continue;
    const cmName = cmNameById.get(parseInt(m[1], 10));
    if (!cmName) { unknownId++; continue; } // t.ex. länk mot en singel/utgången rad — inte vårt jobb
    if (cmName === p.title) { same++; continue; }

    const normalized = normalizeTitle(cmName);
    const key = `${p.language}|${normalized}`;
    const owner = taken.get(key);
    if (owner && owner !== p.id) {
      collisions++;
      console.log(`  KOLLISION  "${p.title}" → "${cmName}" ägs redan av ${owner} — hoppar över.`);
      continue;
    }
    taken.set(key, p.id);
    plan.push({ id: p.id, title: cmName, normalizedTitle: normalized, old: p.title });
  }

  console.log("");
  for (const row of plan) console.log(`  "${row.old}"\n    → "${row.title}"`);
  console.log(`\n${plan.length} namnbyten · ${same} redan CM-namn · ${unknownId} okänt idProduct · ${collisions} kollisioner.`);

  if (!APPLY) {
    console.log("\nTORRKÖRNING — inget skrivet. Kör med --apply för att byta namnen.");
    return;
  }
  for (const row of plan) {
    await prisma.product.update({
      where: { id: row.id },
      data: { title: row.title, normalizedTitle: row.normalizedTitle },
    });
    renames++;
  }
  console.log(`\nKLART: ${renames} produkter omdöpta (slug orörd).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
