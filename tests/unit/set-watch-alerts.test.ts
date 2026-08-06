/**
 * Set-bevakningen som MOTTAGARKÄLLA i larmvägen.
 *
 * Reglerna som testas är precis de som gör funktionen ärlig:
 *   1. Bara SEALED — singlar/tillbehör restockar aldrig i butiksfeeden.
 *   2. Bara produkter som HAR ett set (färska auto-importer saknar setId tills
 *      nattens sealed-import etiketterar dem).
 *   3. Pro-grinden gäller även HÄR, inte bara vid skapandet: en användare kan ha
 *      fallit till FREE sedan raden skrevs (RevenueCat EXPIRATION).
 *   4. Skälsraden (`reasonSetName`) sätts för den som fått larmet VIA setet, och
 *      lämnas tom för den som bevakar produkten själv — då är skälet uppenbart.
 *   5. Feed-först-vägen (`checkListingAlerts`) måste också fråga, annars missar
 *      set-bevakningen exakt de NYA lådorna den finns till för.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindUnique = vi.fn();
const watchlistFindMany = vi.fn();
const userFindMany = vi.fn();
const setWatchFindMany = vi.fn();
const alertCreate = vi.fn();
const alertFindFirst = vi.fn();
const restockEventFindMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...a: unknown[]) => productFindUnique(...a) },
    watchlistItem: { findMany: (...a: unknown[]) => watchlistFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    setWatch: { findMany: (...a: unknown[]) => setWatchFindMany(...a) },
    alert: {
      create: (...a: unknown[]) => alertCreate(...a),
      findFirst: (...a: unknown[]) => alertFindFirst(...a),
    },
    restockEvent: { findMany: (...a: unknown[]) => restockEventFindMany(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

import { checkRestockAlerts, checkListingAlerts } from "@/services/alerts";

const SEALED_PRODUCT = {
  id: "prod-1",
  title: "Prismatic Evolutions ETB",
  slug: "prismatic-evolutions-etb",
  setId: "set-1",
  category: "ETB",
  set: { name: "Prismatic Evolutions" },
};

/**
 * Mottagare + skäl ur alert.create-anropen. Projicerar med FLIT ner till de två
 * fälten testet handlar om — en `toEqual` mot hela `data` hade gått sönder varje
 * gång någon la till ett orelaterat fält på Alert.
 */
function createdAlerts(): { userId: string; reasonSetName: string | null }[] {
  return alertCreate.mock.calls.map((c) => {
    const d = (c[0] as { data: { userId: string; reasonSetName?: string | null } }).data;
    return { userId: d.userId, reasonSetName: d.reasonSetName ?? null };
  });
}

beforeEach(() => {
  productFindUnique.mockReset().mockResolvedValue(SEALED_PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([]);
  userFindMany.mockReset().mockResolvedValue([]);
  setWatchFindMany.mockReset().mockResolvedValue([]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  alertFindFirst.mockReset().mockResolvedValue(null);
  restockEventFindMany.mockReset().mockResolvedValue([]);
  transaction.mockReset().mockResolvedValue([]);
});

describe("checkRestockAlerts — set-bevakare", () => {
  it("larmar den som bevakar setet, utan egen produktbevakning", async () => {
    setWatchFindMany.mockResolvedValue([{ userId: "set-user" }]);

    const result = await checkRestockAlerts("prod-1", "retailer-1");

    expect(result.triggered).toBe(1);
    expect(createdAlerts()).toEqual([
      { userId: "set-user", reasonSetName: "Prismatic Evolutions" },
    ]);
  });

  it("frågar med setets id och Pro-grinden", async () => {
    await checkRestockAlerts("prod-1", "retailer-1");

    const where = (setWatchFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.setId).toBe("set-1");
    // Pro-grinden får inte utelämnas här bara för att addSetWatch redan grindar:
    // planen kan ha gått ut sedan raden skrevs.
    expect(where.user).toBeTruthy();
  });

  it("dedupar — den som både bevakar produkten och setet får ETT larm", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "both" }]);
    setWatchFindMany.mockResolvedValue([{ userId: "both" }]);

    const result = await checkRestockAlerts("prod-1", "retailer-1");

    expect(result.triggered).toBe(1);
    // Ingen skälsrad: bevakar man produkten själv är "du bevakar setet" inte
    // förklaringen till mejlet.
    expect(createdAlerts()).toEqual([{ userId: "both", reasonSetName: null }]);
  });

  it("ger skälsraden BARA till set-bevakaren när båda sorterna finns", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "direct" }]);
    setWatchFindMany.mockResolvedValue([{ userId: "via-set" }]);

    await checkRestockAlerts("prod-1", "retailer-1");

    const byUser = new Map(createdAlerts().map((a) => [a.userId, a.reasonSetName]));
    expect(byUser.get("direct")).toBeNull();
    expect(byUser.get("via-set")).toBe("Prismatic Evolutions");
  });

  it("frågar INTE alls för en singel — den restockar aldrig i butiksfeeden", async () => {
    productFindUnique.mockResolvedValue({
      ...SEALED_PRODUCT,
      category: "SINGLE_CARD",
    });
    watchlistFindMany.mockResolvedValue([{ userId: "u1" }]);

    await checkRestockAlerts("prod-1", "retailer-1");

    expect(setWatchFindMany).not.toHaveBeenCalled();
  });

  it("frågar INTE alls för tillbehör", async () => {
    productFindUnique.mockResolvedValue({ ...SEALED_PRODUCT, category: "ACCESSORY" });
    watchlistFindMany.mockResolvedValue([{ userId: "u1" }]);

    await checkRestockAlerts("prod-1", "retailer-1");

    expect(setWatchFindMany).not.toHaveBeenCalled();
  });

  it("frågar INTE när produkten saknar set (färsk auto-import utan etikett)", async () => {
    productFindUnique.mockResolvedValue({ ...SEALED_PRODUCT, setId: null, set: null });
    watchlistFindMany.mockResolvedValue([{ userId: "u1" }]);

    await checkRestockAlerts("prod-1", "retailer-1");

    expect(setWatchFindMany).not.toHaveBeenCalled();
  });
});

describe("checkListingAlerts — set-bevakare på feed-först-vägen", () => {
  const LISTING = {
    id: "listing-1",
    title: "Prismatic Evolutions Booster Bundle",
    retailerId: "retailer-1",
    productId: "prod-1",
  };

  it("larmar set-bevakaren för en HELT NY sealed-SKU", async () => {
    setWatchFindMany.mockResolvedValue([{ userId: "set-user" }]);

    const result = await checkListingAlerts(LISTING, "NEW_LISTING");

    expect(result.triggered).toBe(1);
    expect(createdAlerts()).toEqual([
      { userId: "set-user", reasonSetName: "Prismatic Evolutions" },
    ]);
  });

  it("frågar inte när annonsen saknar katalogprodukt", async () => {
    await checkListingAlerts({ ...LISTING, productId: null }, "NEW_LISTING");

    expect(setWatchFindMany).not.toHaveBeenCalled();
  });

  it("frågar inte för en singel", async () => {
    productFindUnique.mockResolvedValue({
      setId: "set-1",
      category: "SINGLE_CARD",
      set: { name: "Prismatic Evolutions" },
    });

    await checkListingAlerts(LISTING, "NEW_LISTING");

    expect(setWatchFindMany).not.toHaveBeenCalled();
  });
});
