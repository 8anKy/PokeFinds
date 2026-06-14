/**
 * MockAdapter — simulerad datakälla för utveckling och demo.
 * Läser befintliga produkter ur databasen och genererar prisdrift (±3 %)
 * samt slumpmässiga lagerstatus-byten (~10 % chans).
 *
 * Ingen extern trafik sker — alla etikregler är därmed trivialt uppfyllda,
 * men adaptern följer samma kontrakt (SourceAdapter) som riktiga adaptrar.
 */
import { StockStatus, SourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitle } from "@/lib/utils";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "@/scrapers/types";

const STOCK_FLIP: Record<StockStatus, StockStatus> = {
  IN_STOCK: StockStatus.OUT_OF_STOCK,
  OUT_OF_STOCK: StockStatus.IN_STOCK,
  PREORDER: StockStatus.IN_STOCK,
  LIMITED: StockStatus.OUT_OF_STOCK,
  UNKNOWN: StockStatus.IN_STOCK,
};

interface MockRaw {
  id: string;
  title: string;
  priceOre: number;
  currency: string;
  stock: string;
  simulated: true;
}

function isMockRaw(raw: unknown): raw is MockRaw {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "priceOre" in raw &&
    "stock" in raw
  );
}

export class MockAdapter implements SourceAdapter {
  name = "Mock-källa";
  type: SourceType = SourceType.MOCK;
  baseUrl = "https://mock.pokefinds.local";
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const errors: string[] = [];
    const products: RawProductData[] = [];

    const dbProducts = await prisma.product.findMany({
      take: 100,
      include: {
        offers: { take: 1, orderBy: { updatedAt: "desc" } },
      },
    });

    for (const p of dbProducts) {
      const existing = p.offers[0];
      const basePrice = existing?.price ?? 50_000 + Math.floor(Math.random() * 200_000);
      // Prisdrift ±3 %
      const drift = 1 + (Math.random() * 0.06 - 0.03);
      const newPrice = Math.max(100, Math.round(basePrice * drift));

      // ~10 % chans att lagerstatus flippar
      const currentStock = existing?.stockStatus ?? StockStatus.IN_STOCK;
      const newStock = Math.random() < 0.1 ? STOCK_FLIP[currentStock] : currentStock;

      const raw: MockRaw = {
        id: `mock-${p.id}`,
        title: p.title,
        priceOre: newPrice,
        currency: "SEK",
        stock: newStock,
        simulated: true,
      };

      products.push({
        externalId: `mock-${p.id}`,
        title: p.title,
        url: `${this.baseUrl}/produkt/${p.slug}`,
        price: newPrice,
        currency: "SEK",
        stockStatus: newStock,
        imageUrl: p.imageUrl ?? undefined,
        category: p.category,
        raw,
      });
    }

    if (products.length === 0) {
      errors.push("Inga produkter i databasen att simulera — kör seed först.");
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
      imageUrl: raw.imageUrl,
      category: raw.category,
    };
  }

  detectStockStatus(raw: unknown): StockStatus {
    if (isMockRaw(raw) && raw.stock in StockStatus) {
      return raw.stock as StockStatus;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isMockRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: Math.round(raw.priceOre), currency: raw.currency || "SEK" };
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
