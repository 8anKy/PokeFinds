import { describe, expect, it } from "vitest";
import { planForEvent } from "@/app/api/webhooks/revenuecat/route";

describe("planForEvent", () => {
  it("ger PREMIUM på köp/förnyelse", () => {
    expect(planForEvent("INITIAL_PURCHASE")).toBe("PREMIUM");
    expect(planForEvent("RENEWAL")).toBe("PREMIUM");
  });
  it("ger FREE först vid EXPIRATION", () => {
    expect(planForEvent("EXPIRATION")).toBe("FREE");
  });
  it("ignorerar CANCELLATION (access kvar till perioden tar slut)", () => {
    expect(planForEvent("CANCELLATION")).toBeNull();
    expect(planForEvent("TEST")).toBeNull();
  });
});
