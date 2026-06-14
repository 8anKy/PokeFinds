/**
 * Backfillar RIKTIG historisk Cardmarket-prisdata för sealed-produkter från
 * Internet Archives sparade kopia av CM:s officiella prisguide.
 *
 * Enda kända arkivutgåvan: 2024-12-30 (web.archive.org CDX, verifierad
 * 2026-06-12). Punkterna dateras till GUIDENS createdAt — inte importtid.
 * Offers berörs INTE (2024-priser får inte skriva över dagens).
 *
 * Idempotent per guideCreatedAt (samma mekanism som huvudimporten).
 * Kör: npx tsx --env-file=.env scripts/backfill-cm-priceguide-archive.ts
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();

// Live SEK/EUR — sätts i main() via getRatesOre (EUR_SEK-env pinnar fortfarande).
let EUR_SEK = 0;
const WAYBACK_TS = "20241230185748";
const ARCHIVE_URL = `https://web.archive.org/web/${WAYBACK_TS}id_/https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json`;
const CACHE_DIR = path.join(__dirname, "..", ".cache", "cardmarket");
const CACHE_FILE = path.join(CACHE_DIR, `price_guide_6_archive_${WAYBACK_TS}.json`);

interface CmPriceGuideEntry {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

async function main() {
  EUR_SEK = (await getRatesOre()).eurToOre / 100;
  console.log(`Växelkurs: 1 EUR = ${EUR_SEK.toFixed(4)} SEK`);

  let text: string;
  if (fs.existsSync(CACHE_FILE)) {
    text = fs.readFileSync(CACHE_FILE, "utf8");
  } else {
    console.log(`Hämtar arkiverad prisguide från web.archive.org (${WAYBACK_TS})...`);
    const res = await fetch(ARCHIVE_URL);
    if (!res.ok) throw new Error(`web.archive.org → HTTP ${res.status}`);
    text = await res.text();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, text);
  }
  const guide = JSON.parse(text) as { createdAt: string; priceGuides: CmPriceGuideEntry[] };
  const observedAt = new Date(guide.createdAt);
  if (Number.isNaN(observedAt.getTime())) throw new Error(`Ogiltigt createdAt: ${guide.createdAt}`);
  console.log(`Arkivguide skapad ${guide.createdAt} — ${guide.priceGuides.length} poster`);

  const { matched } = JSON.parse(
    fs.readFileSync(path.join(CACHE_DIR, "matched-products.json"), "utf8")
  ) as { matched: { productId: string; idProduct: number; cmName: string }[] };

  const guideById = new Map<number, CmPriceGuideEntry>();
  for (const e of guide.priceGuides) guideById.set(e.idProduct, e);

  const cmSource = await prisma.scrapeSource.findFirstOrThrow({ where: { name: "Cardmarket" } });

  // Idempotens: ersätt ev. tidigare import av samma arkivutgåva
  const removed = await prisma.$executeRaw`
    DELETE FROM "PriceObservation"
    WHERE "sourceId" = ${cmSource.id}
      AND "rawData"->>'guideCreatedAt' = ${guide.createdAt}`;
  if (removed > 0) console.log(`Ersätter ${removed} tidigare punkter från samma arkivutgåva`);

  const dateOnly = new Date(guide.createdAt.slice(0, 10));
  let created = 0;
  let missing = 0;

  for (const m of matched) {
    const g = guideById.get(m.idProduct);
    const eur = g ? (g.trend ?? g.avg1 ?? g.avg7 ?? g.avg30 ?? g.avg) : null;
    if (g == null || eur == null) {
      missing++; // produkten fanns inte (eller saknade pris) i dec 2024
      continue;
    }
    const price = Math.round(eur * EUR_SEK * 100);
    await prisma.priceObservation.create({
      data: {
        productId: m.productId,
        sourceId: cmSource.id,
        price,
        currency: "SEK",
        condition: "SEALED",
        observedAt,
        rawData: {
          source: "cardmarket-priceguide-archive",
          waybackTimestamp: WAYBACK_TS,
          idProduct: m.idProduct,
          cmName: m.cmName,
          guideCreatedAt: guide.createdAt,
          eurSek: EUR_SEK,
          aggregate: "trend",
          eur: { trend: g.trend, avg: g.avg, avg1: g.avg1, avg7: g.avg7, avg30: g.avg30, low: g.low },
        },
      },
    });
    await prisma.priceSnapshot.upsert({
      where: { productId_date: { productId: m.productId, date: dateOnly } },
      create: { productId: m.productId, date: dateOnly, minPrice: price, maxPrice: price, avgPrice: price, volume: 0 },
      update: { minPrice: price, maxPrice: price, avgPrice: price },
    });
    created++;
  }

  console.log(`✅ ${created} historikpunkter (${guide.createdAt.slice(0, 10)}) skapade; ${missing} matchade produkter fanns ej/saknade pris i arkivet.`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
