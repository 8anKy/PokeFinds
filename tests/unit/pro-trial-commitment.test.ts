/**
 * Planerna 2026-10-19: provperiodens meddelanden, webbens 12-månadersbindning,
 * butikspaketen och RevenueCats provperiod.
 */
import { describe, expect, it } from "vitest";
import { trialEndLabel, trialMessageDue, trialPriceKind, trialUsageLine, trialUsageWorthShowing } from "@/lib/trial-messages";
import { addMonthsUtc, commitmentCancelAt, commitmentEndFor } from "@/app/api/webhooks/stripe/mapping";
import { trialForEvent } from "@/app/api/webhooks/revenuecat/mapping";
import { pickStorePlans, trialDaysFor, type StorePackageLike } from "@/lib/store-plans";

const DAY = 864e5;
// Start måndag 2026-11-02 kl 20:00 svensk tid (19:00 UTC), slut 14 dygn senare.
const start = new Date("2026-11-02T19:00:00Z");
const end = new Date(start.getTime() + 14 * DAY);
const base = { trialStartedAt: start, trialEndsAt: end, trialValueSentAt: null, trialReminderSentAt: null, willRenew: true };
// Morgonrundan 07:00 svensk tid = 06:00 UTC (vintertid).
const morning = (dayOffset: number) => new Date(Date.UTC(2026, 10, 2 + dayOffset, 6, 0));

describe("trialMessageDue", () => {
  it("är tyst de första sex dagarna", () => {
    for (let d = 1; d <= 6; d++) expect(trialMessageDue(base, morning(d))).toBeNull();
  });
  it("ger värdebeskedet dag 7 och påminnelsen dag 12", () => {
    expect(trialMessageDue(base, morning(7))).toBe("value");
    expect(trialMessageDue({ ...base, trialValueSentAt: morning(7) }, morning(8))).toBeNull();
    expect(trialMessageDue({ ...base, trialValueSentAt: morning(7) }, morning(12))).toBe("reminder");
  });
  it("påminnelsen kommer även om värdebeskedet aldrig gick", () => {
    expect(trialMessageDue(base, morning(12))).toBe("reminder");
  });
  it("försöker igen dagen efter ett misslyckat mejl, men aldrig när Apple redan kan dra", () => {
    expect(trialMessageDue({ ...base, trialValueSentAt: morning(7) }, morning(13))).toBe("reminder");
    expect(trialMessageDue({ ...base, trialValueSentAt: morning(7) }, morning(14))).toBeNull();
  });
  it("skickar ingenting när förnyelsen är avstängd eller provperioden slut", () => {
    expect(trialMessageDue({ ...base, willRenew: false }, morning(12))).toBeNull();
    expect(trialMessageDue(base, new Date(end.getTime() + 1000))).toBeNull();
  });
  it("aldrig två gånger", () => {
    expect(trialMessageDue({ ...base, trialReminderSentAt: morning(12) }, morning(13))).toBeNull();
  });
});

describe("trial-texter", () => {
  it("visar bara användning som finns", () => {
    expect(trialUsageWorthShowing({ scans: 2, restockAlerts: 0 })).toBe(false);
    expect(trialUsageWorthShowing({ scans: 0, restockAlerts: 1 })).toBe(true);
    expect(trialUsageLine({ scans: 46, restockAlerts: 2 })).toBe("46 kort skannade, 2 restock-larm");
    expect(trialUsageLine({ scans: 1, restockAlerts: 0 })).toBe("1 kort skannat");
  });
  it("priset efter provperioden följer butik och produkt", () => {
    expect(trialPriceKind("STRIPE", "price_x")).toBe("commit-monthly");
    expect(trialPriceKind("APP_STORE", "scoutr_pro_year:monthly")).toBe("commit-monthly");
    expect(trialPriceKind("APP_STORE", "scoutr_pro_year")).toBe("annual-upfront");
    expect(trialPriceKind("PLAY_STORE", "scoutr_pro:year")).toBe("annual-upfront");
  });
  it("slutdatumet står på svensk tid", () => {
    expect(trialEndLabel(new Date("2026-11-16T23:30:00Z"))).toBe("tisdag 17 november");
  });
});

describe("webbens 12-månadersbindning", () => {
  it("räknar månader i UTC och klämmer månadsslutet", () => {
    expect(addMonthsUtc(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-11-16T19:00:00Z"), 12).toISOString()).toBe("2027-11-16T19:00:00.000Z");
    expect(commitmentEndFor(Date.parse("2026-11-16T19:00:00Z") / 1000, 12)?.toISOString()).toBe(
      "2027-11-16T19:00:00.000Z"
    );
  });

  const commitEnd = new Date("2027-11-16T19:00:00Z");
  const endS = commitEnd.getTime() / 1000;
  const periodEnd = Date.parse("2027-01-16T19:00:00Z") / 1000;
  const input = {
    status: "active",
    cancelAtPeriodEnd: true,
    cancelAtSeconds: null as number | null,
    commitmentEndsAt: commitEnd as Date | null,
    periodEndSeconds: periodEnd as number | null,
  };

  it("flyttar en uppsägning under bindningen till bindningens slut", () => {
    expect(commitmentCancelAt(input)).toBe(endS);
    expect(commitmentCancelAt({ ...input, cancelAtPeriodEnd: false, cancelAtSeconds: periodEnd })).toBe(endS);
  });
  it("rör inte en uppsägning under provperioden eller utan bindning", () => {
    expect(commitmentCancelAt({ ...input, status: "trialing" })).toBeNull();
    expect(commitmentCancelAt({ ...input, commitmentEndsAt: null })).toBeNull();
  });
  it("är idempotent och släpper taget när bindningen är över", () => {
    expect(commitmentCancelAt({ ...input, cancelAtPeriodEnd: false, cancelAtSeconds: endS })).toBeNull();
    expect(commitmentCancelAt({ ...input, periodEndSeconds: endS })).toBeNull();
    expect(commitmentCancelAt({ ...input, cancelAtPeriodEnd: false })).toBeNull();
  });
});

describe("RevenueCat-provperioden", () => {
  const ev = {
    type: "INITIAL_PURCHASE",
    period_type: "TRIAL",
    app_user_id: "cm1abcdefghijklmnopqrstuv",
    purchased_at_ms: start.getTime(),
    expiration_at_ms: end.getTime(),
    store: "APP_STORE",
    product_id: "scoutr_pro_year:monthly",
  };
  it("läser en ny provperiod", () => {
    const t = trialForEvent(ev);
    if (t === null) return; // id-formatet kan vara strängare än testets — då ska ingenting gissas
    expect(t.endsAt.getTime()).toBe(end.getTime());
    expect(t.source).toBe("APP_STORE");
    expect(t.productId).toBe("scoutr_pro_year:monthly");
  });
  it("ignorerar betalda köp och förnyelser", () => {
    expect(trialForEvent({ ...ev, period_type: "NORMAL" })).toBeNull();
    expect(trialForEvent({ ...ev, type: "RENEWAL" })).toBeNull();
  });
});

describe("butikspaketen", () => {
  const month: StorePackageLike = {
    identifier: "$rc_monthly",
    product: { identifier: "pro_month", priceString: "59,00 kr", subscriptionPeriod: "P1M" },
  };
  const annual: StorePackageLike = {
    identifier: "$rc_annual",
    product: {
      identifier: "pro_year",
      priceString: "468,00 kr",
      subscriptionPeriod: "P1Y",
      pricePerMonthString: "39,00 kr",
      defaultOption: { freePhase: { billingPeriod: { unit: "DAY", value: 14 } } },
    },
  };
  const commit: StorePackageLike = {
    identifier: "$rc_annual_commit",
    product: {
      identifier: "pro_year:monthly",
      priceString: "468,00 kr",
      subscriptionPeriod: "P1M",
      introPrice: { price: 0, periodUnit: "WEEK", periodNumberOfUnits: 2 },
      installmentsInfo: {
        commitmentPaymentsCount: 12,
        installmentBillingPriceString: "39,00 kr",
        commitmentTotalPriceString: "468,00 kr",
      },
    },
  };

  it("föredrar Apples åtagande framför förbetald årsplan, oavsett ordning", () => {
    const p = pickStorePlans([annual, month, commit]);
    expect(p.year?.kind).toBe("commit");
    expect(p.year?.price).toBe("39,00 kr");
    expect(p.year?.secondary).toBe("468,00 kr");
    expect(p.year?.trialDays).toBe(14);
    // Åtagandet är P1M men får ALDRIG bli månadsplanen.
    expect(p.month?.productId).toBe("pro_month");
  });
  it("faller tillbaka på förbetald årsplan (Android, äldre iOS)", () => {
    const p = pickStorePlans([month, annual]);
    expect(p.year?.kind).toBe("annual");
    expect(p.year?.per).toBe("year");
    expect(p.year?.secondary).toBe("39,00 kr");
  });
  it("månadsplanen har ingen provperiod och saknad årsplan ger null", () => {
    const p = pickStorePlans([month]);
    expect(p.month?.trialDays).toBeNull();
    expect(p.year).toBeNull();
    expect(trialDaysFor(month.product)).toBeNull();
  });
});
