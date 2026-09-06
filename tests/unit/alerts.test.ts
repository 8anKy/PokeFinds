/**
 * Tester för checkPriceAlerts/checkRestockAlerts i src/services/alerts.ts.
 * Prisma mockas — vi verifierar att EMAIL-alerts skapas för rätt bevakningar och
 * att filtreringen (targetPrice >= nytt pris, ej pausad) skickas till DB korrekt.
 * (In-app-notiser borttagna → ingen Notification-skrivning längre.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindUnique = vi.fn();
const watchlistFindMany = vi.fn();
const watchlistUpdate = vi.fn();
const userFindMany = vi.fn();
const alertCreate = vi.fn();
const alertFindFirst = vi.fn();
const restockEventFindMany = vi.fn();
const offerFindMany = vi.fn();
const transaction = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => productFindUnique(...args) },
    watchlistItem: {
      findMany: (...args: unknown[]) => watchlistFindMany(...args),
      update: (...args: unknown[]) => watchlistUpdate(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
    alert: {
      create: (...args: unknown[]) => alertCreate(...args),
      findFirst: (...args: unknown[]) => alertFindFirst(...args),
    },
    restockEvent: { findMany: (...args: unknown[]) => restockEventFindMany(...args) },
    offer: { findMany: (...args: unknown[]) => offerFindMany(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

import {
  checkPriceAlerts,
  checkRestockAlerts,
  checkListingAlerts,
  evaluateStockFlap,
  flapPolicy,
  lowestBuyableByProduct,
  rearmPriceAlerts,
} from "@/services/alerts";

// Pro-mottagare = planTier PREMIUM, admin-roll, aktiv referral-bonus ELLER aktiv
// Stripe-prenumeration (lib/plan.proUserWhere). Assertar mot samma struktur som
// koden bygger — ett bart planTier-filter missar admins (2026-07-08) och
// webbkunder (Stripe rör aldrig planTier). proUserWhere() bakar in new Date() i
// datum-grenarna → koden och testet anropar den millisekunder isär, så en EXAKT
// Date-jämförelse flakar. Matcha strukturen med expect.any(Date).
const proWhereOr: unknown[] = [
  { planTier: "PREMIUM" },
  { role: { in: ["ADMIN", "SUPERADMIN"] } },
  { bonusProUntil: { gt: expect.any(Date) } },
  { stripeProUntil: { gt: expect.any(Date) } },
];
const proUserWhereMatch = { OR: proWhereOr };

const PRODUCT = {
  id: "prod-1",
  title: "Surging Sparks Booster Box",
  slug: "surging-sparks-booster-box",
  hiddenAt: null,
  lowestPriceOre: 180000,
};

/** En köpbar offer: i lager, direktlänk, pris > 0. */
const buyable = (over: Partial<{ id: string; price: number; url: string; retailerId: string; name: string }> = {}) => ({
  id: over.id ?? "off-1",
  productId: "prod-1",
  price: over.price ?? 149900,
  url: over.url ?? "https://butik.se/products/surging-sparks-booster-box",
  retailerId: over.retailerId ?? "ret-1",
  retailer: { name: over.name ?? "Butiken" },
});

beforeEach(() => {
  process.env.PRICE_ALERTS_PAUSED = "0"; // testerna handlar om domen, inte om pausen
  productFindUnique.mockReset().mockResolvedValue(PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([]);
  watchlistUpdate.mockReset().mockImplementation((args: unknown) => args);
  userFindMany.mockReset().mockResolvedValue([]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  alertFindFirst.mockReset().mockResolvedValue(null); // inget nyligt restock-larm → cooldown öppen
  restockEventFindMany.mockReset().mockResolvedValue([]); // ingen flapp-historik
  offerFindMany.mockReset().mockResolvedValue([buyable()]);
  transaction.mockReset().mockResolvedValue([]);
  executeRaw.mockReset().mockResolvedValue(0);
});

/**
 * Prislarmen efter lagningen 2026-09-06 (de sex defekterna i price-alerts-pause.ts).
 * Domen i sig testas i price-alert-rule.test.ts; här vaktas integrationen: rätt
 * offer-urval, rätt rader, ETT pris, spärren skrivs.
 */
describe("checkPriceAlerts", () => {
  it("målpris nått ⇒ PRICE_TARGET-larm med larmets EGET pris + butik, och spärren skrivs i samma transaktion", async () => {
    watchlistFindMany.mockResolvedValue([
      { id: "w1", userId: "user-1", targetPrice: 150000, priceAlertFiredOre: null },
      { id: "w2", userId: "user-2", targetPrice: 160000, priceAlertFiredOre: null },
    ]);

    const result = await checkPriceAlerts("prod-1");

    expect(result.triggered).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(alertCreate).toHaveBeenCalledTimes(2);
    expect(watchlistUpdate).toHaveBeenCalledTimes(2);

    const alertArgs = alertCreate.mock.calls[0][0] as {
      data: { userId: string; productId: string; retailerId: string; type: string; priceOre: number; message: string; channel: string };
    };
    expect(alertArgs.data).toMatchObject({
      type: "PRICE_TARGET",
      channel: "EMAIL",
      userId: "user-1",
      productId: "prod-1",
      retailerId: "ret-1",
      priceOre: 149900,
    });
    expect(alertArgs.data.message).toContain(PRODUCT.title);
    expect(alertArgs.data.message).toMatch(/1.499 kr/); // sv-SE-tusentalsavgränsaren är ett smalt mellanslag
    expect(alertArgs.data.message).toContain("Butiken");
    expect(watchlistUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { priceAlertFiredOre: 149900, priceAlertFiredAt: expect.any(Date) },
    });
  });

  it("domen tas på produktens LÄGSTA KÖPBARA pris: i lager + direktlänk + > 0 kr", async () => {
    // Defekt 1: larmet "nu 1 338 kr" kom ur en slutsåld offer. Nu frågas bara IN_STOCK
    // och pris > 0, och sök-/bläddringslänkar hoppas — precis som produktsidan.
    watchlistFindMany.mockResolvedValue([{ id: "w1", userId: "user-1", targetPrice: 150000, priceAlertFiredOre: null }]);
    offerFindMany.mockResolvedValue([
      buyable({ id: "search", price: 100000, url: "https://butik.se/search?q=surging" }), // billigast men söklänk
      buyable({ id: "real", price: 149900 }),
    ]);

    await checkPriceAlerts("prod-1");

    expect(offerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ productId: { in: ["prod-1"] }, stockStatus: "IN_STOCK", price: { gt: 0 } }),
        orderBy: { price: "asc" },
      })
    );
    expect((alertCreate.mock.calls[0][0] as { data: { priceOre: number } }).data.priceOre).toBe(149900);
  });

  it("inget köpbart pris ⇒ inget larm, räknas som no-price", async () => {
    watchlistFindMany.mockResolvedValue([{ id: "w1", userId: "user-1", targetPrice: 150000, priceAlertFiredOre: null }]);
    offerFindMany.mockResolvedValue([]);
    const result = await checkPriceAlerts("prod-1");
    expect(result).toEqual({ triggered: 0, skipped: { "no-price": 1 } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("SPÄRREN: en bevakning som redan larmat för den här målnåddheten larmar inte igen", async () => {
    watchlistFindMany.mockResolvedValue([{ id: "w1", userId: "user-1", targetPrice: 150000, priceAlertFiredOre: 149900 }]);
    offerFindMany.mockResolvedValue([buyable({ price: 140000 })]);
    const result = await checkPriceAlerts("prod-1");
    expect(result).toEqual({ triggered: 0, skipped: { latched: 1 } });
    expect(alertCreate).not.toHaveBeenCalled();
  });

  it("prisfall-läget (inget målpris): larmar på ett tydligt fall från priset användaren senast såg", async () => {
    // Defekt 4: "lämna tomt för att bara bevaka prisfall" — nu på riktigt. Utgångsläget
    // är produktens cachade lägstapris när anroparen inte vet bättre.
    watchlistFindMany.mockResolvedValue([{ id: "w1", userId: "user-1", targetPrice: null, priceAlertFiredOre: null }]);
    offerFindMany.mockResolvedValue([buyable({ price: 160000 })]); // 180 000 → 160 000 = −11 %

    const result = await checkPriceAlerts("prod-1");

    expect(result.triggered).toBe(1);
    const data = (alertCreate.mock.calls[0][0] as { data: { type: string; priceOre: number; message: string } }).data;
    expect(data.type).toBe("PRICE_DROP");
    expect(data.priceOre).toBe(160000);
    expect(data.message).toContain("−11 %");
  });

  it("anroparens `previousOre` vinner över det cachade lägstapriset (svepet vet vad som gällde före jobbet)", async () => {
    watchlistFindMany.mockResolvedValue([{ id: "w1", userId: "user-1", targetPrice: null, priceAlertFiredOre: null }]);
    offerFindMany.mockResolvedValue([buyable({ price: 160000 })]);
    const result = await checkPriceAlerts("prod-1", { previousOre: 162000 }); // 1,2 % — under golvet
    expect(result).toEqual({ triggered: 0, skipped: { "too-small": 1 } });
  });

  it("filtrerar bevakningar i databasen: aktivt prislarm, ej pausad, endast Pro — målpris avgörs i koden", async () => {
    await checkPriceAlerts("prod-1");
    expect(watchlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "prod-1", priceAlert: true, isPaused: false, user: proUserWhereMatch },
      })
    );
  });

  it("pausat läge: inte en enda fråga", async () => {
    process.env.PRICE_ALERTS_PAUSED = "1";
    const result = await checkPriceAlerts("prod-1");
    expect(result.triggered).toBe(0);
    expect(productFindUnique).not.toHaveBeenCalled();
  });

  it("returnerar 0 om produkten inte finns eller är gömd", async () => {
    productFindUnique.mockResolvedValue(null);
    expect((await checkPriceAlerts("saknas")).triggered).toBe(0);
    expect(watchlistFindMany).not.toHaveBeenCalled();
    productFindUnique.mockResolvedValue({ ...PRODUCT, hiddenAt: new Date() });
    expect((await checkPriceAlerts("prod-1")).triggered).toBe(0);
    expect(watchlistFindMany).not.toHaveBeenCalled();
  });
});

describe("lowestBuyableByProduct", () => {
  it("första direktlänkade i-lager-offern per produkt, billigast först; tom lista ⇒ ingen fråga", async () => {
    offerFindMany.mockResolvedValue([
      { ...buyable({ id: "a", price: 100, url: "https://x.se/search?q=1" }), productId: "p1" },
      { ...buyable({ id: "b", price: 200 }), productId: "p1" },
      { ...buyable({ id: "c", price: 300 }), productId: "p1" },
      { ...buyable({ id: "d", price: 50 }), productId: "p2" },
    ]);
    const m = await lowestBuyableByProduct(["p1", "p2"]);
    expect(m.get("p1")?.id).toBe("b");
    expect(m.get("p2")?.id).toBe("d");
    expect(await lowestBuyableByProduct([])).toEqual(new Map());
    expect(offerFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("rearmPriceAlerts", () => {
  it("släpper spärrar med EN fråga och returnerar antalet", async () => {
    executeRaw.mockResolvedValue(3);
    expect(await rearmPriceAlerts()).toBe(3);
    expect(executeRaw).toHaveBeenCalledTimes(1);
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

  it("standardpolicyn är 20 min / 6 övergångar / 24h", () => {
    // 20, inte 60, sedan 2026-08-10 (ägarbeslut): 60-blinken åt ett äkta larm —
    // en vara som var borta 30 min och fylldes på är precis det man bevakar.
    expect(flapPolicy()).toEqual({
      minAwayMinutes: 20,
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
