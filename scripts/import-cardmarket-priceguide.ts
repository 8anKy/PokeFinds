/**
 * Importerar RIKTIGA Cardmarket-priser för sealed-produkter (EN) från
 * Cardmarkets officiella publika prisguide + produktkatalog:
 *
 *   https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json
 *   https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json
 *
 * (Officiella, publikt publicerade dataexporter — ingen scraping av cardmarket.com.)
 *
 * - Matchar våra sealed-produkter (Booster Pack/Box, ETB, m.fl.) mot CM:s
 *   nonsingles-katalog via set-namn + kategori (exakt normaliserad matchning,
 *   ingen fuzzy-gissning).
 * - Pris i EUR → SEK-öre (live kurs via getRatesOre). Vald ordning: trend → avg1 → avg7 → avg30 → avg.
 * - Skriver PriceObservation (källa "Cardmarket") + riktiga historikpunkter
 *   från CM:s egna aggregat: avg1 (−1 dag), avg7 (−7 dagar), avg30 (−30 dagar).
 * - Uppdaterar produktens Cardmarket-offer med pris (condition SEALED, EN).
 *
 * Kör: npx tsx scripts/import-cardmarket-priceguide.ts
 * Env: EUR_SEK (pinnar kursen, annars live), DRY_RUN=1 för enbart matchningsrapport.
 */
import { PrismaClient, ProductCategory } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { getRatesOre, EUR_FALLBACK_ORE } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();

// Live SEK/EUR — sätts i main() via getRatesOre (EUR_SEK-env pinnar fortfarande).
let EUR_SEK = EUR_FALLBACK_ORE / 100; // neutral fallback; main() sätter live kurs
const DRY_RUN = process.env.DRY_RUN === "1";
const CACHE_DIR = path.join(__dirname, "..", ".cache", "cardmarket");
const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

interface CmPriceGuideEntry {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

interface CmProduct {
  idProduct: number;
  name: string;
  categoryName: string;
  idExpansion: number;
}

async function loadJson<T>(url: string, cacheFile: string): Promise<T> {
  const file = path.join(CACHE_DIR, cacheFile);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, text);
  return JSON.parse(text) as T;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é → e
    .toLowerCase()
    .replace(/^pokemon tcg:\s*/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Set-namnsvarianter: våra set-namn (pokemontcg.io) vs Cardmarkets namn.
 * Ex: "151" → "Pokémon Card 151" (display/booster) men "151" (ETB),
 * "Base" → "Base Set", "HS—Triumphant" → "Triumphant", EX-eran prefixas "EX".
 */
function setNameVariants(setName: string): string[] {
  const set = normalize(setName);
  const variants = new Set<string>([set]);
  if (!set.startsWith("ex ")) variants.add(`ex ${set}`);
  // OBS: "Pokémon Card 151" hos CM är det JAPANSKA setet — får inte aliaseras
  // mot vårt engelska "151" (EN-setet saknar booster box, finns bara bundles).
  if (set === "base") variants.add("base set");
  if (set.startsWith("hs ")) variants.add(set.slice(3));
  return [...variants];
}

interface MatchRule {
  cmCategory: string;
  /** Exakt normaliserat namn. */
  exact?: string;
  /** Börjar med + innehåller (för varianter som "Paradox Rift Roaring Moon Elite Trainer Box", "...(Zacian)"). */
  startsWith?: string;
  includes?: string;
  /** Ord som diskvalificerar kandidaten. */
  exclude?: string[];
}

function matchRules(setName: string, category: ProductCategory, productTitle: string): MatchRule[] {
  const rules: MatchRule[] = [];
  const wantsPokemonCenter = normalize(productTitle).includes("pokemon center");
  for (const v of setNameVariants(setName)) {
    switch (category) {
      case "BOOSTER_PACK":
        rules.push({ cmCategory: "Pokémon Booster", exact: `${v} booster` });
        break;
      case "BOOSTER_BOX":
        rules.push({ cmCategory: "Pokémon Display", exact: `${v} booster box` });
        break;
      case "ETB":
        if (wantsPokemonCenter) {
          rules.push({
            cmCategory: "Pokémon Elite Trainer Boxes",
            startsWith: `${v} `,
            includes: "pokemon center elite trainer box",
            exclude: ["case", "plus"],
          });
        } else {
          rules.push({ cmCategory: "Pokémon Elite Trainer Boxes", exact: `${v} elite trainer box` });
          rules.push({
            cmCategory: "Pokémon Elite Trainer Boxes",
            startsWith: `${v} `,
            includes: "elite trainer box",
            exclude: ["pokemon center", "case", "plus"],
          });
        }
        break;
      case "BUNDLE":
        rules.push({ cmCategory: "Pokémon Display", exact: `${v} booster bundle` });
        rules.push({
          cmCategory: "Pokémon Display",
          startsWith: `${v} booster bundle`,
          exclude: ["display", "pokemon center", "case"],
        });
        break;
      case "BLISTER":
        rules.push({ cmCategory: "Pokémon Booster", exact: `${v} sleeved booster` });
        break;
      case "COLLECTION_BOX":
        rules.push({ cmCategory: "Pokémon Box Set", exact: `${v} collection` });
        break;
      case "TIN":
        rules.push({ cmCategory: "Pokémon Tins", exact: `${v} tin` });
        break;
      default:
        break;
    }
  }
  return rules;
}

function eurToOre(eur: number): number {
  return Math.round(eur * EUR_SEK * 100);
}

async function main() {
  EUR_SEK = (await getRatesOre()).eurToOre / 100;
  console.log(`Hämtar Cardmarket prisguide + katalog (kurs ${EUR_SEK} SEK/EUR)...`);
  const [guideRaw, catalogRaw] = await Promise.all([
    loadJson<{ createdAt: string; priceGuides: CmPriceGuideEntry[] }>(PRICE_GUIDE_URL, "price_guide_6.json"),
    loadJson<{ products: CmProduct[] }>(NONSINGLES_URL, "products_nonsingles_6.json"),
  ]);
  console.log(`Prisguide skapad: ${guideRaw.createdAt}, ${guideRaw.priceGuides.length} poster, ${catalogRaw.products.length} nonsingles`);

  const guideById = new Map<number, CmPriceGuideEntry>();
  for (const e of guideRaw.priceGuides) guideById.set(e.idProduct, e);

  // Index: categoryName → [{ norm, product }]
  const byCategory = new Map<string, { norm: string; product: CmProduct }[]>();
  for (const p of catalogRaw.products) {
    const list = byCategory.get(p.categoryName) ?? [];
    list.push({ norm: normalize(p.name), product: p });
    byCategory.set(p.categoryName, list);
  }

  function findCm(setName: string, category: ProductCategory, title: string): CmProduct | undefined {
    for (const rule of matchRules(setName, category, title)) {
      const candidates = (byCategory.get(rule.cmCategory) ?? []).filter(({ norm }) => {
        if (rule.exact != null && norm !== rule.exact) return false;
        if (rule.startsWith != null && !norm.startsWith(rule.startsWith)) return false;
        if (rule.includes != null && !norm.includes(rule.includes)) return false;
        if (rule.exclude?.some((w) => norm.includes(w))) return false;
        return true;
      });
      if (candidates.length > 0) {
        // Föredra kandidat med prisdata i guiden
        const withPrice = candidates.find((c) => guideById.get(c.product.idProduct)?.trend != null);
        return (withPrice ?? candidates[0]).product;
      }
    }
    return undefined;
  }

  const cmRetailer = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });
  const cmSource = await prisma.scrapeSource.upsert({
    where: { name: "Cardmarket" },
    create: { name: "Cardmarket", baseUrl: "https://downloads.s3.cardmarket.com", type: "API", isActive: true },
    update: { isActive: true, baseUrl: "https://downloads.s3.cardmarket.com", type: "API", lastRunAt: new Date() },
  });

  if (!DRY_RUN) {
    // Idempotens: ersätt endast observationer från SAMMA prisguide-utgåva
    // (re-import av samma fil). Äldre utgåvors punkter behålls så att
    // historiken ackumuleras över tid.
    const removed = await prisma.$executeRaw`
      DELETE FROM "PriceObservation"
      WHERE "sourceId" = ${cmSource.id}
        AND "rawData"->>'guideCreatedAt' = ${guideRaw.createdAt}`;
    if (removed > 0) console.log(`Ersätter ${removed} observationer från samma prisguide-utgåva (${guideRaw.createdAt})`);
  }

  const sealed = await prisma.product.findMany({
    where: {
      category: { in: ["BOOSTER_PACK", "BOOSTER_BOX", "ETB", "BUNDLE", "BLISTER", "COLLECTION_BOX", "TIN"] },
      language: "EN",
    },
    select: {
      id: true,
      title: true,
      category: true,
      set: { select: { name: true } },
    },
  });
  console.log(`${sealed.length} sealed-produkter (EN) att matcha`);

  let matched = 0;
  let priced = 0;
  let noPriceData = 0;
  const unmatched: string[] = [];
  const matchedIds: { productId: string; idProduct: number; cmName: string }[] = [];
  const now = Date.now();
  const DAY = 86_400_000;

  for (const product of sealed) {
    // Utan set-relation: härled set-namnet genom att strippa produkttypssuffix
    const setName =
      product.set?.name ??
      product.title
        .replace(/^Pok[eé]mon TCG:\s*/i, "")
        .replace(/\s*\(\d+\)\s*$/i, "")
        .replace(/\s+(booster (box|pack|bundle|display)|elite trainer box|booster)\s*$/i, "")
        .trim();
    const cm = findCm(setName, product.category, product.title);

    if (!cm) {
      unmatched.push(`${product.category} | ${product.title}`);
      continue;
    }
    matched++;

    matchedIds.push({ productId: product.id, idProduct: cm.idProduct, cmName: cm.name });

    const g = guideById.get(cm.idProduct);
    const currentEur = g?.trend ?? g?.avg1 ?? g?.avg7 ?? g?.avg30 ?? g?.avg ?? null;
    if (g == null || currentEur == null) {
      console.log(`  (matchad utan CM-pris: ${product.title} → ${cm.name})`);
      noPriceData++;
      continue;
    }
    priced++;
    if (DRY_RUN) continue;

    const price = eurToOre(currentEur);
    const baseRaw = {
      source: "cardmarket-priceguide",
      idProduct: cm.idProduct,
      cmName: cm.name,
      cmCategory: cm.categoryName,
      guideCreatedAt: guideRaw.createdAt,
      eurSek: EUR_SEK,
      eur: { trend: g.trend, avg: g.avg, avg1: g.avg1, avg7: g.avg7, avg30: g.avg30, low: g.low },
    };

    // Aktuell observation + riktiga CM-aggregat som historikpunkter
    const points: { price: number; observedAt: Date; aggregate: string }[] = [
      { price, observedAt: new Date(now), aggregate: "trend" },
    ];
    if (g.avg1 != null) points.push({ price: eurToOre(g.avg1), observedAt: new Date(now - 1 * DAY), aggregate: "avg1" });
    if (g.avg7 != null) points.push({ price: eurToOre(g.avg7), observedAt: new Date(now - 7 * DAY), aggregate: "avg7" });
    if (g.avg30 != null) points.push({ price: eurToOre(g.avg30), observedAt: new Date(now - 30 * DAY), aggregate: "avg30" });

    for (const pt of points) {
      await prisma.priceObservation.create({
        data: {
          productId: product.id,
          sourceId: cmSource.id,
          price: pt.price,
          currency: "SEK",
          condition: "SEALED",
          observedAt: pt.observedAt,
          rawData: { ...baseRaw, aggregate: pt.aggregate },
        },
      });
      const dateOnly = new Date(pt.observedAt.toISOString().slice(0, 10));
      await prisma.priceSnapshot.upsert({
        where: { productId_date: { productId: product.id, date: dateOnly } },
        create: {
          productId: product.id,
          date: dateOnly,
          minPrice: pt.price,
          maxPrice: pt.price,
          avgPrice: pt.price,
          volume: 0,
        },
        update: { avgPrice: pt.price, minPrice: pt.price, maxPrice: pt.price },
      });
    }

    // Uppdatera Cardmarket-offern med riktigt pris
    await prisma.offer.updateMany({
      where: { productId: product.id, retailerId: cmRetailer.id },
      data: { price, stockStatus: "IN_STOCK", condition: "SEALED", language: "EN", lastSeenAt: new Date() },
    });
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE_DIR, "matched-products.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), matched: matchedIds }, null, 2)
  );

  console.log(`\nMatchade: ${matched}/${sealed.length}`);
  console.log(`Prissatta: ${priced} (${noPriceData} matchade utan prisdata hos CM)`);
  console.log(`Omatchade (${unmatched.length}):`);
  for (const u of unmatched) console.log(`  - ${u}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
