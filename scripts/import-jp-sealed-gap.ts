/**
 * Importerar TCGGO:s JAPANSKA sealed-produkter vi saknar. Torrkörning som default.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-jp-sealed-gap.ts
 *   ... --apply
 *
 * ⛔ EGEN ENDPOINT: `/pokemon-jp/products`. Den västerländska är engelsk-only och
 *    `?language=japanese` ignoreras TYST (jp-sets.md) — den kan aldrig ge JP-produkter.
 *
 * ⛔ CARDMARKET-ID:t KOMMER INTE FRÅN TCGGO: bara 12 av 258 JP-produkter bär
 *    `cardmarket_id` (samma tomhet som JP-singlarna). Det hämtas i stället ur CM:s
 *    GRATIS nonsingles-katalog på exakt namn — MEN den katalogen är HELA Cardmarket,
 *    engelska produkter inkluderade, och JP/EN delar latinska namn ("151",
 *    "Black Bolt"). Ett bart namnuppslag hade därför gett japanska produkter ENGELSKA
 *    id:n, tyst. Kandidaten måste ligga i en JP-EXPANSION (CardSet.cmExpansionId),
 *    exakt samma regel som JP-prisjobbet redan följer.
 *
 * ⛔ JP-sealed har inget `lowest` — bara `30d_average`. Priset skrivs som ett
 *    OUT_OF_STOCK-riktvärde, aldrig som "i lager".
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
import { PrismaClient, type ProductCategory } from "@prisma/client";
import { classifyForm, identicalIdentity, productsConflict } from "../src/scrapers/matching";
import { normalizeTitle, slugify } from "../src/lib/utils";
import { cardmarketJapaneseProductUrl } from "../src/lib/marketplace-urls";
import { getRatesOre } from "../src/lib/exchange-rate";
import { loadJpCatalog } from "./audit-tcggo-jp-gap";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const WHOLESALE_RE = /\bcase\b|\bfun pack\b|(?:box|blister|bundle|collection|deck)\s+display\b|\bdisplay\s+case\b/i;
const FORM_TO_CAT: Record<string, ProductCategory> = {
  display: "BOOSTER_BOX", booster: "BOOSTER_PACK", etb: "ETB",
  collection: "COLLECTION_BOX", tin: "TIN", blister: "BLISTER", bundle: "BUNDLE",
};

async function main() {
  const rates = await getRatesOre();
  const api = await loadJpCatalog();

  const r = await fetch(NONSINGLES_URL);
  const j = (await r.json()) as { products: { idProduct: number; name: string; idExpansion?: number | null }[] };
  const jpExpansions = new Set(
    (await prisma.cardSet.findMany({ where: { language: "JP", cmExpansionId: { not: null } }, select: { cmExpansionId: true } }))
      .map((s) => s.cmExpansionId!)
  );
  const setByExpansion = new Map(
    (await prisma.cardSet.findMany({ where: { language: "JP", cmExpansionId: { not: null } }, select: { id: true, cmExpansionId: true } }))
      .map((s) => [s.cmExpansionId!, s.id])
  );
  // Namn → idProduct, BARA för produkter i en japansk expansion (se filhuvudet).
  const jpIdByName = new Map<string, number[]>();
  for (const p of j.products) {
    if (p.idExpansion == null || !jpExpansions.has(p.idExpansion)) continue;
    const k = normalizeTitle(p.name);
    jpIdByName.set(k, [...(jpIdByName.get(k) ?? []), p.idProduct]);
  }
  const expansionOf = new Map(j.products.map((p) => [p.idProduct, p.idExpansion ?? null]));
  console.log(`JP-expansioner hos oss: ${jpExpansions.size} · CM-produkter i dem: ${jpIdByName.size}`);

  const cm = await prisma.retailer.findUniqueOrThrow({ where: { name: "Cardmarket" } });
  const owned = new Set<number>();
  for (const o of await prisma.offer.findMany({ where: { retailerId: cm.id, url: { contains: "idProduct=" } }, select: { url: true } })) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) owned.add(parseInt(m[1], 10));
  }
  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { normalizedTitle: true, language: true },
  });
  const usedSlugs = new Set((await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug));

  let created = 0, dupe = 0, wholesale = 0, noForm = 0, noId = 0, ambiguous = 0, taken = 0;
  for (const p of api) {
    const form = classifyForm(p.name);
    const cat = form ? FORM_TO_CAT[form] : undefined;
    if (!cat) { noForm++; continue; }
    if (WHOLESALE_RE.test(p.name)) { wholesale++; continue; }
    const n = normalizeTitle(p.name);
    if (ours.some((o) => classifyForm(o.normalizedTitle) === form && identicalIdentity(n, o.normalizedTitle) &&
                         !productsConflict(p.name, o.normalizedTitle, o.language))) { dupe++; continue; }

    let cmid = p.cardmarket_id ?? null;
    if (cmid == null) {
      const ids = jpIdByName.get(n);
      if (!ids) { noId++; continue; }
      if (ids.length > 1) { ambiguous++; console.log(`  FLERTYDIG  ${p.name}`); continue; }
      cmid = ids[0];
    }
    if (owned.has(cmid)) { taken++; continue; }

    const avg = p.prices?.cardmarket?.["30d_average"] ?? null;
    const priceOre = avg != null ? Math.round(avg * rates.eurToOre) : null;
    const setId = setByExpansion.get(expansionOf.get(cmid) ?? -1) ?? null;
    let slug = slugify(p.name) || `cm-jp-${cmid}`;
    if (usedSlugs.has(slug)) slug = `${slug}-jp`;
    usedSlugs.add(slug);
    owned.add(cmid);
    ours.push({ normalizedTitle: n, language: "JP" });

    created++;
    console.log(`  [JP] ${cat.padEnd(14)} ${p.name.slice(0, 46).padEnd(46)} cm=${cmid} ${avg != null ? `${avg} €` : "utan pris"}${setId ? " · set" : " · SET-LÖS"}`);
    if (APPLY) {
      await prisma.product.create({
        data: {
          title: p.name, normalizedTitle: n, slug, category: cat, setId,
          imageUrl: p.image ?? null, language: "JP",
          offers: { create: {
            retailerId: cm.id, condition: "SEALED", language: "JP",
            price: priceOre, currency: "SEK", stockStatus: "OUT_OF_STOCK",
            url: cardmarketJapaneseProductUrl(cmid),
          } },
        },
      });
    }
  }
  console.log(`\n${APPLY ? "Skapade" : "Skulle skapa"}: ${created}`);
  console.log(`Skippade — redan hos oss: ${dupe} · grossist: ${wholesale} · ej målform: ${noForm} · inget JP-id: ${noId} · flertydigt: ${ambiguous} · id upptaget: ${taken}`);
  if (!APPLY) console.log("\nTorrkörning — inget skrevs.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
