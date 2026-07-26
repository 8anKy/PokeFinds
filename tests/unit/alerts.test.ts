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
const alertFindFirst = vi.fn();
const restockEventFindMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => productFindUnique(...args) },
    watchlistItem: { findMany: (...args: unknown[]) => watchlistFindMany(...args) },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
    alert: {
      create: (...args: unknown[]) => alertCreate(...args),
      findFirst: (...args: unknown[]) => alertFindFirst(...args),
    },
    restockEvent: { findMany: (...args: unknown[]) => restockEventFindMany(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import {
  checkPriceAlerts,
  checkRestockAlerts,
  checkListingAlerts,
  evaluateStockFlap,
  flapPolicy,
} from "@/services/alerts";

// Pro-mottagare = planTier PREMIUM ELLER admin-roll ELLER aktiv referral-bonus
// (lib/plan.proUserWhere). Assertar mot samma struktur som koden bygger — ett bart
// planTier-filter missar admins (2026-07-08). proUserWhere() bakar in new Date() i
// bonus-grenen (#10) → koden och testet anropar den millisekunder isär, så en EXAKT
// Date-jämförelse flakar. Matcha strukturen med expect.any(Date) för bonus-t.o.m.
const proWhereOr: unknown[] = [
  { planTier: "PREMIUM" },
  { role: { in: ["ADMIN", "SUPERADMIN"] } },
  { bonusProUntil: { gt: expect.any(Date) } },
];
const proUserWhereMatch = { OR: proWhereOr };

const PRODUCT = { id: "prod-1", title: "Surging Sparks Booster Box", slug: "surging-sparks-booster-box" };

beforeEach(() => {
  productFindUnique.mockReset().mockResolvedValue(PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([]);
  userFindMany.mockReset().mockResolvedValue([]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  alertFindFirst.mockReset().mockResolvedValue(null); // inget nyligt restock-larm → cooldown öppen
  restockEventFindMany.mockReset().mockResolvedValue([]); // ingen flapp-historik
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

  it("filtrerar bevakningar i databasen: targetPrice >= nytt pris, aktivt prislarm, ej pausad, endast Pro", async () => {
    await checkPriceAlerts("prod-1", 99900);

    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod-1",
          priceAlert: true,
          isPaused: false,
          targetPrice: { not: null, gte: 99900 },
          user: proUserWhereMatch,
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

  it("tystar upprepad restock för samma produkt+butik inom cooldown-fönstret", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    alertFindFirst.mockResolvedValue({ id: "nyligt-larm" }); // redan larmat nyss

    const result = await checkRestockAlerts("prod-1", "ret-1");

    expect(result.triggered).toBe(0);
    expect(alertCreate).not.toHaveBeenCalled();
    // cooldown scopas per produkt+butik+typ
    expect(alertFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "RESTOCK", productId: "prod-1", retailerId: "ret-1" }),
      })
    );
  });

  // Tre olika besked delar AlertType RESTOCK. Övergången lagras på larmet så att
  // utskicket (som kör EFTER skanningen) kan välja rätt mall och rätt push-titel.
  it("släpp (PREORDER → IN_STOCK): egen copy och lagrad övergång", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    await checkRestockAlerts("prod-1", "ret-1", { from: "PREORDER", to: "IN_STOCK" });

    const data = (alertCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.message).toBe("Surging Sparks Booster Box har släppts och finns nu i lager!");
    expect(data.message).not.toContain("igen");
    expect(data.fromStatus).toBe("PREORDER");
    expect(data.toStatus).toBe("IN_STOCK");
  });

  it("öppnad förhandsbokning (OUT → PREORDER): egen copy, inte 'i lager'", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    await checkRestockAlerts("prod-1", "ret-1", { from: "OUT_OF_STOCK", to: "PREORDER" });

    const data = (alertCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.message).toBe("Surging Sparks Booster Box går nu att förhandsboka!");
    expect(data.toStatus).toBe("PREORDER");
  });

  it("utan angiven övergång = klassisk påfyllning (bakåtkompatibelt)", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    await checkRestockAlerts("prod-1", "ret-1");

    const data = (alertCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.message).toBe("Surging Sparks Booster Box finns i lager igen!");
    expect(data.fromStatus).toBeNull();
    expect(data.toStatus).toBeNull();
  });

  it("cooldownen scopas på slutstatus — släppet äts inte av förhandsbokningslarmet", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    await checkRestockAlerts("prod-1", "ret-1", { from: "PREORDER", to: "IN_STOCK" });

    expect(alertFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ toStatus: "IN_STOCK" }),
      })
    );
  });

  it("filtrerar på restockAlert, ej pausad, och endast Pro-bevakare", async () => {
    await checkRestockAlerts("prod-1");

    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod-1",
          restockAlert: true,
          isPaused: false,
          user: proUserWhereMatch,
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

/**
 * Flapp-dämpning (2026-07-26): Dragon's Lair togglade Pitch Black ETB/Booster Box
 * 28 resp. 45 gånger på tre dygn. Ren dom först, sedan integrationen i
 * checkRestockAlerts.
 */
describe("evaluateStockFlap", () => {
  const NOW = new Date("2026-07-26T16:00:00Z");
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
  const P = { minAwayMinutes: 60, flapMaxTransitions: 6, flapCooldownHours: 24 };

  it("blink: tillbaka i lager 10 min efter att den tog slut = ingen påfyllning", () => {
    const recent = [
      { oldStatus: "OUT_OF_STOCK" as const, detectedAt: ago(0) }, // övergången som larmar
      { oldStatus: "IN_STOCK" as const, detectedAt: ago(10) }, // lämnade IN_STOCK nyss
    ];
    expect(evaluateStockFlap(recent, "IN_STOCK", NOW, P).blip).toBe(true);
  });

  it("äkta påfyllning: borta i två timmar = larm", () => {
    const recent = [
      { oldStatus: "OUT_OF_STOCK" as const, detectedAt: ago(0) },
      { oldStatus: "IN_STOCK" as const, detectedAt: ago(120) },
    ];
    expect(evaluateStockFlap(recent, "IN_STOCK", NOW, P).blip).toBe(false);
  });

  it("första gången produkten ses hos butiken (ingen historik) = larm", () => {
    expect(evaluateStockFlap([], "IN_STOCK", NOW, P)).toEqual({ blip: false, cooldownHours: 0 });
  });

  it("förhandsbokning bedöms mot NÄR förhandsbokningen stängde, inte mot lagret", () => {
    const recent = [
      { oldStatus: "OUT_OF_STOCK" as const, detectedAt: ago(0) },
      { oldStatus: "IN_STOCK" as const, detectedAt: ago(5) }, // annan status → irrelevant
      { oldStatus: "PREORDER" as const, detectedAt: ago(300) },
    ];
    expect(evaluateStockFlap(recent, "PREORDER", NOW, P).blip).toBe(false);
  });

  it("droppande butik (fler övergångar än taket senaste dygnet) → dygnscooldown", () => {
    const recent = Array.from({ length: 9 }, (_, i) => ({
      oldStatus: (i % 2 === 0 ? "OUT_OF_STOCK" : "IN_STOCK") as "OUT_OF_STOCK" | "IN_STOCK",
      detectedAt: ago(i * 90), // var 90:e min → inga blinkar, bara ihärdig flapp
    }));
    expect(evaluateStockFlap(recent, "IN_STOCK", NOW, P).cooldownHours).toBe(24);
  });

  it("räknar bara dygnets övergångar — gammal historik förlänger ingen cooldown", () => {
    const recent = Array.from({ length: 9 }, (_, i) => ({
      oldStatus: "IN_STOCK" as const,
      detectedAt: ago(60 * 25 + i), // äldre än 24h
    }));
    expect(evaluateStockFlap(recent, "IN_STOCK", NOW, P).cooldownHours).toBe(0);
  });

  it("okänd slutstatus (äldre anrop utan övergång) kan aldrig vara en blink", () => {
    const recent = [{ oldStatus: "IN_STOCK" as const, detectedAt: ago(1) }];
    expect(evaluateStockFlap(recent, null, NOW, P).blip).toBe(false);
  });

  it("standardpolicyn är 60 min / 6 övergångar / 24h", () => {
    expect(flapPolicy()).toEqual({
      minAwayMinutes: 60,
      flapMaxTransitions: 6,
      flapCooldownHours: 24,
    });
  });
});

describe("checkRestockAlerts — flapp-dämpning", () => {
  it("tystar blinken: produkten var slut i 10 minuter", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    restockEventFindMany.mockResolvedValue([
      { oldStatus: "OUT_OF_STOCK", detectedAt: new Date() },
      { oldStatus: "IN_STOCK", detectedAt: new Date(Date.now() - 10 * 60_000) },
    ]);

    const result = await checkRestockAlerts("prod-1", "ret-1", {
      from: "OUT_OF_STOCK",
      to: "IN_STOCK",
    });

    expect(result.triggered).toBe(0);
    expect(alertCreate).not.toHaveBeenCalled();
    expect(alertFindFirst).not.toHaveBeenCalled(); // hann aldrig till cooldownen
  });

  it("flappande par: cooldownen vidgas till ett dygn", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    restockEventFindMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        oldStatus: i % 2 === 0 ? "OUT_OF_STOCK" : "IN_STOCK",
        detectedAt: new Date(Date.now() - i * 90 * 60_000),
      }))
    );

    await checkRestockAlerts("prod-1", "ret-1", { from: "OUT_OF_STOCK", to: "IN_STOCK" });

    const where = (alertFindFirst.mock.calls[0][0] as { where: { triggeredAt: { gte: Date } } }).where;
    const windowH = (Date.now() - where.triggeredAt.gte.getTime()) / 3600_000;
    expect(windowH).toBeGreaterThan(23);
  });

  it("lugn produkt: 2h-cooldownen står kvar", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    restockEventFindMany.mockResolvedValue([
      { oldStatus: "OUT_OF_STOCK", detectedAt: new Date() },
      { oldStatus: "IN_STOCK", detectedAt: new Date(Date.now() - 30 * 3600_000) },
    ]);

    const result = await checkRestockAlerts("prod-1", "ret-1", {
      from: "OUT_OF_STOCK",
      to: "IN_STOCK",
    });

    expect(result.triggered).toBe(1);
    const where = (alertFindFirst.mock.calls[0][0] as { where: { triggeredAt: { gte: Date } } }).where;
    const windowH = (Date.now() - where.triggeredAt.gte.getTime()) / 3600_000;
    expect(windowH).toBeLessThan(3);
  });

  it("utan butik (retailerId saknas) frågas ingen flapp-historik", async () => {
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);
    await checkRestockAlerts("prod-1");
    expect(restockEventFindMany).not.toHaveBeenCalled();
  });
});

describe("checkListingAlerts (feed-först: rå butiksannonser utanför katalogen)", () => {
  const LISTING = { id: "sl-1", title: "Poké Ball Tin 2025 v2", retailerId: "ret-9" };

  it("skapar NEW_LISTING EMAIL-alert med storeListingId för alla-restocks-Pro-prenumeranter", async () => {
    userFindMany.mockResolvedValue([{ id: "sub-1" }]);

    const result = await checkListingAlerts(LISTING, "NEW_LISTING");

    expect(result.triggered).toBe(1);
    const args = alertCreate.mock.calls[0][0] as {
      data: { type: string; channel: string; storeListingId: string; retailerId: string; productId?: string; message: string };
    };
    expect(args.data.type).toBe("NEW_LISTING");
    expect(args.data.channel).toBe("EMAIL");
    expect(args.data.storeListingId).toBe("sl-1");
    expect(args.data.retailerId).toBe("ret-9");
    expect(args.data.productId).toBeNull(); // ingen produkt → faller tillbaka på storeListingId
    expect(args.data.message).toContain(LISTING.title);
  });

  it("auto-importerad: sätter productId (in-app-länk) och släpper storeListingId", async () => {
    userFindMany.mockResolvedValue([{ id: "sub-1" }]);
    await checkListingAlerts({ ...LISTING, productId: "prod-9" }, "NEW_LISTING");
    const args = alertCreate.mock.calls[0][0] as { data: { productId: string | null; storeListingId: string | null } };
    expect(args.data.productId).toBe("prod-9");
    expect(args.data.storeListingId).toBeNull();
  });

  it("RESTOCK-varianten använder RESTOCK-typen", async () => {
    userFindMany.mockResolvedValue([{ id: "sub-1" }]);
    await checkListingAlerts(LISTING, "RESTOCK");
    expect((alertCreate.mock.calls[0][0] as { data: { type: string } }).data.type).toBe("RESTOCK");
  });

  // Auto-importen länkar annonsen till en BEFINTLIG katalogprodukt → bevakaren måste
  // med, annars är "en butik började sälja det du bevakar" tyst för alla som stängt
  // av "Alla restocks" (mätt hål 2026-07-25: Samlarhobby 07-19).
  it("larmar Pro-bevakare av den auto-importerade produkten utan allRestocks", async () => {
    userFindMany.mockResolvedValue([]); // ingen prenumererar på alla restocks
    watchlistFindMany.mockResolvedValue([{ userId: "watcher-1" }]);

    const result = await checkListingAlerts({ ...LISTING, productId: "prod-9" }, "RESTOCK");

    expect(result.triggered).toBe(1);
    expect((alertCreate.mock.calls[0][0] as { data: { userId: string } }).data.userId).toBe("watcher-1");
    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod-9",
          restockAlert: true,
          isPaused: false,
          user: proUserWhereMatch,
        }),
      })
    );
  });

  it("dedupar: bevakare som OCKSÅ har allRestocks får ett larm", async () => {
    userFindMany.mockResolvedValue([{ id: "user-1" }, { id: "sub-2" }]);
    watchlistFindMany.mockResolvedValue([{ userId: "user-1" }]);

    const result = await checkListingAlerts({ ...LISTING, productId: "prod-9" }, "NEW_LISTING");

    expect(result.triggered).toBe(2); // user-1 (en gång) + sub-2
    expect(alertCreate).toHaveBeenCalledTimes(2);
  });

  it("utan produkt-koppling frågas bevakningarna inte alls", async () => {
    userFindMany.mockResolvedValue([{ id: "sub-1" }]);
    await checkListingAlerts(LISTING, "NEW_LISTING");
    expect(watchlistFindMany).not.toHaveBeenCalled();
  });

  it("filtrerar på Pro + allRestocks=true, och larmar inget utan prenumeranter", async () => {
    userFindMany.mockResolvedValue([]);
    const result = await checkListingAlerts(LISTING, "NEW_LISTING");
    expect(result.triggered).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          notificationSettings: { path: ["allRestocks"], equals: true },
          OR: proWhereOr,
        }),
      })
    );
  });
});
