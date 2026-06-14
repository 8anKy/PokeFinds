/**
 * Skapar sealed-produkter (booster box/pack, ETB, collection box, tin, blister,
 * bundle) ur Cardmarket-katalogen (CardMarket API TCG) som vi inte redan har —
 * med lägsta CM-pris + lagerstatus (available_items). Fyller bl.a. ALLA tins.
 *
 * Dry run:  npx tsx scripts/import-sealed-from-cardmarket.ts
 * Skriv:    APPLY=1 npx tsx scripts/import-sealed-from-cardmarket.ts
 * Filtrera: CATEGORIES=TIN,BLISTER APPLY=1 npx tsx scripts/import-sealed-from-cardmarket.ts
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
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { classifyForm } from "../src/scrapers/matching";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS ?? "220", 10);
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const ONLY = process.env.CATEGORIES?.split(",").map((s) => s.trim().toUpperCase());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/é/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const FORM_TO_CAT: Record<string, ProductCategory> = {
  display: "BOOSTER_BOX", booster: "BOOSTER_PACK", etb: "ETB",
  collection: "COLLECTION_BOX", tin: "TIN", blister: "BLISTER", bundle: "BUNDLE",
};

interface ApiProduct {
  name: string; slug?: string; cardmarket_id: number | null; image?: string;
  prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null; available_items?: number | null } | null } | null;
  episode?: { name?: string } | null;
}

async function loadCatalog(): Promise<ApiProduct[]> {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 6 * 3600_000) {
    return JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  }
  if (!KEY) throw new Error("Cache saknas och CARDMARKET_RAPIDAPI_KEY ej satt");
  const out: ApiProduct[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon/products?page=${page}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (!r.ok) break;
    const d = (await r.json()) as { data: ApiProduct[]; paging: { total: number } };
    total = d.paging.total;
    out.push(...d.data);
    await sleep(THROTTLE_MS);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

async function main() {
  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // Dedup: cardmarket_id ur befintliga CM-offer-URL:er + (normTitle|kategori)
  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { url: true },
  });
  const existingCmIds = new Set<number>();
  for (const o of cmOffers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) existingCmIds.add(parseInt(m[1], 10));
  }
  const existingTitles = new Set(
    (await prisma.product.findMany({ select: { normalizedTitle: true, category: true } }))
      .map((p) => `${p.category}|${p.normalizedTitle}`)
  );
  const usedSlugs = new Set((await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug));

  const sets = await prisma.cardSet.findMany({ select: { id: true, name: true } });
  const setMap = new Map(sets.map((s) => [norm(s.name), s.id]));

  const catalog = await loadCatalog();
  console.log(`CM-katalog: ${catalog.length} · APPLY=${APPLY}${ONLY ? ` · endast ${ONLY.join(",")}` : ""}\n`);

  const stat: Record<string, number> = {};
  let skippedHave = 0, skippedNoData = 0, skippedForm = 0, created = 0;

  for (const p of catalog) {
    const form = classifyForm(p.name ?? "");
    const cat = form ? FORM_TO_CAT[form] : undefined;
    if (!cat) { skippedForm++; continue; }
    if (ONLY && !ONLY.includes(cat)) continue;
    const cmid = p.cardmarket_id;
    const normTitle = norm(p.name);
    if ((cmid != null && existingCmIds.has(cmid)) || existingTitles.has(`${cat}|${normTitle}`)) { skippedHave++; continue; }

    const c = p.prices?.cardmarket ?? {};
    // I lager = aktuell billigaste annons (`lowest`/From) finns → visa From-priset.
    // Ur lager = ingen aktuell annons (lowest saknas) → OUT_OF_STOCK + 30d-snittet
    // som uppskattat värde. Dagliga refreshen flippar tillbaka till From när en
    // annons dyker upp igen.
    const low = c.lowest ?? null;
    const avg = c["30d_average"] ?? null;
    if (low == null && avg == null) { skippedNoData++; continue; }
    const eur = low ?? avg;
    const priceOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
    const stockStatus = low != null ? "IN_STOCK" : "OUT_OF_STOCK";
    const setId = setMap.get(norm(p.episode?.name ?? "")) ?? null;

    let slug = slugify(p.name) || `cm-${cmid}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${cmid}`;
    usedSlugs.add(slug);
    existingTitles.add(`${cat}|${normTitle}`);
    if (cmid != null) existingCmIds.add(cmid);

    stat[cat] = (stat[cat] ?? 0) + 1;
    created++;

    if (APPLY) {
      await prisma.product.create({
        data: {
          title: p.name, normalizedTitle: normTitle, slug, category: cat, setId,
          imageUrl: p.image ?? null, language: "EN",
          offers: cmid != null ? {
            create: {
              retailerId: cm.id, condition: "SEALED", language: "EN",
              price: priceOre, currency: "SEK", stockStatus,
              url: cardmarketProductUrl(cmid),
            },
          } : undefined,
        },
      });
    }
  }

  console.log("Skapas per kategori:");
  for (const [c, n] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);
  console.log(`\nTotalt nya: ${created}`);
  console.log(`Skippade — har redan: ${skippedHave} · ingen data: ${skippedNoData} · ej målform: ${skippedForm}`);
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skapa produkterna)");
}

main().finally(() => prisma.$disconnect());
