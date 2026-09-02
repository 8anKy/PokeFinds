import { describe, expect, it } from "vitest";
import { RENEWAL_LABELS, renewalStatus } from "@/lib/subscription-status";

const future = new Date(Date.now() + 30 * 864e5);
const base = {
  role: "USER" as const,
  planTier: "FREE" as const,
  bonusProUntil: null,
  stripeProUntil: null,
  stripeCancelAtPeriodEnd: null,
  rcWillRenew: null,
};

describe("renewalStatus — tre utfall, aldrig två", () => {
  it("app-kund: RevenueCats willRenew avgör, okänt tills ett event skrivit det", () => {
    expect(renewalStatus({ ...base, planTier: "PREMIUM" })).toBe("unknown");
    expect(renewalStatus({ ...base, planTier: "PREMIUM", rcWillRenew: true })).toBe("yes");
    expect(renewalStatus({ ...base, planTier: "PREMIUM", rcWillRenew: false })).toBe("no");
  });

  it("Stripe-kund: cancel_at_period_end inverterat", () => {
    expect(renewalStatus({ ...base, stripeProUntil: future })).toBe("unknown");
    expect(
      renewalStatus({ ...base, stripeProUntil: future, stripeCancelAtPeriodEnd: false })
    ).toBe("yes");
    expect(renewalStatus({ ...base, stripeProUntil: future, stripeCancelAtPeriodEnd: true })).toBe(
      "no"
    );
  });

  it("betalkällan går före: Stripe-kund som också har planTier läser Stripe", () => {
    expect(
      renewalStatus({
        ...base,
        planTier: "PREMIUM",
        rcWillRenew: false,
        stripeProUntil: future,
        stripeCancelAtPeriodEnd: false,
      })
    ).toBe("yes");
  });

  it("bonus, roll och gratis = inget att förnya", () => {
    expect(renewalStatus({ ...base, bonusProUntil: future, rcWillRenew: true })).toBe("none");
    expect(renewalStatus({ ...base, role: "ADMIN" })).toBe("none");
    expect(renewalStatus(base)).toBe("none");
  });

  it("varje utfall har en etikett och en förklaring", () => {
    for (const k of ["yes", "no", "unknown", "none"] as const) {
      expect(RENEWAL_LABELS[k].label.length).toBeGreaterThan(0);
      expect(RENEWAL_LABELS[k].hint.length).toBeGreaterThan(10);
    }
  });
});
