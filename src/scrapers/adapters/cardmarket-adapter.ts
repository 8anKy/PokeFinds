/**
 * CardmarketPriceGuideAdapter — dagliga sealed-priser från Cardmarkets
 * OFFICIELLA publika prisguide (ingen scraping av cardmarket.com):
 *
 *   https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json
 *
 * Förutsätter att `scripts/import-cardmarket-priceguide.ts` körts minst en
 * gång — den bygger `.cache/cardmarket/matched-products.json` (vår productId →
 * CM idProduct + officiellt CM-namn). Adaptern emittar produkter med VÅR
 * katalogtitel, vilket ger exakt träff i matchProduct (konfidens 1) — ingen
 * fuzzy-risk.
 *
 * Idempotens per prisguide-utgåva: guiden uppdateras en gång per dygn, men
 * runnern kör var 8:e timme. Är senaste observationens guideCreatedAt samma
 * som den hämtade guidens hoppar vi över (annars tre identiska punkter/dag).
 */
import { StockStatus, SourceType } from "@prisma/client";
import { prisma } from "../../lib/db";
import { normalizeTitle } from "../../lib/utils";
import { cardmarketProductUrl } from "../../lib/marketplace-urls";
import { getRatesOre } from "../../lib/exchange-rate";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";

const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const MATCHED_FILE = ".cache/cardmarket/matched-products.json";

interface CmPriceGuideEntry {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

interface CmGuideRaw {
  source: "cardmarket-priceguide";
  idProduct: number;
  cmName: string;
  guideCreatedAt: string;
  eurSek: number;
  eur: Pick<CmPriceGuideEntry, "trend" | "avg" | "avg1" | "avg7" | "avg30" | "low">;
  priceOre: number;
}

function isCmGuideRaw(raw: unknown): raw is CmGuideRaw {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as CmGuideRaw).source === "cardmarket-priceguide" &&
    "priceOre" in raw
  );
}

export class CardmarketPriceGuideAdapter implements SourceAdapter {
  name = "Cardmarket";
  type: SourceType = SourceType.API;
  baseUrl = "https://downloads.s3.cardmarket.com";
  supportsSearch = false;
  supportsStock = false;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];

    // fs/path importeras lazy med webpackIgnore: adaptern når Edge-bundlen via
    // instrumentation → scheduler → runner, och Edge saknar Node-builtins.
    // Koden körs aldrig på Edge (runtime-vakt i instrumentation.ts).
    const fs = await import(/* webpackIgnore: true */ "node:fs");
    const path = await import(/* webpackIgnore: true */ "node:path");

    const matchedPath = path.join(process.cwd(), MATCHED_FILE);
    if (!fs.existsSync(matchedPath)) {
      return {
        products,
        errors: [
          `${MATCHED_FILE} saknas — kör "npx tsx scripts/import-cardmarket-priceguide.ts" först.`,
        ],
      };
    }
    const { matched } = JSON.parse(fs.readFileSync(matchedPath, "utf8")) as {
      matched: { productId: string; idProduct: number; cmName: string }[];
    };

    const res = await fetch(PRICE_GUIDE_URL);
    if (!res.ok) {
      return { products, errors: [`Cardmarket prisguide: HTTP ${res.status}`] };
    }
    const guide = (await res.json()) as {
      createdAt: string;
      priceGuides: CmPriceGuideEntry[];
    };

    // Samma utgåva som senast importerade? → inget nytt att hämta.
    const latest = await prisma.priceObservation.findFirst({
      where: { source: { name: "Cardmarket" } },
      orderBy: { observedAt: "desc" },
      select: { rawData: true },
    });
    const latestGuide =
      latest?.rawData && typeof latest.rawData === "object"
        ? (latest.rawData as { guideCreatedAt?: string }).guideCreatedAt
        : undefined;
    if (latestGuide === guide.createdAt) {
      return { products, errors: [] };
    }

    // Live EUR→SEK-kurs (öre); eurSek = SEK/EUR sparas i rawData för spårbarhet.
    const { eurToOre } = await getRatesOre();
    const eurSek = eurToOre / 100;
    const guideById = new Map<number, CmPriceGuideEntry>();
    for (const e of guide.priceGuides) guideById.set(e.idProduct, e);

    const catalog = await prisma.product.findMany({
      where: { id: { in: matched.map((m) => m.productId) } },
      select: { id: true, title: true, category: true },
    });
    const byId = new Map(catalog.map((p) => [p.id, p]));

    for (const m of matched) {
      const product = byId.get(m.productId);
      const g = guideById.get(m.idProduct);
      const eur = g ? (g.trend ?? g.avg1 ?? g.avg7 ?? g.avg30 ?? g.avg) : null;
      if (!product || g == null || eur == null) continue;

      const priceOre = Math.round(eur * eurSek * 100);
      const raw: CmGuideRaw = {
        source: "cardmarket-priceguide",
        idProduct: m.idProduct,
        cmName: m.cmName,
        guideCreatedAt: guide.createdAt,
        eurSek,
        eur: { trend: g.trend, avg: g.avg, avg1: g.avg1, avg7: g.avg7, avg30: g.avg30, low: g.low },
        priceOre,
      };
      products.push({
        externalId: `cm-${m.idProduct}`,
        // Vår egen katalogtitel → exakt träff i matchProduct (ingen fuzzy-risk)
        title: product.title,
        // Exakt produktsida via idProduct, förfiltrerad till engelska
        url: cardmarketProductUrl(m.idProduct),
        price: priceOre,
        currency: "SEK",
        stockStatus: StockStatus.IN_STOCK,
        category: product.category,
        raw,
      });
    }

    return { products, errors };
  }

  normalizeProduct(raw: RawProductData): NormalizedProduct {
    return {
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      category: raw.category,
    };
  }

  detectStockStatus(raw: unknown): StockStatus {
    return isCmGuideRaw(raw) ? StockStatus.IN_STOCK : StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isCmGuideRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}
