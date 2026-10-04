import { describe, expect, it } from "vitest";
import { subscriptionHistory, type SubscriptionAuditRow } from "@/lib/subscription-history";

const rc = (at: string, event: string, extra: Record<string, unknown> = {}): SubscriptionAuditRow => ({
  action: "user.plan.revenuecat",
  createdAt: new Date(at),
  metadata: { event, environment: "PRODUCTION", ...extra },
});
const stripe = (
  at: string,
  from: string | null,
  to: string | null,
  cancelAtPeriodEnd: boolean
): SubscriptionAuditRow => ({
  action: "user.plan.stripe",
  createdAt: new Date(at),
  metadata: { event: "customer.subscription.updated", from, to, cancelAtPeriodEnd },
});

describe("subscriptionHistory", () => {
  it("räknar förnyelser som streak", () => {
    const h = subscriptionHistory([
      rc("2026-08-29T11:57Z", "INITIAL_PURCHASE"),
      rc("2026-09-29T04:01Z", "RENEWAL"),
    ]);
    expect(h.active).toBe(true);
    expect(h.periodsInRun).toBe(2);
    expect(h.comebacks).toBe(0);
    expect(h.lastCancelAt).toBeNull();
  });

  it("uppsägning ger datumet, utgång avslutar", () => {
    const h = subscriptionHistory([
      rc("2026-08-22T12:23Z", "INITIAL_PURCHASE"),
      rc("2026-09-02T01:17Z", "DASHBOARD_BACKFILL", { willRenew: false }),
      rc("2026-09-22T12:23Z", "EXPIRATION"),
    ]);
    expect(h.active).toBe(false);
    expect(h.lastCancelAt?.toISOString()).toBe("2026-09-02T01:17:00.000Z");
    expect(h.lastCancelApprox).toBe(true);
    expect(h.lastEndAt?.toISOString()).toBe("2026-09-22T12:23:00.000Z");
    expect(h.totalPeriods).toBe(1);
  });

  it("återköp efter utgång är en återkomst och nollar streaken", () => {
    const h = subscriptionHistory([
      rc("2026-08-01T00:00Z", "INITIAL_PURCHASE"),
      rc("2026-09-01T00:00Z", "RENEWAL"),
      rc("2026-09-05T00:00Z", "CANCELLATION"),
      rc("2026-10-01T00:00Z", "EXPIRATION"),
      rc("2026-10-10T00:00Z", "RENEWAL"),
      rc("2026-11-10T00:00Z", "RENEWAL"),
    ]);
    expect(h.active).toBe(true);
    expect(h.comebacks).toBe(1);
    expect(h.lastComebackAt?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(h.periodsInRun).toBe(2);
    expect(h.totalPeriods).toBe(4);
    expect(h.firstStartAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("ångrad uppsägning är en återkomst utan att bryta streaken", () => {
    const h = subscriptionHistory([
      rc("2026-08-01T00:00Z", "INITIAL_PURCHASE"),
      rc("2026-08-10T00:00Z", "CANCELLATION"),
      rc("2026-08-20T00:00Z", "UNCANCELLATION"),
      rc("2026-09-01T00:00Z", "RENEWAL"),
    ]);
    expect(h.comebacks).toBe(1);
    expect(h.periodsInRun).toBe(2);
  });

  it("sandbox-event räknas inte", () => {
    const h = subscriptionHistory([rc("2026-08-01T00:00Z", "INITIAL_PURCHASE", { environment: "SANDBOX" })]);
    expect(h.firstStartAt).toBeNull();
  });

  it("Stripe: dubbelstart, periodhopp, uppsägning och borttagning", () => {
    const h = subscriptionHistory([
      stripe("2026-09-28T14:33:00Z", null, "2026-10-31T00:00Z", false),
      stripe("2026-09-28T14:33:05Z", "2026-10-31T00:00Z", "2026-10-31T00:00Z", false),
      stripe("2026-10-28T00:00Z", "2026-10-31T00:00Z", "2026-11-30T00:00Z", false),
      stripe("2026-11-05T00:00Z", "2026-11-30T00:00Z", "2026-11-30T00:00Z", true),
      stripe("2026-11-30T00:00Z", "2026-11-30T00:00Z", null, true),
    ]);
    expect(h.totalPeriods).toBe(2);
    expect(h.lastCancelAt?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(h.lastEndAt?.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(h.active).toBe(false);
    expect(h.comebacks).toBe(0);
  });
});
