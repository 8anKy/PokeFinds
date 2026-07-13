/**
 * REGRESSIONSVAKT för skrivordningen i runRestockScan (src/scrapers/runner.ts).
 *
 * Statusflippen (Offer.stockStatus) KONSUMERAR övergången — nästa körning diffar mot
 * den. Flippar vi FÖRE larmet och körningen dör däremellan (workflow-cancel, timeout,
 * evict) ser nästa körning ingen övergång alls → restocken förloras TYST för alltid.
 * Det är hela poängen med systemet, och det syns aldrig: inget felmejl, ingen röd
 * körning, bara ett larm som aldrig kom.
 *
 * Därför: larma FÖRST, flippa SIST. Ordningen ser redundant ut och är lätt att
 * "städa" tillbaka — de här testerna gör det omöjligt att göra det tyst.
 * Bakgrund: 2026-07-13, commit ad2ea4e.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceType, StockStatus } from "@prisma/client";

/** Anropsordning i den ordning runner.ts faktiskt rör DB:n/larmen. */
const calls: string[] = [];

const OFFER_URL = "https://butik.example/etb-box";
const offerRow = {
  id: "o1",
  url: OFFER_URL,
  productId: "p1",
  retailerId: "r1",
  stockStatus: StockStatus.OUT_OF_STOCK, // var slut...
  lastSeenAt: new Date("2026-07-13T12:00:00Z"),
  product: { category: "ETB" }, // sealed → larmar (ej HIDDEN_CATEGORIES)
};

// Feeden säger nu IN_STOCK → äkta restock-övergång (OUT_OF_STOCK → IN_STOCK).
const FEED_STATUS = { current: StockStatus.IN_STOCK as StockStatus };

const offerUpdate = vi.fn(async () => {
  calls.push("offer.update");
  return offerRow;
});
const restockEventCreate = vi.fn(async () => {
  calls.push("restockEvent.create");
  return {};
});
/** Kastar när `alertShouldDie` är true → simulerar en körning som dödas mitt i larmet. */
const alertShouldDie = { current: false };
const checkRestockAlertsMock = vi.fn(async () => {
  calls.push("checkRestockAlerts");
  if (alertShouldDie.current) throw new Error("workflow cancelled mitt i larmet");
  return { triggered: 1 };
});

vi.mock("@/lib/db", () => ({
  withDbRetry: (fn: () => Promise<unknown>) => fn(),
  prisma: {
    $queryRaw: async () => [],
    retailer: { upsert: async () => ({ id: "r1" }) },
    offer: {
      findMany: async () => [offerRow],
      update: (...a: unknown[]) => offerUpdate(...(a as [])),
      updateMany: async () => ({ count: 0 }),
    },
    storeListing: { findMany: async () => [] },
    restockEvent: { create: (...a: unknown[]) => restockEventCreate(...(a as [])) },
  },
}));

vi.mock("@/services/alerts", () => ({
  checkRestockAlerts: (...a: unknown[]) => checkRestockAlertsMock(...(a as [])),
  checkListingAlerts: vi.fn(),
  checkPriceAlerts: vi.fn(),
}));

vi.mock("@/services/notifications", () => ({
  dispatchPendingAlerts: async () => ({ sent: 0 }),
}));

vi.mock("@/scrapers/adapters/mock-adapter", () => ({
  MockAdapter: class {
    async fetchProducts() {
      return { products: [{ title: "Elite Trainer Box", url: OFFER_URL, imageUrl: null }] };
    }
    validateResult() {
      return true;
    }
    normalizeProduct() {
      return {
        url: OFFER_URL,
        stockStatus: FEED_STATUS.current,
        offerPrice: null,
        price: null,
        imageUrl: null,
        category: "ETB",
      };
    }
  },
}));

const SOURCES = [
  { name: "Testbutik", type: SourceType.MOCK, baseUrl: "https://butik.example", rotatingFeed: false },
];

const runScan = async () => {
  const { runRestockScan } = await import("@/scrapers/runner");
  return runRestockScan({ sources: SOURCES });
};

beforeEach(() => {
  calls.length = 0;
  alertShouldDie.current = false;
  FEED_STATUS.current = StockStatus.IN_STOCK;
  offerUpdate.mockClear();
  restockEventCreate.mockClear();
  checkRestockAlertsMock.mockClear();
});

describe("runRestockScan — skrivordning vid restock", () => {
  it("larmar FÖRE den flippar lagerstatusen (flippen konsumerar övergången)", async () => {
    const r = await runScan();

    expect(r.restocks).toBe(1);
    expect(checkRestockAlertsMock).toHaveBeenCalledOnce();
    expect(offerUpdate).toHaveBeenCalledOnce();

    // KÄRNAN: larmet måste ligga före statusflippen i anropsordningen.
    expect(calls.indexOf("checkRestockAlerts")).toBeLessThan(calls.indexOf("offer.update"));
    expect(calls).toEqual(["restockEvent.create", "checkRestockAlerts", "offer.update"]);
  });

  it("dör körningen i larmet flippas statusen ALDRIG → nästa körning ser övergången igen", async () => {
    alertShouldDie.current = true;

    await expect(runScan()).rejects.toThrow(/cancelled/);

    // Övergången får INTE vara konsumerad: hade vi flippat först vore offern nu
    // IN_STOCK i DB:n och nästa körning hade sett "ingen ändring" → larmet försvunnit.
    expect(offerUpdate).not.toHaveBeenCalled();
  });
});

describe("runRestockScan — oförändrad happy path", () => {
  it("ingen övergång (redan i lager) → varken event, larm eller statusflipp", async () => {
    offerRow.stockStatus = StockStatus.IN_STOCK;
    try {
      const r = await runScan();
      expect(r.restocks).toBe(0);
      expect(checkRestockAlertsMock).not.toHaveBeenCalled();
      expect(restockEventCreate).not.toHaveBeenCalled();
      expect(offerUpdate).not.toHaveBeenCalled(); // status oförändrad → ingen skrivning
    } finally {
      offerRow.stockStatus = StockStatus.OUT_OF_STOCK;
    }
  });
});
