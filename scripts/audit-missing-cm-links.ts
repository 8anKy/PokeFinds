/**
 * VILKA KATALOGPRODUKTER SAKNAR CARDMARKET-LÄNK — och finns den att hämta?
 * Ren rapport, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-missing-cm-links.ts
 *
 * En produkt utan CM-offer har varken prisgraf, "Lägsta pris"-referens eller daglig
 * prisuppdatering — den lever bara på butikslänkar. Källan till länken är TCGGO:s
 * sealed-katalog (`cardmarket_id`), med CM:s GRATIS nonsingles-katalog som reserv för
 * id:n RapidAPI ännu inte fyllt i (nya set, se CLAUDE.md).
 *
 * ⛔ Matchningen är IDENTITET + FORM, samma vakt som importen: `identicalIdentity`
 *    räknar bort formorden med flit, så "…Booster Series 1" och "…Collection Series 1"
 *    är identiska för den. En påse är inte en samlarbox.
 */
import * as fs from "fs";
import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
import { PrismaClient } from "@prisma/client";
import { classifyForm, identicalIdentity, productsConflict } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { backfillCardmarketIds } from "../src/lib/cm-catalog-names";

const prisma = new PrismaClient();
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

async function main() {
  const api = JSON.parse(fs.readFileSync(CACHE, "utf-8")) as {
    name: string; cardmarket_id: number | null; image?: string;
    prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null } | null } | null;
  }[];

  // Reserv-id ur CM:s gratiskatalog (exakt namn) — samma väg som importen.
  const r = await fetch(NONSINGLES_URL);
  const j = (await r.json()) as { products: { idProduct: number; name: string }[] };
  const idByName = new Map<string, number>();
  const dupe = new Set<string>();
  for (const p of j.products) {
    const k = p.name.toLowerCase().trim();
    if (idByName.has(k)) { dupe.add(k); idByName.delete(k); } else if (!dupe.has(k)) idByName.set(k, p.idProduct);
  }
  const bf = backfillCardmarketIds(api, idByName);
  console.log(`CM-gratiskatalog: ${j.products.length} produkter · backfill fyllde ${bf.filled} id`);

  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, language: "EN", hiddenAt: null },
    select: { id: true, title: true, slug: true, normalizedTitle: true, language: true, imageUrl: true,
              offers: { select: { retailer: { select: { name: true } } } } },
  });
  const missing = ours.filter((p) => !p.offers.some((o) => o.retailer.name === "Cardmarket"));
  console.log(`\nEngelska sealed-produkter: ${ours.length}  ·  UTAN CM-länk: ${missing.length}`);

  let linkable = 0, apiNoId = 0, noTwin = 0;
  const rows: string[] = [];
  const noIdRows: string[] = [];
  for (const p of missing) {
    const form = classifyForm(p.normalizedTitle);
    const twin = api.find(
      (a) =>
        classifyForm(a.name) === form &&
        identicalIdentity(p.normalizedTitle, normalizeTitle(a.name)) &&
        !productsConflict(a.name, p.normalizedTitle, p.language)
    );
    if (!twin) { noTwin++; continue; }
    if (twin.cardmarket_id == null) {
      apiNoId++;
      if (noIdRows.length < 12) noIdRows.push(`   "${p.title.slice(0, 52)}"`);
      continue;
    }
    linkable++;
    const c = twin.prices?.cardmarket ?? {};
    const eur = c.lowest ?? c["30d_average"] ?? null;
    if (rows.length < 25)
      rows.push(`   cm_id=${String(twin.cardmarket_id).padStart(7)}  ${eur == null ? "utan pris" : `${eur} €`.padEnd(9)}  ` +
                `${twin.image ? "CM-bild" : "ingen bild"}  ${p.title.slice(0, 44)}`);
  }
  console.log(`  · KAN LÄNKAS (TCGGO/CM har id):   ${linkable}`);
  console.log(`  · finns hos TCGGO men UTAN id:    ${apiNoId}   (nytt set — CM har inte produkten än)`);
  console.log(`  · ingen motsvarighet alls:        ${noTwin}`);
  if (rows.length) console.log(`\nEXEMPEL som kan länkas:\n${rows.join("\n")}`);
  if (noIdRows.length) console.log(`\nEXEMPEL utan id (inget att länka till än):\n${noIdRows.join("\n")}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
