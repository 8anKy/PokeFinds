import { describe, expect, it } from "vitest";
import {
  planChangesForEvent,
  subscriptionStatesForEvent,
  willRenewForEvent,
} from "@/app/api/webhooks/revenuecat/mapping";

/**
 * Förnyelsestatusen är en EGEN dom bredvid planen: CANCELLATION rör inte
 * planTier (access kvar till EXPIRATION) men adminen måste se att kunden
 * sagt upp — annars är "8 prenumeranter" en lögn om nästa månad.
 */
describe("willRenewForEvent — förnyas prenumerationen?", () => {
  it("köp, förnyelse och ångrad uppsägning = förnyas", () => {
    for (const t of ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"]) {
      expect(willRenewForEvent(t)).toBe(true);
    }
  });
  it("uppsägning, utgång och engångsköp = förnyas inte", () => {
    for (const t of ["CANCELLATION", "EXPIRATION", "NON_RENEWING_PURCHASE"]) {
      expect(willRenewForEvent(t)).toBe(false);
    }
  });
  it("event som inte säger något om förnyelsen ger null — skrivs aldrig", () => {
    expect(willRenewForEvent("BILLING_ISSUE")).toBeNull();
    expect(willRenewForEvent("TEST")).toBeNull();
  });
});

describe("subscriptionStatesForEvent", () => {
  it("CANCELLATION rör inte planen men skriver förnyelse=false med utgångsdatum", () => {
    expect(planChangesForEvent({ type: "CANCELLATION", app_user_id: "u1" })).toEqual([]);
    expect(
      subscriptionStatesForEvent({
        type: "CANCELLATION",
        app_user_id: "u1",
        expiration_at_ms: 1_800_000_000_000,
        environment: "PRODUCTION",
      })
    ).toEqual([
      {
        userId: "u1",
        willRenew: false,
        expiresAt: new Date(1_800_000_000_000),
        environment: "PRODUCTION",
      },
    ]);
  });

  it("BILLING_ISSUE ger ingen status alls (null får inte radera ett känt värde)", () => {
    expect(subscriptionStatesForEvent({ type: "BILLING_ISSUE", app_user_id: "u1" })).toEqual([]);
  });

  it("TRANSFER: mottagaren förnyas, avsändaren har inget kvar", () => {
    expect(
      subscriptionStatesForEvent({
        type: "TRANSFER",
        transferred_from: ["gammal"],
        transferred_to: ["ny"],
        expiration_at_ms: 1_800_000_000_000,
      })
    ).toEqual([
      { userId: "ny", willRenew: true, expiresAt: new Date(1_800_000_000_000), environment: null },
      { userId: "gammal", willRenew: false, expiresAt: null, environment: null },
    ]);
  });

  it("anonyma id:n ignoreras och saknat expiration_at_ms blir null", () => {
    expect(subscriptionStatesForEvent({ type: "RENEWAL", app_user_id: "$RCAnonymousID:x" })).toEqual(
      []
    );
    expect(subscriptionStatesForEvent({ type: "RENEWAL", app_user_id: "u1" })).toEqual([
      { userId: "u1", willRenew: true, expiresAt: null, environment: null },
    ]);
  });
});
