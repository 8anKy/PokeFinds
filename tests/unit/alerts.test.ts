/**
 * Tester för checkPriceAlerts/checkRestockAlerts i src/services/alerts.ts.
 * Prisma mockas — vi verifierar att EMAIL-alerts skapas för rätt bevakningar och
 * att filtreringen (targetPrice >= nytt pris, ej pausad) skickas till DB korrekt.
 * (In-app-notiser borttagna → ingen Notification-skrivning längre.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindUnique = vi.fn();
const watchlistFindMany = vi.fn();
const userFindMany = vi.fn();
const alertCreate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => productFindUnique(...args) },
    watchlistItem: { findMany: (...args: unknown[]) => watchlistFindMany(...args) },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
    alert: { create: (...args: unknown[]) => alertCreate(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import { checkPriceAlerts, checkRestockAlerts } from "@/services/alerts";

const PRODUCT = { id: "prod-1", title: "Surging Sparks Booster Box", slug: "surging-sparks-booster-box" };

beforeEach(() => {
  productFindUnique.mockReset().mockResolvedValue(PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([]);
  userFindMany.mockReset().mockResolvedValue([]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  transaction.mockReset().mockResolvedValue([]);
});

describe("checkPriceAlerts", () => {
  it("skapar EMAIL-alert när målpris nås", async () => {
    watchlistFindMany.mockResolvedValue([
      { userId: "user-1", targetPrice: 150000 },
      { userId: "user-2", targetPrice: 160000 },
    ]);

    const result = await checkPriceAlerts("prod-1", 149900);

    expect(result.triggered).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(alertCreate).toHaveBeenCalledTimes(2);

    const alertArgs = alertCreate.mock.calls[0][0] as {
      data: { userId: string; productId: string; type: string; message: string; channel: string };
    };
    expect(alertArgs.data.type).toBe("PRICE_TARGET");
    expect(alertArgs.data.channel).toBe("EMAIL");
    expect(alertArgs.data.userId).toBe("user-1");
    expect(alertArgs.data.productId).toBe("prod-1");
    expect(alertArgs.data.message).toContain(PRODUCT.title);
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
  });

  it("returnerar 0 om produkten inte finns", async () => {
    productFindUnique.mockResolvedValue(null);

    const result = await checkPriceAlerts("saknas", 10000);

    expect(result.triggered).toBe(0);
    expect(watchlistFindMany).not.toHaveBeenCalled();
  });
});

describe("checkRestockAlerts", () => {
  it("skapar RESTOCK EMAIL-alert med butikens retailerId för aktiva bevakningar", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    const result = await checkRestockAlerts("prod-1", "ret-1");

    expect(result.triggered).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);

    const alertArgs = alertCreate.mock.calls[0][0] as {
      data: { type: string; message: string; channel: string; retailerId?: string };
    };
    expect(alertArgs.data.type).toBe("RESTOCK");
    expect(alertArgs.data.channel).toBe("EMAIL");
    expect(alertArgs.data.message).toContain("i lager");
    // retailerId trådas in → mejlet kan länka direkt till butiken som fick lager.
    expect(alertArgs.data.retailerId).toBe("ret-1");
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

  it("utlöser inget utan bevakare och utan alla-restocks-prenumeranter", async () => {
    const result = await checkRestockAlerts("prod-1");
    expect(result.triggered).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("larmar 'alla restocks'-prenumeranter utan att de bevakar produkten", async () => {
    watchlistFindMany.mockResolvedValue([]); // ingen bevakar produkten
    userFindMany.mockResolvedValue([{ id: "sub-1" }]);

    const result = await checkRestockAlerts("prod-1");

    expect(result.triggered).toBe(1);
    expect((alertCreate.mock.calls[0][0] as { data: { userId: string } }).data.userId).toBe("sub-1");
  });

  it("dedupar: bevakare som OCKSÅ prenumererar på alla restocks får ett larm", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    userFindMany.mockResolvedValue([{ id: "user-1" }, { id: "sub-2" }]);

    const result = await checkRestockAlerts("prod-1");

    expect(result.triggered).toBe(2); // user-1 (en gång) + sub-2
    expect(alertCreate).toHaveBeenCalledTimes(2);
  });

  it("returnerar 0 om produkten inte finns", async () => {
    productFindUnique.mockResolvedValue(null);
    const result = await checkRestockAlerts("saknas");
    expect(result.triggered).toBe(0);
  });
});
