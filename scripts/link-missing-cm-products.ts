/**
 * Ger befintliga katalogprodukter den CARDMARKET-LÄNK de saknar (+ CM-bilden).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-missing-cm-products.ts
 *   ... --apply
 *
 * En produkt utan CM-offer lever bara på butikslänkar: ingen prisgraf, ingen
 * "Lägsta pris"-referens, ingen daglig prisuppdatering — och den visar butikens
 * FOTO i stället för Cardmarkets rena render.
 *
 * ⛔ MATCHNINGEN ÄR IDENTITET + FORM, aldrig likhet. `identicalIdentity` räknar bort
 *    formorden med flit, så "…Booster Series 1" och "…Collection Series 1" är
 *    identiska för den — därav formkravet. En påse är inte en samlarbox.
 * ⛔ ETT idProduct FÅR ÄGAS AV EXAKT EN PRODUKT. Utan den vakten ville körningen ge
 *    "First Partner Illustration COLLECTION: Series 1 Promo Booster Pack" id 875198,
 *    som redan tillhör "…BOOSTER Series 1" — två produkter hade då visat samma
 *    prisgraf och samma länk, och den ena hade varit fel. Mätt i torrkörningen.
 * ⛔ Priset skrivs `null` när CM saknar annons — ALDRIG 0.
 * ⛔ Bilden byts BARA vid exakt idProduct-match (aldrig fuzzy), och pekas på vår egen
 *    proxy `/api/cm-image/<id>` — samma form som övriga CM-länkade produkter.
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
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { cmImageProxyUrl, cmRenderExists } from "../src/lib/cm-image";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

async function main() {
  const rates = await getRatesOre();
  const api = JSON.parse(fs.readFileSync(CACHE, "utf-8")) as {
    name: string; cardmarket_id: number | null; image?: string;
    prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null } | null } | null;
  }[];
  const r = await fetch(NONSINGLES_URL);
  const j = (await r.json()) as { products: { idProduct: number; name: string }[] };
  const idByName = new Map<string, number>();
  const dupe = new Set<string>();
  for (const p of j.products) {
    const k = p.name.toLowerCase().trim();
    if (idByName.has(k)) { dupe.add(k); idByName.delete(k); } else if (!dupe.has(k)) idByName.set(k, p.idProduct);
  }
  backfillCardmarketIds(api, idByName);

  const cm = await prisma.retailer.findUnique({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // Vilka idProduct ÄGS redan? (En länk per produkt — se filhuvudet.)
  const owned = new Map<number, string>();
  for (const o of await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { url: true, product: { select: { title: true } } },
  })) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) owned.set(parseInt(m[1], 10), o.product?.title ?? "?");
  }

  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, language: "EN", hiddenAt: null },
    select: { id: true, title: true, slug: true, normalizedTitle: true, language: true, imageUrl: true,
              offers: { select: { retailer: { select: { name: true } } } } },
  });
  const missing = ours.filter((p) => !p.offers.some((o) => o.retailer.name === "Cardmarket"));

  let linked = 0, blockedOwned = 0;
  for (const p of missing) {
    const form = classifyForm(p.normalizedTitle);
    const twin = api.find(
      (a) =>
        a.cardmarket_id != null &&
        classifyForm(a.name) === form &&
        identicalIdentity(p.normalizedTitle, normalizeTitle(a.name)) &&
        !productsConflict(a.name, p.normalizedTitle, p.language)
    );
    if (!twin?.cardmarket_id) continue;
    const cmid = twin.cardmarket_id;
    if (owned.has(cmid)) {
      blockedOwned++;
      console.log(`⛔ HOPPAR  "${p.title}"\n     id ${cmid} ägs redan av "${owned.get(cmid)}"`);
      continue;
    }
    const c = twin.prices?.cardmarket ?? {};
    const low = c.lowest ?? null;
    const eur = low ?? c["30d_average"] ?? null;
    const priceOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
    // ⛔ ATT TCGGO HAR EN BILD BETYDER INTE ATT CARDMARKET HAR EN EGEN RENDER.
    //    Hundratals blistrar, checklanes och pin collections saknar den, och pekas
    //    imageUrl på proxyn ändå blir rutan TOM i katalogen. Första versionen av det
    //    här skriptet gjorde precis det och tomm-lade tre Delta Reign-blistrar —
    //    varningen stod ordagrant i src/lib/cm-image.ts. CM:s render först, annars
    //    TCGGO:s (som ÄR CM:s bild, serverad av leverantören). Aldrig en tom ruta.
    const newImage = (await cmRenderExists(cmid)) ? cmImageProxyUrl(cmid) : (twin.image ?? null);

    linked++;
    console.log(
      `${APPLY ? "LÄNKAR " : "SKULLE "} "${p.title}"\n` +
      `     → CM ${cmid}  ${eur == null ? "utan pris" : `${eur} €`}${newImage ? (newImage.startsWith("/api/") ? "  + CM-bild" : "  + TCGGO-bild") : ""}`
    );
    if (APPLY) {
      owned.set(cmid, p.title);
      await prisma.offer.create({
        data: {
          productId: p.id, retailerId: cm.id, condition: "SEALED", language: "EN",
          price: priceOre, currency: "SEK",
          stockStatus: low != null ? "IN_STOCK" : "OUT_OF_STOCK",
          url: cardmarketProductUrl(cmid),
        },
      });
      if (newImage) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: newImage } });
    }
  }
  console.log(`\n${APPLY ? "Länkade" : "Skulle länka"}: ${linked}   blockerade (id ägs redan): ${blockedOwned}   utan CM-länk totalt: ${missing.length}`);
  if (!APPLY) console.log("Torrkörning — inget skrevs.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
