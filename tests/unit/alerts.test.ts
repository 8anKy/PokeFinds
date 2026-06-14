/**
 * Tester för checkPriceAlerts/checkRestockAlerts i src/services/alerts.ts.
 * Prisma mockas — vi verifierar att Alert + Notification skapas för rätt
 * bevakningar och att filtreringen (targetPrice >= nytt pris, ej pausad) skickas
 * till databasen korrekt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindUnique = vi.fn();
const watchlistFindMany = vi.fn();
const alertCreate = vi.fn();
const notificationCreate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => productFindUnique(...args) },
    watchlistItem: { findMany: (...args: unknown[]) => watchlistFindMany(...args) },
    alert: { create: (...args: unknown[]) => alertCreate(...args) },
    notification: { create: (...args: unknown[]) => notificationCreate(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import { checkPriceAlerts, checkRestockAlerts } from "@/services/alerts";

const PRODUCT = { id: "prod-1", title: "Surging Sparks Booster Box", slug: "surging-sparks-booster-box" };

beforeEach(() => {
  productFindUnique.mockReset().mockResolvedValue(PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  notificationCreate.mockReset().mockImplementation((args: unknown) => args);
  transaction.mockReset().mockResolvedValue([]);
});

describe("checkPriceAlerts", () => {
  it("skapar Alert + Notification när målpris nås", async () => {
    watchlistFindMany.mockResolvedValue([
      { userId: "user-1", targetPrice: 150000 },
      { userId: "user-2", targetPrice: 160000 },
    ]);

    const result = await checkPriceAlerts("prod-1", 149900);

    expect(result.triggered).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(alertCreate).toHaveBeenCalledTimes(2);
    expect(notificationCreate).toHaveBeenCalledTimes(2);

    const alertArgs = alertCreate.mock.calls[0][0] as {
      data: { userId: string; productId: string; type: string; message: string };
    };
    expect(alertArgs.data.type).toBe("PRICE_TARGET");
    expect(alertArgs.data.userId).toBe("user-1");
    expect(alertArgs.data.productId).toBe("prod-1");
    expect(alertArgs.data.message).toContain(PRODUCT.title);

    const notifArgs = notificationCreate.mock.calls[0][0] as {
      data: { linkUrl: string; title: string };
    };
    expect(notifArgs.data.linkUrl).toBe(`/produkter/${PRODUCT.slug}`);
  });

  it("filtrerar bevakningar i databasen: targetPrice >= nytt pris, aktivt prislarm, ej pausad", async () => {
    await checkPriceAlerts("prod-1", 99900);

    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod-1",
          priceAlert: true,
          isPaused: false,
          targetPrice: { not: null, gte: 99900 },
        }),
      })
    );
  });

  it("utlöser inget när priset ligger över alla målpriser (inga träffar)", async () => {
    watchlistFindMany.mockResolvedValue([]); // DB-filtret gav inga träffar

    const result = await checkPriceAlerts("prod-1", 999900);

    expect(result.triggered).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("returnerar 0 om produkten inte finns", async () => {
    productFindUnique.mockResolvedValue(null);

    const result = await checkPriceAlerts("saknas", 10000);

    expect(result.triggered).toBe(0);
    expect(watchlistFindMany).not.toHaveBeenCalled();
  });
});

describe("checkRestockAlerts", () => {
  it("skapar RESTOCK-alert + notifikation för aktiva bevakningar", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    const result = await checkRestockAlerts("prod-1");

    expect(result.triggered).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);

    const alertArgs = alertCreate.mock.calls[0][0] as {
      data: { type: string; message: string };
    };
    expect(alertArgs.data.type).toBe("RESTOCK");
    expect(alertArgs.data.message).toContain("i lager");

    const notifArgs = notificationCreate.mock.calls[0][0] as {
      data: { title: string; linkUrl: string };
    };
    expect(notifArgs.data.title).toBe("Åter i lager");
    expect(notifArgs.data.linkUrl).toBe(`/produkter/${PRODUCT.slug}`);
  });

  it("filtrerar på restockAlert och ej pausad", async () => {
    await checkRestockAlerts("prod-1");

    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod-1",
          restockAlert: true,
          isPaused: false,
        }),
      })
    );
  });

  it("utlöser inget utan bevakare", async () => {
    const result = await checkRestockAlerts("prod-1");
    expect(result.triggered).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returnerar 0 om produkten inte finns", async () => {
    productFindUnique.mockResolvedValue(null);
    const result = await checkRestockAlerts("saknas");
    expect(result.triggered).toBe(0);
  });
});
