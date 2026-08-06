import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  GRACE_DAYS,
  HANDLED_EVENTS,
  proUntilForSubscription,
  statusGrantsPro,
} from "@/app/api/webhooks/stripe/mapping";
import { subscriptionPeriodEnd } from "@/lib/stripe";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 2026-09-01T00:00:00Z i sekunder — Stripes enhet. */
const PERIOD_END = Math.floor(Date.UTC(2026, 8, 1) / 1000);

/** Minsta prenumeration testerna behöver; resten av objektet är ovidkommande. */
function sub(items: Array<{ current_period_end?: number }>, extra: object = {}) {
  return { items: { data: items }, ...extra } as unknown as Stripe.Subscription;
}

describe("subscriptionPeriodEnd", () => {
  // ⛔ REGRESSIONEN SOM MOTIVERAR HELA FUNKTIONEN: i den API-version SDK:n (v22)
  // pinnar finns `current_period_end` INTE på Subscription-objektet — det bor på
  // posterna. En läsning på toppnivån ger undefined → proUntilForSubscription
  // returnerar null → INGEN får någonsin Pro, tyst och bara i produktion.
  it("läser periodslutet från POSTERNA, inte från toppnivån", () => {
    expect(subscriptionPeriodEnd(sub([{ current_period_end: PERIOD_END }]))).toBe(PERIOD_END);
  });

  it("tar det senaste slutet när prenumerationen bär flera poster", () => {
    const earlier = PERIOD_END - 10 * 24 * 60 * 60;
    expect(
      subscriptionPeriodEnd(
        sub([{ current_period_end: earlier }, { current_period_end: PERIOD_END }])
      )
    ).toBe(PERIOD_END);
  });

  it("faller tillbaka på toppnivåfältet för äldre API-versioner", () => {
    expect(subscriptionPeriodEnd(sub([], { current_period_end: PERIOD_END }))).toBe(PERIOD_END);
  });

  it("ger null när datumet saknas helt — hellre inget svar än ett påhittat", () => {
    expect(subscriptionPeriodEnd(sub([]))).toBeNull();
    expect(subscriptionPeriodEnd(sub([{ current_period_end: 0 }]))).toBeNull();
  });
});

describe("statusGrantsPro", () => {
  it("aktiv och provperiod ger Pro", () => {
    expect(statusGrantsPro("active")).toBe(true);
    expect(statusGrantsPro("trialing")).toBe(true);
  });

  // Förnyelsen nekades och Stripe gör om försöket. Kunden har redan betalat fram
  // till periodens slut, så nåden nedan är hela extratiden de får.
  it("past_due ger Pro — ett utgånget kort är inte en uppsägning", () => {
    expect(statusGrantsPro("past_due")).toBe(true);
  });

  it("avslutad, obetald och ofullständig ger inte Pro", () => {
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(statusGrantsPro(s)).toBe(false);
    }
  });
});

describe("proUntilForSubscription", () => {
  it("ger periodslutet plus nåden", () => {
    const until = proUntilForSubscription("active", PERIOD_END);
    expect(until?.getTime()).toBe(PERIOD_END * 1000 + GRACE_DAYS * DAY_MS);
  });

  it("ger null när prenumerationen sagts upp", () => {
    expect(proUntilForSubscription("canceled", PERIOD_END)).toBeNull();
  });

  // Utan datum finns inget att lova. Att gissa "en månad framåt" hade gett gratis
  // Pro åt ett trasigt svar.
  it("ger null när periodslutet saknas, även för aktiv status", () => {
    expect(proUntilForSubscription("active", null)).toBeNull();
    expect(proUntilForSubscription("active", undefined)).toBeNull();
  });

  // Webhooks kan levereras flera gånger och i FEL ORDNING. Ett absolut datum
  // härlett ur prenumerationen ger samma svar varje gång — därav ingen boolean.
  it("är idempotent — samma indata ger samma datum", () => {
    const a = proUntilForSubscription("active", PERIOD_END);
    const b = proUntilForSubscription("active", PERIOD_END);
    expect(a?.getTime()).toBe(b?.getTime());
  });
});

describe("HANDLED_EVENTS", () => {
  it("täcker köpet och hela prenumerationens livscykel", () => {
    for (const e of [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]) {
      expect(HANDLED_EVENTS.has(e)).toBe(true);
    }
  });

  it("ignorerar event vi inte agerar på", () => {
    expect(HANDLED_EVENTS.has("payment_intent.succeeded")).toBe(false);
  });
});
